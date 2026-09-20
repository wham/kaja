package mcp

import (
	"context"
	"fmt"
	"html"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

// callbackPort is where the authorization server sends the person back. It is a
// loopback address rather than a page of kaja's own because that is the one
// redirect every build has: the desktop's window is served from wails://, which
// no authorization server would accept, and a deployed kaja is somewhere else
// entirely from the browser signing in. It sits next to the ports kaja already
// holds in the registered range, so the OS won't hand it to something else.
const callbackPort = 41522

// callbackPath is the one path the listener answers. Everything else is a 404,
// including a request carrying no state kaja is waiting for.
const callbackPath = "/oauth/callback"

// flowTimeout is how long a sign-in waits for the browser. It is the person's
// own pace - reading a consent page, logging in, picking an account - so it is
// generous, and it exists so an abandoned flow lets go of its listener.
const flowTimeout = 5 * time.Minute

// redirectURI is the address kaja is sent back to, which is what it registers
// with an authorization server and what the authorization request names. The
// port is read off the listener because the fixed one may have been taken.
func (a *Authorizer) redirectURI() string {
	a.mu.Lock()
	defer a.mu.Unlock()
	port := a.port
	if a.listener != nil {
		if address, ok := a.listener.Addr().(*net.TCPAddr); ok {
			port = address.Port
		}
	}
	return fmt.Sprintf("http://127.0.0.1:%d%s", port, callbackPath)
}

// Authorizer runs MCP's authorization flow and holds what it produced.
//
// A flow is two halves with a browser in between: `Begin` does the discovery and
// hands back a URL to open, and the loopback listener takes the redirect that
// comes back. Only the halves are here; who opens the URL is the window's
// business, since the desktop and a browser open one differently.
type Authorizer struct {
	store  *TokenStore
	client *http.Client

	// port is the loopback port the redirect comes back on. Zero asks the OS for
	// one, which only a test does: an authorization server is registered against
	// one address and has to be sent back to it.
	port int

	mu       sync.Mutex
	pending  map[string]*flow
	listener net.Listener
}

// flow is one sign-in in progress: what it will need to finish, and where to say
// it has.
type flow struct {
	resource   string
	scope      string
	server     *authorizationServer
	registered *registration
	proof      pkce
	redirect   string
	done       chan error
	// stop is closed when the flow settles, which is what a device grant's poll
	// is watching: nobody is left to answer once the flow is over.
	stop  chan struct{}
	timer *time.Timer
}

// SignInPrompt is what the person has to do for a sign-in to finish: a page to
// open, and - where the grant sends kaja nothing back - the code to type into it.
type SignInPrompt struct {
	URL string
	// UserCode is set by the device grant alone. A redirect flow needs none: the
	// browser carries the answer back by itself.
	UserCode string
}

// AppAuthorization is the app's half of a sign-in: which server, and the client
// it is to be identified as where the authorization server registers none.
type AppAuthorization struct {
	Endpoint string
	// Headers the app sends, which a document behind a login is fetched with.
	Headers map[string]string
	// ClientID is a client of the person's own: one an authorization server's
	// dashboard issued them, or the https URL of a client ID metadata document.
	// Empty asks the server to register kaja itself.
	ClientID string
	Scope    string
}

func NewAuthorizer(store *TokenStore, client *http.Client) *Authorizer {
	if client == nil {
		client = &http.Client{Timeout: inspectTimeout}
	}
	return &Authorizer{store: store, client: client, port: callbackPort, pending: map[string]*flow{}}
}

// DefaultAuthorizer is the one this installation uses, over the store it keeps.
func DefaultAuthorizer() (*Authorizer, error) {
	store, err := DefaultTokenStore()
	if err != nil {
		return nil, err
	}
	return NewAuthorizer(store, &http.Client{Timeout: inspectTimeout}), nil
}

// Begin discovers everything a sign-in needs and hands back the page to open and
// a channel that reports how it went. Nothing is stored until the flow finishes:
// a sign-in that is never completed leaves no trace.
func (a *Authorizer) Begin(app AppAuthorization) (SignInPrompt, <-chan error, error) {
	resource, err := canonicalResource(app.Endpoint)
	if err != nil {
		return SignInPrompt{}, nil, err
	}

	challenged, metadataURL := a.probe(app)
	described, err := a.readProtectedResource(app.Endpoint, metadataURL)
	if err != nil {
		return SignInPrompt{}, nil, err
	}
	if described.Resource != "" {
		declared, err := canonicalResource(described.Resource)
		if err != nil || declared != resource {
			return SignInPrompt{}, nil, fmt.Errorf("the server's metadata is about %q rather than about %q", described.Resource, resource)
		}
	}
	if len(described.AuthorizationServers) == 0 {
		return SignInPrompt{}, nil, fmt.Errorf("the server names no authorization server to sign in to")
	}

	server, err := a.readAuthorizationServer(described.AuthorizationServers[0])
	if err != nil {
		return SignInPrompt{}, nil, err
	}
	scope := pickScope(challenged["scope"], app.Scope, described)

	if usesDeviceGrant(server) {
		registered := a.heldClient(server, app.ClientID)
		if registered == nil {
			return SignInPrompt{}, nil, fmt.Errorf("the authorization server registers no clients, so it needs a client id of your own")
		}
		return a.beginDevice(resource, scope, server, registered)
	}

	// The listener comes first, because the address it is on is what kaja is
	// registered against and what the authorization request has to name.
	if err := a.listen(); err != nil {
		return SignInPrompt{}, nil, err
	}
	redirect := a.redirectURI()

	registered, err := a.clientFor(server, app.ClientID, scope, redirect)
	if err != nil {
		return SignInPrompt{}, nil, err
	}

	proof, err := newPKCE()
	if err != nil {
		return SignInPrompt{}, nil, err
	}
	state, err := randomToken()
	if err != nil {
		return SignInPrompt{}, nil, err
	}
	target, err := authorizationURL(server, registered.ClientID, redirect, scope, resource, state, proof)
	if err != nil {
		return SignInPrompt{}, nil, err
	}

	pending := &flow{
		resource:   resource,
		scope:      scope,
		server:     server,
		registered: registered,
		proof:      proof,
		redirect:   redirect,
		done:       make(chan error, 1),
		stop:       make(chan struct{}),
	}
	a.mu.Lock()
	a.pending[state] = pending
	a.mu.Unlock()
	pending.timer = time.AfterFunc(flowTimeout, func() {
		a.settle(state, fmt.Errorf("the sign-in was not finished in time"))
	})
	return SignInPrompt{URL: target}, pending.done, nil
}

// usesDeviceGrant reports whether a sign-in here has to be carried by the device
// grant. It is a fact about the server rather than about the client: a server
// that refuses a code exchange with no secret refuses it whoever the client is,
// so a client id of the person's own runs into the same wall.
func usesDeviceGrant(server *authorizationServer) bool {
	return knownServer(server.Issuer).Device && server.DeviceAuthorizationEndpoint != ""
}

// Cancel gives up on a sign-in nobody is waiting for any more.
func (a *Authorizer) Cancel(done <-chan error) {
	a.mu.Lock()
	state := ""
	for key, pending := range a.pending {
		if pending.done == done {
			state = key
			break
		}
	}
	a.mu.Unlock()
	if state != "" {
		a.settle(state, fmt.Errorf("the sign-in was abandoned"))
	}
}

// Token is the access token to call a resource with, renewed where it has to be.
// It is asked for on every call rather than held, so replacing a token takes
// effect on the next call rather than on the next time the app is opened.
func (a *Authorizer) Token(endpoint string) (string, error) {
	resource, err := canonicalResource(endpoint)
	if err != nil {
		return "", err
	}
	held := a.store.Grant(resource)
	if held == nil || held.Token == nil {
		return "", fmt.Errorf("kaja is not signed in to %s yet", resource)
	}
	if !held.Token.expired(time.Now()) {
		return held.Token.AccessToken, nil
	}
	if held.Token.RefreshToken == "" {
		return "", fmt.Errorf("the token for %s has expired and the server issued nothing to renew it with; sign in again", resource)
	}

	form := url.Values{}
	form.Set("grant_type", "refresh_token")
	form.Set("refresh_token", held.Token.RefreshToken)
	form.Set("resource", resource)
	if held.Token.Scope != "" {
		form.Set("scope", held.Token.Scope)
	}
	renewed, err := requestToken(a.client, held.Server, a.refreshClient(held), form)
	if err != nil {
		return "", fmt.Errorf("renewing the token for %s: %w", resource, err)
	}
	// A server that rotates refresh tokens sends the new one; one that doesn't
	// expects the old one to go on being used.
	if renewed.RefreshToken == "" {
		renewed.RefreshToken = held.Token.RefreshToken
	}
	if renewed.Scope == "" {
		renewed.Scope = held.Token.Scope
	}
	held.Token = renewed
	if err := a.store.SaveGrant(resource, held); err != nil {
		return "", err
	}
	return renewed.AccessToken, nil
}

// refreshClient is the client a held token was issued to, read off the grant
// rather than resolved again: neither a configured client id nor one kaja ships
// is in the store, and a refresh token is worth nothing to another client.
func (a *Authorizer) refreshClient(held *grant) *registration {
	registered := a.store.Client(held.Server.Issuer)
	if held.ClientID == "" {
		// A grant from before the client was recorded on one, which can only be
		// a client kaja registered.
		if registered != nil {
			return registered
		}
		return &registration{}
	}
	// The registration is what carries a secret, where the server issued one.
	if registered != nil && registered.ClientID == held.ClientID {
		return registered
	}
	return &registration{ClientID: held.ClientID}
}

// SignedIn reports whether a resource has a token at all, which is what the app
// form states beside the button.
func (a *Authorizer) SignedIn(endpoint string) bool {
	resource, err := canonicalResource(endpoint)
	if err != nil {
		return false
	}
	held := a.store.Grant(resource)
	return held != nil && held.Token != nil
}

// Forget drops a resource's token, which is what signing out is.
func (a *Authorizer) Forget(endpoint string) error {
	resource, err := canonicalResource(endpoint)
	if err != nil {
		return err
	}
	return a.store.Forget(resource)
}

// probe asks the server for the challenge it answers an unauthenticated request
// with. A server that answers something else is not a failure here: the
// well-known URIs are the other half of the same discovery, and this is only
// what makes the first of them unnecessary.
func (a *Authorizer) probe(app AppAuthorization) (challenge, string) {
	body := `{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}`
	request, err := http.NewRequest(http.MethodPost, app.Endpoint, strings.NewReader(body))
	if err != nil {
		return challenge{}, ""
	}
	for name, value := range app.Headers {
		request.Header.Set(name, value)
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json, text/event-stream")
	response, err := a.client.Do(request)
	if err != nil {
		return challenge{}, ""
	}
	defer response.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, metadataLimit))
	if response.StatusCode != http.StatusUnauthorized && response.StatusCode != http.StatusForbidden {
		return challenge{}, ""
	}
	parsed := parseChallenge(response.Header.Get("WWW-Authenticate"))
	return parsed, parsed["resource_metadata"]
}

