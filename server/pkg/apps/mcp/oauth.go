package mcp

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// The client half of MCP's authorization: OAuth 2.1 with PKCE, the authorization
// server found through the resource's own metadata, and the token asked for the
// one resource it is going to be used at.
//
// Everything here is a request kaja makes on its own behalf. The one thing it
// cannot do in this process is show the authorization page: that is a browser's
// job, which is why the flow is halves - a URL to open, and the redirect that
// comes back to the loopback listener in oauth_flow.go.

// oauthClientName is how kaja introduces itself to an authorization server that
// registers it, and what the consent page shows the person approving.
const oauthClientName = "Kaja"

// metadataLimit bounds a discovery document. These are small JSON objects, and
// an endpoint that answers one with a stream is not one to read to the end.
const metadataLimit = 1 << 20

// challenge is a `WWW-Authenticate` challenge, reduced to its parameters. Only
// the Bearer scheme's are read, since that is the only one MCP defines.
type challenge map[string]string

// parseChallenge reads the parameters out of a `WWW-Authenticate` header. The
// grammar is a scheme followed by comma-separated `name=value` pairs, values
// quoted or bare; a header kaja cannot make sense of reads as no parameters,
// which is the same as the header being absent.
func parseChallenge(header string) challenge {
	parsed := challenge{}
	rest := strings.TrimSpace(header)
	if scheme, remainder, found := strings.Cut(rest, " "); found && !strings.Contains(scheme, "=") {
		rest = remainder
	}
	for _, pair := range splitChallenge(rest) {
		name, value, found := strings.Cut(pair, "=")
		if !found {
			continue
		}
		name = strings.ToLower(strings.TrimSpace(name))
		value = strings.TrimSpace(value)
		if len(value) >= 2 && strings.HasPrefix(value, `"`) && strings.HasSuffix(value, `"`) {
			value = strings.ReplaceAll(value[1:len(value)-1], `\"`, `"`)
		}
		if name != "" {
			parsed[name] = value
		}
	}
	return parsed
}

// splitChallenge splits on the commas between parameters, leaving the ones
// inside a quoted value where they are - a `scope` is a space-separated list,
// but an `error_description` is a sentence.
func splitChallenge(rest string) []string {
	var parts []string
	quoted := false
	start := 0
	for i, r := range rest {
		switch {
		case r == '"' && (i == 0 || rest[i-1] != '\\'):
			quoted = !quoted
		case r == ',' && !quoted:
			parts = append(parts, rest[start:i])
			start = i + 1
		}
	}
	return append(parts, rest[start:])
}

// canonicalResource is the identifier a token is asked for and validated
// against: the MCP endpoint with its scheme and host lowercased, its default
// port and its fragment dropped, and no trailing slash. It is what the
// `resource` parameter carries and what a resource metadata document has to
// agree with.
func canonicalResource(raw string) (string, error) {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return "", fmt.Errorf("invalid URL %q: %w", raw, err)
	}
	if parsed.Scheme == "" || parsed.Host == "" {
		return "", fmt.Errorf("%q is not an absolute URL", raw)
	}
	parsed.Scheme = strings.ToLower(parsed.Scheme)
	parsed.Host = strings.ToLower(parsed.Host)
	if (parsed.Scheme == "https" && strings.HasSuffix(parsed.Host, ":443")) ||
		(parsed.Scheme == "http" && strings.HasSuffix(parsed.Host, ":80")) {
		parsed.Host = parsed.Host[:strings.LastIndex(parsed.Host, ":")]
	}
	parsed.Fragment = ""
	parsed.RawQuery = ""
	parsed.Path = strings.TrimSuffix(parsed.Path, "/")
	return parsed.String(), nil
}

// protectedResource is the RFC 9728 document an MCP server serves about itself:
// which authorization servers issue tokens for it, and the scopes it is worth
// asking for.
type protectedResource struct {
	Resource             string   `json:"resource"`
	AuthorizationServers []string `json:"authorization_servers"`
	ScopesSupported      []string `json:"scopes_supported"`
}

