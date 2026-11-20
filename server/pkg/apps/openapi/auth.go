package openapi

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"strings"

	"github.com/wham/kaja/v2/pkg/oauth"
)

// authKind is the shape of credential the upstream expects.
type authKind string

const (
	authNone   authKind = ""
	authBearer authKind = "bearer" // Authorization: Bearer <token>
	authBasic  authKind = "basic"  // Authorization: Basic base64(user:pass)
	authAPIKey authKind = "apiKey" // a named header/query/cookie carrying the key
	authOAuth  authKind = "oauth"  // a token kaja obtained by signing in, sent as a bearer token
	// A token kaja exchanged the app's client id and secret for, sent as a bearer token.
	authClientCredentials authKind = "clientCredentials"
)

// auth resolves the spec's security scheme together with the credentials the user
// configured, and knows how to inject them into an outgoing request. It is shared
// by every method of an opened app.
type auth struct {
	kind       authKind
	apiKeyIn   string // header | query | cookie (apiKey only)
	apiKeyName string // parameter name (apiKey only)
	// httpScheme is the name the credential is sent under in the Authorization
	// header. "Bearer" unless the document declares another IANA scheme (digest,
	// negotiate, ...), which kaja forwards verbatim without doing its handshake.
	httpScheme string

	// signIn is where the token comes from, for authOAuth.
	signIn *signIn
	// clientCredentials is what the token is exchanged for, for authClientCredentials.
	// Its token URL is as configured, which may be relative to the base URL.
	clientCredentials oauth.ClientCredentials

	token    string // bearer token or api key value
	username string // basic auth user
	password string // basic auth password
}

// configured reports whether the user supplied any credentials.
func (a *auth) configured() bool {
	return a != nil && (a.kind == authOAuth || a.kind == authClientCredentials || a.token != "" || a.username != "" || a.password != "")
}

// withToken is the auth a call is sent with. A sign-in's token is read from the
// store as the call is made, so one renewed between two calls reaches the second.
func (a *auth) withToken(ctx context.Context, authorizer *oauth.Authorizer, tokens *oauth.ClientTokens, baseURL string) (*auth, error) {
	if a != nil && a.kind == authClientCredentials {
		credentials, err := a.exchange(baseURL)
		if err != nil {
			return nil, err
		}
		token, err := tokens.Token(ctx, credentials)
		if err != nil {
			return nil, err
		}
		resolved := *a
		resolved.kind = authBearer
		resolved.token = token
		resolved.clientCredentials = credentials
		return &resolved, nil
	}
	if a == nil || a.kind != authOAuth {
		return a, nil
	}
	if authorizer == nil {
		return nil, fmt.Errorf("this kaja serves its workspace read-only, so it has no sign-in to send")
	}
	// The token is for one server. A base URL pointed somewhere else is a call
	// the token must not go out with.
	if !sameServer(baseURL, a.signIn.resource) {
		return nil, fmt.Errorf("the sign-in is for %s, and this app calls %s", a.signIn.resource, baseURL)
	}
	token, err := authorizer.Token(ctx, a.signIn.resource)
	if err != nil {
		return nil, err
	}
	resolved := *a
	resolved.kind = authBearer
	resolved.token = token
	return &resolved, nil
}

// exchange is the client credentials with the token URL made absolute. A document
// writes it relative to the server, the way Benchling's /api/v2/token is, and the
// server is only known once the app says which one it calls.
func (a *auth) exchange(baseURL string) (oauth.ClientCredentials, error) {
	credentials := a.clientCredentials
	target, err := url.Parse(credentials.TokenURL)
	if err != nil {
		return credentials, fmt.Errorf("the token URL %q is not a URL: %w", credentials.TokenURL, err)
	}
	if !target.IsAbs() {
		base, err := url.Parse(baseURL)
		if err != nil || !base.IsAbs() {
			return credentials, fmt.Errorf("the token URL %q is relative and there is no base URL to read it against", credentials.TokenURL)
		}
		if !strings.HasSuffix(base.Path, "/") {
			base.Path += "/"
		}
		target = base.ResolveReference(target)
	}
	if target.Scheme != "https" && target.Scheme != "http" {
		return credentials, fmt.Errorf("the token URL %q is not an http(s) URL", target.String())
	}
	credentials.TokenURL = target.String()
	return credentials, nil
}

// useClientCredentials switches the auth to the client credentials grant where the
// app holds a client id and the scheme it sends declares that flow, or the app names
// a token URL of its own.
func (a *auth) useClientCredentials(s *spec, schemeKey string, credentials oauth.ClientCredentials) {
	if credentials.ClientID == "" || schemeKey == schemeNone {
		return
	}
	var flow *oauthFlow
	if schemeKey != "" {
		scheme := s.Components.SecuritySchemes.get(schemeKey)
		if scheme != nil && scheme.Type != "oauth2" {
			return
		}
		flow = scheme.clientCredentials()
	} else {
		for _, name := range s.Components.SecuritySchemes.order() {
			if flow = s.Components.SecuritySchemes.get(name).clientCredentials(); flow != nil {
				break
			}
		}
	}
	if credentials.TokenURL == "" && flow != nil {
		credentials.TokenURL = strings.TrimSpace(flow.TokenURL)
	}
	if credentials.TokenURL == "" {
		return
	}
	a.kind = authClientCredentials
	a.clientCredentials = credentials
}