func (a *Authorizer) readProtectedResource(endpoint string, named string) (*protectedResource, error) {
	candidates := protectedResourceURLs(endpoint, named)
	var reported error
	for _, target := range candidates {
		described := &protectedResource{}
		if err := fetchJSON(a.client, target, described); err != nil {
			// The first candidate is the one the failure names, because it is the
			// address the specification puts first and the one a server publishing
			// this document publishes it at. Reporting the last one instead named
			// the fallback, so a person was told about a URL their server was never
			// going to answer at while the address that mattered went unsaid. What
			// is reported is the request and its answer: a document kaja was not
			// served is not a document the server does not publish.
			if reported == nil {
				reported = err
			}
			continue
		}
		return described, nil
	}
	if reported == nil {
		reported = fmt.Errorf("%q is not a URL", endpoint)
	}
	return nil, fmt.Errorf("no protected resource metadata: %w", reported)
}

// readAuthorizationServer tries each well-known form in turn and takes the first
// document that is about the server it was asked for. A document naming someone
// else's issuer is the whole attack RFC 8414's check exists for, so it is
// refused rather than skipped over.
func (a *Authorizer) readAuthorizationServer(issuer string) (*authorizationServer, error) {
	candidates, err := authorizationServerURLs(issuer)
	if err != nil {
		return nil, err
	}
	var last error
	for _, target := range candidates {
		server := &authorizationServer{}
		if err := fetchJSON(a.client, target, server); err != nil {
			last = err
			continue
		}
		if !sameIssuer(server.Issuer, issuer) {
			return nil, fmt.Errorf("%s describes %q rather than %q", target, server.Issuer, issuer)
		}
		if server.Issuer == "" {
			server.Issuer = issuer
		}
		return server, nil
	}
	return nil, fmt.Errorf("%s does not describe itself as an authorization server: %w", issuer, last)
}