// protectedResourceURLs is where the resource's metadata is looked for. A
// challenge that named it is authoritative and the only place asked; without
// one the two well-known forms are tried in turn, the path-carrying one first,
// since a host may serve more than one MCP endpoint.
func protectedResourceURLs(endpoint string, named string) []string {
	if named = strings.TrimSpace(named); named != "" {
		return []string{named}
	}
	parsed, err := url.Parse(endpoint)
	if err != nil {
		return nil
	}
	root := &url.URL{Scheme: parsed.Scheme, Host: parsed.Host, Path: "/.well-known/oauth-protected-resource"}
	path := strings.Trim(parsed.Path, "/")
	if path == "" {
		return []string{root.String()}
	}
	return []string{root.String() + "/" + path, root.String()}
}

// authorizationServerURLs is where an authorization server's metadata is looked
// for, in the order the specification insists on: OAuth's own well-known URI
// first, then OpenID Connect's, and - for an issuer with a path - the appended
// form OpenID Connect defined before RFC 8414 settled on insertion.
func authorizationServerURLs(issuer string) ([]string, error) {
	parsed, err := url.Parse(strings.TrimSpace(issuer))
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return nil, fmt.Errorf("%q is not an authorization server URL", issuer)
	}
	base := &url.URL{Scheme: parsed.Scheme, Host: parsed.Host}
	path := strings.Trim(parsed.Path, "/")
	if path == "" {
		return []string{
			base.String() + "/.well-known/oauth-authorization-server",
			base.String() + "/.well-known/openid-configuration",
		}, nil
	}
	return []string{
		base.String() + "/.well-known/oauth-authorization-server/" + path,
		base.String() + "/.well-known/openid-configuration/" + path,
		base.String() + "/" + path + "/.well-known/openid-configuration",
	}, nil
}

// authorizationServer is the metadata document, reduced to what the flow needs.
type authorizationServer struct {
	Issuer                            string   `json:"issuer"`
	AuthorizationEndpoint             string   `json:"authorization_endpoint"`
	TokenEndpoint                     string   `json:"token_endpoint"`
	RegistrationEndpoint              string   `json:"registration_endpoint"`
	ScopesSupported                   []string `json:"scopes_supported"`
	CodeChallengeMethodsSupported     []string `json:"code_challenge_methods_supported"`
	ClientIDMetadataDocumentSupported bool     `json:"client_id_metadata_document_supported"`
	IssParameterSupported             bool     `json:"authorization_response_iss_parameter_supported"`
}

// sameIssuer compares two issuer identifiers. The specification says identical,
// and the one liberty taken is a trailing slash: it names the same document on
// the same host, and a document rejected over one is a server nobody can sign
// in to.
func sameIssuer(a, b string) bool {
	return strings.TrimSuffix(a, "/") == strings.TrimSuffix(b, "/")
}

// checkIssuedBy applies RFC 9207 to an authorization response: an `iss` that
// arrived is compared to the issuer recorded before the browser was opened,
// whatever the metadata says, and one that did not arrive is only missing where
// the server said it would send one.
func checkIssuedBy(server *authorizationServer, received string) error {
	if received == "" {
		if server.IssParameterSupported {
			return fmt.Errorf("the authorization server did not say which issuer answered")
		}
		return nil
	}
	if !sameIssuer(received, server.Issuer) {
		return fmt.Errorf("the authorization response came from %q rather than from %q", received, server.Issuer)
	}
	return nil
}

// pickScope is what to ask for, in the order of least privilege: the scopes the
// server challenged for, else the ones the app was configured with, else the
// minimum the resource says it needs.
func pickScope(challenged string, configured string, resource *protectedResource) string {
	if scope := strings.TrimSpace(challenged); scope != "" {
		return scope
	}
	if scope := strings.TrimSpace(configured); scope != "" {
		return scope
	}
	if resource != nil {
		return strings.TrimSpace(strings.Join(resource.ScopesSupported, " "))
	}
	return ""
}

// pkce is one authorization's proof key: the verifier stays here and the
// challenge travels, so a code intercepted on the way back is worth nothing
// without the process that asked for it.
type pkce struct {
	verifier  string
	challenge string
}