// applyQuery adds an apiKey credential to the query string when the scheme places
// it there. Other schemes are applied to the request itself in applyRequest.
func (a *auth) applyQuery(q url.Values) {
	if !a.configured() {
		return
	}
	if a.kind == authAPIKey && a.apiKeyIn == "query" && a.apiKeyName != "" && a.token != "" {
		q.Set(a.apiKeyName, a.token)
	}
}

// applyRequest injects the credential into the request for every scheme except an
// apiKey carried in the query string (handled in applyQuery).
func (a *auth) applyRequest(req *http.Request) {
	if !a.configured() {
		return
	}
	switch a.kind {
	case authBearer:
		if a.token != "" {
			req.Header.Set("Authorization", a.authorizationScheme()+" "+a.token)
		}
	case authBasic:
		req.SetBasicAuth(a.username, a.password)
	case authAPIKey:
		if a.apiKeyName == "" || a.token == "" {
			return
		}
		switch a.apiKeyIn {
		case "query":
			// Handled in applyQuery.
		case "cookie":
			req.AddCookie(&http.Cookie{Name: a.apiKeyName, Value: a.token})
		default: // header
			req.Header.Set(a.apiKeyName, a.token)
		}
	}
}

// schemeNone is the security_scheme value that means "send no credentials",
// chosen explicitly in the app form.
const schemeNone = "none"

// resolveAuth builds the auth for an opened app from the spec's security schemes
// and the user's credentials. The app can pin the scheme its credentials belong
// to (security_scheme); otherwise the scheme is picked from the document. When
// the spec declares no usable scheme it falls back to a sensible default based on
// which credentials were provided, so the app still works against APIs whose
// specs omit their security section.
func resolveAuth(s *spec, schemeKey, token, username, password string) *auth {
	a := &auth{token: token, username: username, password: password}

	if schemeKey == schemeNone {
		return a
	}
	if pinned := s.Components.SecuritySchemes.get(schemeKey); schemeKey != "" && pinned != nil {
		applyScheme(a, pinned)
		return a
	}

	// The credential the user supplied decides the scheme. A username/password is
	// unambiguously HTTP Basic, so honour it even when the spec's first security
	// requirement is something else - specs commonly list oauth before an API-key
	// basic scheme (security [{oAuth}, {basicApiKeyAuth}]), and the app form's
	// username field means "use Basic auth".
	if username != "" || password != "" {
		a.kind = authBasic
		return a
	}

	if scheme := pickScheme(s); scheme != nil {
		applyScheme(a, scheme)
	}

	if a.kind == authNone && a.token != "" {
		// No declared scheme: a bare token is sent as a bearer token.
		a.kind = authBearer
	}
	return a
}

// authorizationScheme is the name a token is sent under, defaulting to Bearer.
func (a *auth) authorizationScheme() string {
	if a.httpScheme == "" {
		return "Bearer"
	}
	return a.httpScheme
}

// applyScheme sets how the credentials are sent for one security scheme.
func applyScheme(a *auth, scheme *securityScheme) {
	switch scheme.Type {
	case "http":
		// Scheme names are case-insensitive; specs write "Bearer" and "bearer".
		if strings.EqualFold(scheme.Scheme, "basic") {
			a.kind = authBasic
		} else {
			a.kind = authBearer
			if !strings.EqualFold(scheme.Scheme, "bearer") {
				// digest, negotiate, hoba, ... - forwarded under their own name.
				a.httpScheme = capitalize(scheme.Scheme)
			}
		}
	case "apiKey":
		a.kind = authAPIKey
		a.apiKeyIn = scheme.In
		a.apiKeyName = scheme.Name
	case "oauth2", "openIdConnect":
		a.kind = authBearer
		if scheme.signIn != nil {
			a.kind = authOAuth
			a.signIn = scheme.signIn
		}
	}
}

// capitalize upper-cases the first letter, so a scheme written "digest" is sent
// the way the Authorization header spells it.
func capitalize(value string) string {
	if value == "" {
		return ""
	}
	return strings.ToUpper(value[:1]) + value[1:]
}

// pickScheme chooses the security scheme to apply across the app. It honours the
// document-level security requirement, falling back to the sole defined scheme
// when the requirement is absent (common when security is declared per-operation).
// A scheme kaja supplied is never picked: it applies where the app names it, so
// an app saved before kaja knew about it goes on sending what it sent.
func pickScheme(s *spec) *securityScheme {
	schemes := &s.Components.SecuritySchemes
	if schemes.len() == 0 {
		return nil
	}
	for _, requirement := range s.Security {
		for name := range requirement {
			if sc := schemes.get(name); sc != nil && !sc.supplied {
				return sc
			}
		}
	}
	if names := schemes.order(); len(names) == 1 && !schemes.get(names[0]).supplied {
		return schemes.get(names[0])
	}
	return nil
}

// describe returns a short human-readable summary of how credentials will be sent,
// for the open-time log. It returns "" when no credentials are configured.
func (a *auth) describe() string {
	if !a.configured() {
		return ""
	}
	switch a.kind {
	case authBearer:
		return "sending token as Authorization: " + a.authorizationScheme()
	case authOAuth:
		return "sending the token kaja signed in to " + a.signIn.resource + " for"
	case authClientCredentials:
		return "exchanging the client ID and secret for a token at " + a.clientCredentials.TokenURL
	case authBasic:
		return "sending username/password as HTTP Basic auth"
	case authAPIKey:
		in := a.apiKeyIn
		if in == "" {
			in = "header"
		}
		return "sending API key as " + in + " " + a.apiKeyName
	}
	return ""
}