// clientFor is the client kaja is identified as, in the order the specification
// asks for: one the person already has, then one kaja ships for this server,
// then one this installation registered with it before, then one registered now.
// A client id metadata document is the first of those - it is an https URL, so
// it is a client id the person has - and kaja hosts none of its own. What kaja
// ships outranks what it registered, a server it ships an id for being one that
// registers nobody.
func (a *Authorizer) clientFor(server *authorizationServer, configured string, scope string, redirect string) (*registration, error) {
	if held := a.heldClient(server, configured); held != nil {
		return held, nil
	}
	registered, err := registerClient(a.client, server, redirect, scope)
	if err != nil {
		return nil, err
	}
	if err := a.store.SaveClient(server.Issuer, registered); err != nil {
		return nil, err
	}
	return registered, nil
}

// heldClient is the client kaja already has for a server - one the person
// configured, one kaja ships, or one this installation registered before - or
// nothing, which is what registering is for.
func (a *Authorizer) heldClient(server *authorizationServer, configured string) *registration {
	if configured = strings.TrimSpace(configured); configured != "" {
		return &registration{ClientID: configured}
	}
	if shipped := builtInClient(server.Issuer); shipped != nil {
		return shipped
	}
	if held := a.store.Client(server.Issuer); held != nil && held.ClientID != "" {
		return held
	}
	return nil
}