func newPKCE() (pkce, error) {
	verifier, err := randomToken()
	if err != nil {
		return pkce{}, err
	}
	sum := sha256.Sum256([]byte(verifier))
	return pkce{verifier: verifier, challenge: base64.RawURLEncoding.EncodeToString(sum[:])}, nil
}

func randomToken() (string, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", fmt.Errorf("generating a random value: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(raw), nil
}

// authorizationURL is the page to open in a browser. The resource is named
// because a token is for one server and nothing else, and the state and the
// challenge are what tie the answer back to this request.
func authorizationURL(server *authorizationServer, clientID, redirectURI, scope, resource, state string, proof pkce) (string, error) {
	parsed, err := url.Parse(server.AuthorizationEndpoint)
	if err != nil || parsed.Scheme == "" {
		return "", fmt.Errorf("the authorization server named no authorization endpoint")
	}
	query := parsed.Query()
	query.Set("response_type", "code")
	query.Set("client_id", clientID)
	query.Set("redirect_uri", redirectURI)
	query.Set("state", state)
	query.Set("code_challenge", proof.challenge)
	query.Set("code_challenge_method", "S256")
	query.Set("resource", resource)
	if scope != "" {
		query.Set("scope", scope)
	}
	parsed.RawQuery = query.Encode()
	return parsed.String(), nil
}

// registration is the client an authorization server knows kaja as.
type registration struct {
	ClientID         string `json:"client_id"`
	ClientSecret     string `json:"client_secret,omitempty"`
	TokenAuthMethod  string `json:"token_endpoint_auth_method,omitempty"`
	RegisteredAt     int64  `json:"registered_at,omitempty"`
	SecretExpiresAt  int64  `json:"client_secret_expires_at,omitempty"`
	RegistrationJSON string `json:"-"`
}

