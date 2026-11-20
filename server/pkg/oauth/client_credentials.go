package oauth

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"net/url"
	"sync"
	"time"
)

// ClientCredentials is what an app exchanges for a token of its own (RFC 6749
// §4.4): no person and no browser, only an id and a secret posted to a token
// endpoint.
type ClientCredentials struct {
	TokenURL     string
	ClientID     string
	ClientSecret string
	Scope        string
}

// The secret is in the key so a secret replaced in the workspace is a token asked
// for again, and two people serving one process with their own secrets never share
// one. It is hashed so the key is not a second copy of it.
func (c ClientCredentials) key() string {
	sum := sha256.Sum256([]byte(c.TokenURL + "\x00" + c.ClientID + "\x00" + c.ClientSecret + "\x00" + c.Scope))
	return hex.EncodeToString(sum[:])
}

// clientTokensCap bounds the cache, since a served kaja's visitors each bring their
// own credentials.
const clientTokensCap = 64

// ClientTokens keeps the tokens client credentials were exchanged for, in memory
// only: nothing is lost with them that the id and secret can't get back.
type ClientTokens struct {
	client *http.Client

	mu     sync.Mutex
	tokens map[string]*clientToken
	// methods is how each token endpoint took the secret last time, so a server
	// that refuses the Basic header is not asked with it on every renewal.
	methods map[string]string
}

type clientToken struct {
	token    *tokenSet
	issuedAt time.Time
}

func NewClientTokens(client *http.Client) *ClientTokens {
	if client == nil {
		client = &http.Client{Timeout: 30 * time.Second}
	}
	return &ClientTokens{client: client, tokens: map[string]*clientToken{}, methods: map[string]string{}}
}

// Token is an access token for the credentials, asked for when there is none held
// or the one held is about to run out. There is no refresh token in this grant: a
// new token is the same request again.
func (t *ClientTokens) Token(ctx context.Context, credentials ClientCredentials) (string, error) {
	if credentials.TokenURL == "" {
		return "", fmt.Errorf("no token URL to exchange the client credentials at")
	}
	if credentials.ClientID == "" || credentials.ClientSecret == "" {
		return "", fmt.Errorf("the client credentials need both a client ID and a client secret")
	}
	key := credentials.key()
	t.mu.Lock()
	held := t.tokens[key]
	method := t.methods[credentials.TokenURL]
	t.mu.Unlock()
	if held != nil && !held.token.expired(time.Now()) {
		return held.token.AccessToken, nil
	}

	issued, method, err := t.request(ctx, credentials, method)
	if err != nil {
		return "", err
	}

	t.mu.Lock()
	defer t.mu.Unlock()
	t.methods[credentials.TokenURL] = method
	if len(t.tokens) >= clientTokensCap {
		t.evictOldest()
	}
	t.tokens[key] = &clientToken{token: issued, issuedAt: time.Now()}
	return issued.AccessToken, nil
}

// request asks with the secret in the Basic header first, which every server has
// to accept (RFC 6749 §2.3.1), and in the form where that is refused, which is the
// one many APIs document instead.
func (t *ClientTokens) request(ctx context.Context, credentials ClientCredentials, method string) (*tokenSet, string, error) {
	methods := []string{"client_secret_basic", "client_secret_post"}
	if method == "client_secret_post" {
		methods = []string{"client_secret_post", "client_secret_basic"}
	}
	var first error
	for _, method := range methods {
		form := url.Values{"grant_type": {"client_credentials"}}
		if credentials.Scope != "" {
			form.Set("scope", credentials.Scope)
		}
		issued, err := requestTokenContext(ctx, t.client,
			&authorizationServer{TokenEndpoint: credentials.TokenURL},
			&registration{ClientID: credentials.ClientID, ClientSecret: credentials.ClientSecret, TokenAuthMethod: method},
			form)
		if err == nil {
			return issued, method, nil
		}
		if ctx.Err() != nil {
			return nil, "", err
		}
		if first == nil {
			first = err
		}
	}
	return nil, "", first
}

// Forget drops the token held for the credentials, which is what an API refusing
// it says to do: it was revoked, or it ran out sooner than it said.
func (t *ClientTokens) Forget(credentials ClientCredentials) {
	t.mu.Lock()
	delete(t.tokens, credentials.key())
	t.mu.Unlock()
}

// Sent is every token held, so a call reporting what it sent can mask them.
func (t *ClientTokens) Sent() []string {
	if t == nil {
		return nil
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	sent := make([]string, 0, len(t.tokens))
	for _, held := range t.tokens {
		sent = append(sent, held.token.AccessToken)
	}
	return sent
}

func (t *ClientTokens) evictOldest() {
	var oldest string
	var at time.Time
	for key, held := range t.tokens {
		if oldest == "" || held.issuedAt.Before(at) {
			oldest, at = key, held.issuedAt
		}
	}
	delete(t.tokens, oldest)
}