// listen opens the loopback listener, if it is not already open. It is opened
// when a sign-in starts and closed when the last one settles, so the port is
// held only while somebody is being sent back to it.
func (a *Authorizer) listen() error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.listener != nil {
		return nil
	}
	listener, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", a.port))
	if err != nil && a.port != 0 {
		// RFC 8252 section 7.3: a loopback redirect is matched without its port,
		// so one something else is holding is not a sign-in that cannot happen.
		listener, err = net.Listen("tcp", "127.0.0.1:0")
	}
	if err != nil {
		return fmt.Errorf("kaja could not open a port to be signed back in on: %w", err)
	}
	a.listener = listener
	mux := http.NewServeMux()
	mux.HandleFunc("GET "+callbackPath, a.callback)
	go func() { _ = (&http.Server{Handler: mux, ReadHeaderTimeout: 10 * time.Second}).Serve(listener) }()
	return nil
}

// callback is where the authorization server sends the person back. It finishes
// the flow the state names and answers with a page saying what happened, which
// is the last thing the browser has to show for itself.
func (a *Authorizer) callback(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()
	state := query.Get("state")
	a.mu.Lock()
	pending := a.pending[state]
	a.mu.Unlock()
	if pending == nil {
		writeCallbackPage(w, http.StatusNotFound, "Kaja is not waiting for this sign-in.")
		return
	}

	err := a.finish(pending, query)
	a.settle(state, err)
	if err != nil {
		writeCallbackPage(w, http.StatusBadRequest, err.Error())
		return
	}
	writeCallbackPage(w, http.StatusOK, "Kaja is signed in. You can close this tab.")
}

// finish validates what came back and exchanges the code for a token. The issuer
// is checked before the code goes anywhere: an error response from the wrong
// server is one kaja must not even repeat.
func (a *Authorizer) finish(pending *flow, query url.Values) error {
	if err := checkIssuedBy(pending.server, query.Get("iss")); err != nil {
		return err
	}
	if failure := query.Get("error"); failure != "" {
		if description := query.Get("error_description"); description != "" {
			return fmt.Errorf("the authorization server refused: %s: %s", failure, description)
		}
		return fmt.Errorf("the authorization server refused: %s", failure)
	}
	code := query.Get("code")
	if code == "" {
		return fmt.Errorf("the authorization server sent no code back")
	}

	form := url.Values{}
	form.Set("grant_type", "authorization_code")
	form.Set("code", code)
	form.Set("redirect_uri", pending.redirect)
	form.Set("code_verifier", pending.proof.verifier)
	form.Set("resource", pending.resource)
	issued, err := requestToken(a.client, pending.server, pending.registered, form)
	if err != nil {
		return err
	}
	if issued.Scope == "" {
		issued.Scope = pending.scope
	}
	return a.store.SaveGrant(pending.resource, &grant{
		Server:   pending.server,
		Token:    issued,
		ClientID: pending.registered.ClientID,
	})
}

// settle reports a flow's outcome once and lets go of it, closing the listener
// with the last one.
func (a *Authorizer) settle(state string, err error) {
	a.mu.Lock()
	pending := a.pending[state]
	if pending == nil {
		a.mu.Unlock()
		return
	}
	delete(a.pending, state)
	closing := a.listener
	if len(a.pending) > 0 {
		closing = nil
	} else {
		a.listener = nil
	}
	a.mu.Unlock()

	pending.timer.Stop()
	close(pending.stop)
	pending.done <- err
	close(pending.done)
	if closing != nil {
		_ = closing.Close()
	}
}

// Wait reports how a sign-in went, giving up on it when the caller does.
func (a *Authorizer) Wait(ctx context.Context, done <-chan error) error {
	select {
	case err := <-done:
		return err
	case <-ctx.Done():
		a.Cancel(done)
		return ctx.Err()
	}
}

func writeCallbackPage(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(status)
	fmt.Fprintf(w, `<!doctype html><meta charset="utf-8"><title>Kaja</title>`+
		`<body style="font:14px system-ui;margin:3rem auto;max-width:32rem;text-align:center">%s</body>`,
		html.EscapeString(message))
}

// oauthCredential is what an app with `auth: "oauth"` sends: a bearer token read
// from the store as the call is made, so a renewed one is used without the app
// being opened again.
func (a *Authorizer) oauthCredential(endpoint string) func() (map[string]string, error) {
	return func() (map[string]string, error) {
		token, err := a.Token(endpoint)
		if err != nil {
			return nil, err
		}
		return map[string]string{"Authorization": "Bearer " + token}, nil
	}
}