// registerClient asks the authorization server for a client of kaja's own. It is
// the fallback: a client id the person already has outranks it, and a server
// that reads client ID metadata documents needs neither. Registration is a
// native application's - the redirect is a loopback address, which an OpenID
// Connect server refuses for the "web" type it would otherwise assume.
func registerClient(client *http.Client, server *authorizationServer, redirectURI string, scope string) (*registration, error) {
	if server.RegistrationEndpoint == "" {
		return nil, fmt.Errorf("the authorization server registers no clients, so it needs a client id of your own")
	}
	body := map[string]any{
		"client_name":                oauthClientName,
		"redirect_uris":              []string{redirectURI},
		"grant_types":                []string{"authorization_code", "refresh_token"},
		"response_types":             []string{"code"},
		"token_endpoint_auth_method": "none",
		"application_type":           "native",
	}
	if scope != "" {
		body["scope"] = scope
	}
	encoded, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	request, err := http.NewRequest(http.MethodPost, server.RegistrationEndpoint, strings.NewReader(string(encoded)))
	if err != nil {
		return nil, err
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json")
	response, err := client.Do(request)
	if err != nil {
		return nil, fmt.Errorf("registering with %s: %w", server.RegistrationEndpoint, err)
	}
	defer response.Body.Close()
	payload, _ := io.ReadAll(io.LimitReader(response.Body, metadataLimit))
	if response.StatusCode >= 400 {
		return nil, fmt.Errorf("the authorization server refused to register kaja: %s", summarize(payload))
	}
	registered := &registration{}
	if err := json.Unmarshal(payload, registered); err != nil || registered.ClientID == "" {
		return nil, fmt.Errorf("the authorization server's registration answer is not one: %s", summarize(payload))
	}
	return registered, nil
}

// tokenSet is what a token endpoint answered with, plus when the access token
// stops being worth sending.
type tokenSet struct {
	AccessToken  string    `json:"access_token"`
	RefreshToken string    `json:"refresh_token,omitempty"`
	Scope        string    `json:"scope,omitempty"`
	ExpiresAt    time.Time `json:"expires_at,omitempty"`
	Issuer       string    `json:"issuer,omitempty"`
}

// expired reports whether a token is too near its end to send. The margin is
// what keeps a call from being refused by a token that was valid when the
// request was built.
func (t *tokenSet) expired(now time.Time) bool {
	if t.ExpiresAt.IsZero() {
		return false
	}
	return !now.Add(30 * time.Second).Before(t.ExpiresAt)
}

// requestToken is both grants: the code exchange and the refresh. They differ by
// the form they post and by nothing else, so they are one function rather than
// two that would drift.
func requestToken(client *http.Client, server *authorizationServer, registered *registration, form url.Values) (*tokenSet, error) {
	if server.TokenEndpoint == "" {
		return nil, fmt.Errorf("the authorization server named no token endpoint")
	}
	form.Set("client_id", registered.ClientID)
	// A client kaja registered asks for no secret, so it usually has none. One
	// issued anyway is sent the way the server said it wants it, and over the
	// authorization header where it said nothing: that is what RFC 7591 defaults
	// a registration to.
	postSecret := registered.ClientSecret != "" && registered.TokenAuthMethod == "client_secret_post"
	if postSecret {
		form.Set("client_secret", registered.ClientSecret)
	}
	request, err := http.NewRequest(http.MethodPost, server.TokenEndpoint, strings.NewReader(form.Encode()))
	if err != nil {
		return nil, err
	}
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	request.Header.Set("Accept", "application/json")
	if registered.ClientSecret != "" && !postSecret {
		request.SetBasicAuth(url.QueryEscape(registered.ClientID), url.QueryEscape(registered.ClientSecret))
	}

	response, err := client.Do(request)
	if err != nil {
		return nil, fmt.Errorf("calling %s: %w", server.TokenEndpoint, err)
	}
	defer response.Body.Close()
	payload, _ := io.ReadAll(io.LimitReader(response.Body, metadataLimit))
	if response.StatusCode >= 400 {
		return nil, fmt.Errorf("the authorization server refused the token request: %s", tokenErrorText(payload))
	}

	var answer struct {
		AccessToken  string `json:"access_token"`
		TokenType    string `json:"token_type"`
		ExpiresIn    int64  `json:"expires_in"`
		RefreshToken string `json:"refresh_token"`
		Scope        string `json:"scope"`
	}
	if err := json.Unmarshal(payload, &answer); err != nil || answer.AccessToken == "" {
		return nil, fmt.Errorf("the authorization server's answer carries no access token: %s", summarize(payload))
	}
	issued := &tokenSet{
		AccessToken:  answer.AccessToken,
		RefreshToken: answer.RefreshToken,
		Scope:        answer.Scope,
		Issuer:       server.Issuer,
	}
	if answer.ExpiresIn > 0 {
		issued.ExpiresAt = time.Now().Add(time.Duration(answer.ExpiresIn) * time.Second)
	}
	return issued, nil
}

// tokenErrorText is the reason an OAuth error response gives, which is a pair of
// fields rather than a sentence.
func tokenErrorText(payload []byte) string {
	var failure struct {
		Error       string `json:"error"`
		Description string `json:"error_description"`
	}
	if json.Unmarshal(payload, &failure) != nil || failure.Error == "" {
		return summarize(payload)
	}
	if failure.Description != "" {
		return failure.Error + ": " + failure.Description
	}
	return failure.Error
}

// fetchJSON reads one discovery document.
func fetchJSON(client *http.Client, target string, into any) error {
	request, err := http.NewRequest(http.MethodGet, target, nil)
	if err != nil {
		return err
	}
	request.Header.Set("Accept", "application/json")
	response, err := client.Do(request)
	if err != nil {
		return fmt.Errorf("calling %s: %w", target, err)
	}
	defer response.Body.Close()
	payload, _ := io.ReadAll(io.LimitReader(response.Body, metadataLimit))
	if response.StatusCode >= 400 {
		return fmt.Errorf("%s answered %d %s", target, response.StatusCode, http.StatusText(response.StatusCode))
	}
	if err := json.Unmarshal(payload, into); err != nil {
		return fmt.Errorf("%s did not answer with a metadata document: %s", target, summarize(payload))
	}
	return nil
}
