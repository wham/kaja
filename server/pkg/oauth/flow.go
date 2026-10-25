package oauth

import (
	"context"
	"fmt"
	"html"
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

// Authorizer runs an OAuth sign-in and holds what it produced. It is MCP's
// authorization flow, which is also what an API kaja knows the issuer of is
// signed in to: that one skips the discovery and starts at the issuer.
//
// A flow is two halves with a browser in between: `Begin` does the discovery and
// hands back a URL to open, and the loopback listener takes the redirect that
// comes back. Only the halves are here; who opens the URL is the window's
// business, since the desktop and a browser open one differently.
type Authorizer struct {
	store  Store
	client *http.Client

	// renewing serializes renewals, because two calls finding one token expired
	// would otherwise each spend the refresh token, and a server that rotates them
	// takes the second as a replay.
	renewing sync.Mutex

	// port is the loopback port the redirect comes back on. Zero asks the OS for
	// one, which only a test does: an authorization server is registered against
	// one address and has to be sent back to it.
	port int

	mu       sync.Mutex
	pending  map[string]*flow
	listener net.Listener
	// sent is the token last handed out under each name, so it can be masked out
	// of what an app reports having sent: it is never a variable's value, which
	// is what everything else is masked by.
	sent map[string]string
}

// flow is one sign-in in progress: what it will need to finish, and where to say
// it has.
type flow struct {
	// name is the variable the sign-in is kept under.
	name     string
	resource string
	// audience is the resource a token is asked for, which is the endpoint or
	// the parent its metadata says one token covers.
	audience   string
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
	// ctx is the request the sign-in was begun on. The grant is kept where that
	// request keeps its values, and the redirect that finishes the flow arrives on a
	// request of its own that carries none.
	ctx context.Context
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
	// Credential is the app's credential as it names its sign-in: "${NAME}", NAME
	// being the variable the sign-in is kept in.
	Credential string
	// Endpoint is what the token is for and the only address it is sent to.
	Endpoint string
	// Issuer is the authorization server, where kaja knows it rather than
	// discovering it. Empty reads it off the endpoint's resource metadata.
	Issuer string
	// Probe asks the endpoint for the challenge an unauthenticated request is
	// answered with, a `WWW-Authenticate` value or nothing. What such a request
	// is depends on what the endpoint speaks, which is why the app supplies it.
	Probe func(client *http.Client) string
	// ClientID is a client of the person's own: one an authorization server's
	// dashboard issued them, or the https URL of a client ID metadata document.
	// Empty asks the server to register kaja itself.
	ClientID string
	Scope    string
}

func NewAuthorizer(store Store, client *http.Client) *Authorizer {
	if client == nil {
		client = &http.Client{Timeout: requestTimeout}
	}
	return &Authorizer{store: store, client: client, port: callbackPort, pending: map[string]*flow{}, sent: map[string]string{}}
}

// Begin discovers everything a sign-in needs and hands back the page to open and
// a channel that reports how it went. Nothing is stored until the flow finishes:
// a sign-in that is never completed leaves no trace.
func (a *Authorizer) Begin(ctx context.Context, app AppAuthorization) (SignInPrompt, <-chan error, error) {
	name, err := signInSlot(app.Credential)
	if err != nil {
		return SignInPrompt{}, nil, err
	}
	if a.store == nil || !a.store.Available(ctx) {
		return SignInPrompt{}, nil, fmt.Errorf("this machine has nowhere to keep a sign-in")
	}
	resource, err := canonicalResource(app.Endpoint)
	if err != nil {
		return SignInPrompt{}, nil, err
	}

	var server *authorizationServer
	var described *protectedResource
	audience := resource
	challenged := challenge{}
	if app.Issuer != "" {
		server, err = a.readAuthorizationServer(app.Issuer)
	} else {
		if app.Probe != nil {
			challenged = parseChallenge(app.Probe(a.client))
		}
		server, described, audience, err = a.signInAt(app.Endpoint, resource, challenged["resource_metadata"])
	}
	if err != nil {
		return SignInPrompt{}, nil, err
	}
	scope := pickScope(challenged["scope"], app.Scope, described)

	if usesDeviceGrant(server) {
		registered := a.heldClient(ctx, server, app.ClientID, name)
		if registered == nil {
			return SignInPrompt{}, nil, fmt.Errorf("the authorization server registers no clients, so it needs a client id of your own")
		}
		return a.beginDevice(ctx, name, resource, audience, scope, server, registered)
	}

	// The listener comes first, because the address it is on is what kaja is
	// registered against and what the authorization request has to name.
	if err := a.listen(); err != nil {
		return SignInPrompt{}, nil, err
	}
	redirect := a.redirectURI()

	registered, err := a.clientFor(ctx, server, app.ClientID, name, scope, redirect)
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
	target, err := authorizationURL(server, registered.ClientID, redirect, scope, audience, state, proof)
	if err != nil {
		return SignInPrompt{}, nil, err
	}

	pending := &flow{
		name:       name,
		resource:   resource,
		audience:   audience,
		scope:      scope,
		server:     server,
		registered: registered,
		proof:      proof,
		redirect:   redirect,
		done:       make(chan error, 1),
		stop:       make(chan struct{}),
		ctx:        ctx,
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

// Token is the access token an app's credential stands for, renewed where it has
// to be. It is asked for on every call rather than held, so a sign-in replaced
// or renewed elsewhere is used by the next call.
//
// A credential naming a variable reads the sign-in kept there, which is sent to
// the resource it was issued for and nowhere else. Anything else is a token the
// variable resolved to from the environment, where a kaja with nowhere to keep
// a sign-in is handed one somebody made by hand.
func (a *Authorizer) Token(ctx context.Context, credential string, endpoint string) (string, error) {
	resource, err := canonicalResource(endpoint)
	if err != nil {
		return "", err
	}
	name, ok := SignInName(credential)
	if !ok {
		if token := strings.TrimSpace(credential); token != "" {
			return token, nil
		}
		return "", fmt.Errorf("the app names no variable to keep its sign-in in; sign in from the app's settings")
	}

	a.renewing.Lock()
	defer a.renewing.Unlock()

	held := readGrant(ctx, a.store, name)
	if held == nil {
		return "", fmt.Errorf("${%s} holds no sign-in on this device; sign in from the app's settings", name)
	}
	if held.Resource != resource {
		return "", fmt.Errorf("${%s} is a sign-in to %s rather than to %s; sign in again", name, held.Resource, resource)
	}
	if !held.Token.expired(time.Now()) {
		return a.handOut(name, held.Token.AccessToken), nil
	}

	renewed, err := a.renew(held)
	if err != nil {
		// The sign-in is shared with every device the workspace is on, so another
		// one may have renewed it first - and a server that rotates refresh tokens
		// refuses the one it replaced. What that device kept is the way on.
		latest := readGrant(ctx, a.store, name)
		if latest == nil || latest.Resource != resource || latest.Token.RefreshToken == held.Token.RefreshToken {
			return "", err
		}
		if !latest.Token.expired(time.Now()) {
			return a.handOut(name, latest.Token.AccessToken), nil
		}
		held = latest
		if renewed, err = a.renew(held); err != nil {
			return "", err
		}
	}
	held.Token = renewed
	if err := writeGrant(ctx, a.store, name, held); err != nil {
		return "", err
	}
	return a.handOut(name, renewed.AccessToken), nil
}

// renew asks for a new token with the refresh token a grant holds.
func (a *Authorizer) renew(held *grant) (*tokenSet, error) {
	if held.Token.RefreshToken == "" {
		return nil, fmt.Errorf("the token for %s has expired and the server issued nothing to renew it with; sign in again", held.Resource)
	}
	form := url.Values{}
	form.Set("grant_type", "refresh_token")
	form.Set("refresh_token", held.Token.RefreshToken)
	form.Set("resource", held.audience())
	if held.Token.Scope != "" {
		form.Set("scope", held.Token.Scope)
	}
	client := held.Client
	if client == nil {
		client = &registration{}
	}
	renewed, err := requestToken(a.client, held.Server, client, form)
	if err != nil {
		return nil, fmt.Errorf("renewing the token for %s: %w", held.Resource, err)
	}
	// A server that rotates refresh tokens sends the new one; one that doesn't
	// expects the old one to go on being used.
	if renewed.RefreshToken == "" {
		renewed.RefreshToken = held.Token.RefreshToken
	}
	if renewed.Scope == "" {
		renewed.Scope = held.Token.Scope
	}
	return renewed, nil
}

func (a *Authorizer) handOut(name string, token string) string {
	a.mu.Lock()
	a.sent[name] = token
	a.mu.Unlock()
	return token
}

// Sent is the token last handed out under each variable's name.
func (a *Authorizer) Sent() map[string]string {
	if a == nil {
		return nil
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	sent := make(map[string]string, len(a.sent))
	for name, token := range a.sent {
		sent[name] = token
	}
	return sent
}

// SignedIn reports whether an app's credential has a token to send to the
// endpoint, which is what the app form states beside the button.
func (a *Authorizer) SignedIn(ctx context.Context, credential string, endpoint string) bool {
	name, ok := SignInName(credential)
	if !ok {
		return strings.TrimSpace(credential) != ""
	}
	resource, err := canonicalResource(endpoint)
	if err != nil {
		return false
	}
	held := readGrant(ctx, a.store, name)
	return held != nil && held.Resource == resource
}

// Forget drops the sign-in an app's credential names, which is what signing out
// is. The variable stays: it is still where the app's sign-in goes.
func (a *Authorizer) Forget(ctx context.Context, credential string) error {
	name, ok := SignInName(credential)
	if !ok || a.store == nil {
		return nil
	}
	return a.store.Delete(ctx, name)
}

// signInAt is the authorization server to sign in at, the resource's own
// document where it published one, and the resource a token is asked for. A
// server that publishes no document is signed in to at its own origin: that is
// what the revision of MCP before RFC 9728 said an MCP server was, and a
// document served by the host the endpoint is on is the server's own word
// exactly as the missing one would have been.
func (a *Authorizer) signInAt(endpoint string, resource string, named string) (*authorizationServer, *protectedResource, string, error) {
	described, audience, missing := a.readProtectedResource(endpoint, resource, named)
	if missing == nil {
		server, err := a.readAuthorizationServer(described.AuthorizationServers[0])
		if err != nil {
			return nil, nil, "", err
		}
		return server, described, audience, nil
	}
	origin, err := serverOrigin(endpoint)
	if err != nil {
		return nil, nil, "", missing
	}
	// The missing document is what is reported when the fallback is not there
	// either: it is the one the specification asks this server for.
	server, err := a.readAuthorizationServer(origin)
	if err != nil {
		return nil, nil, "", missing
	}
	return server, nil, resource, nil
}

// readProtectedResource reads the document naming the authorization server that
// issues tokens for this resource, and the resource that document says a token
// is for. A document about something else - a sibling path, another host - is
// passed over rather than taken: a host serving several MCP endpoints may
// publish one per endpoint, and the path-carrying address is asked first so
// that each is found before the root's.
func (a *Authorizer) readProtectedResource(endpoint string, resource string, named string) (*protectedResource, string, error) {
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
		audience, ok := covers(described, resource)
		if !ok {
			if reported == nil {
				reported = fmt.Errorf("%s is about %q rather than about %q", target, described.Resource, resource)
			}
			continue
		}
		if len(described.AuthorizationServers) == 0 {
			if reported == nil {
				reported = fmt.Errorf("%s names no authorization server", target)
			}
			continue
		}
		return described, audience, nil
	}
	if reported == nil {
		reported = fmt.Errorf("%q is not a URL", endpoint)
	}
	return nil, "", fmt.Errorf("no protected resource metadata: %w", reported)
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
// then the one the sign-in kept under this name was issued to, then one
// registered now.
// A client id metadata document is the first of those - it is an https URL, so
// it is a client id the person has - and kaja hosts none of its own. What kaja
// ships outranks what it registered, a server it ships an id for being one that
// registers nobody.
func (a *Authorizer) clientFor(ctx context.Context, server *authorizationServer, configured string, name string, scope string, redirect string) (*registration, error) {
	if held := a.heldClient(ctx, server, configured, name); held != nil {
		return held, nil
	}
	return registerClient(a.client, server, redirect, scope)
}

// heldClient is the client kaja already has for a server - one the person
// configured, one kaja ships, or the one the sign-in under this name was issued
// to - or nothing, which is what registering is for. A registration is kept with
// the sign-in it was made for, so it travels and is dropped with it.
func (a *Authorizer) heldClient(ctx context.Context, server *authorizationServer, configured string, name string) *registration {
	if configured = strings.TrimSpace(configured); configured != "" {
		return &registration{ClientID: configured}
	}
	if shipped := builtInClient(server.Issuer); shipped != nil {
		return shipped
	}
	if held := readGrant(ctx, a.store, name); held != nil && held.Client != nil && held.Client.ClientID != "" && sameIssuer(held.Server.Issuer, server.Issuer) {
		return held.Client
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
	go func() {
		_ = (&http.Server{Handler: mux, ReadHeaderTimeout: 10 * time.Second, IdleTimeout: 120 * time.Second}).Serve(listener)
	}()
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
	form.Set("resource", pending.audience)
	issued, err := requestToken(a.client, pending.server, pending.registered, form)
	if err != nil {
		return err
	}
	if issued.Scope == "" {
		issued.Scope = pending.scope
	}
	return writeGrant(pending.ctx, a.store, pending.name, pending.grant(issued))
}

// grant is what a finished flow keeps: the token, and everything a renewal has
// to present with it.
func (f *flow) grant(issued *tokenSet) *grant {
	held := &grant{Resource: f.resource, Server: f.server, Token: issued, Client: f.registered}
	if f.audience != f.resource {
		held.Audience = f.audience
	}
	return held
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

// Credential is what an app that signed in sends: a bearer token read from where
// the sign-in is kept as the call is made, so a renewed one is used without the app being
// opened again.
func (a *Authorizer) Credential(credential string, endpoint string) func(ctx context.Context) (map[string]string, error) {
	return func(ctx context.Context) (map[string]string, error) {
		token, err := a.Token(ctx, credential, endpoint)
		if err != nil {
			return nil, err
		}
		return map[string]string{"Authorization": "Bearer " + token}, nil
	}
}
