package mcp

import (
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestParseChallenge(t *testing.T) {
	parsed := parseChallenge(`Bearer resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource", scope="files:read files:write", error_description="Needs a token, please"`)
	if got := parsed["resource_metadata"]; got != "https://mcp.example.com/.well-known/oauth-protected-resource" {
		t.Errorf("resource_metadata = %q", got)
	}
	if got := parsed["scope"]; got != "files:read files:write" {
		t.Errorf("scope = %q", got)
	}
	// A comma inside a quoted value belongs to the sentence, not to the list.
	if got := parsed["error_description"]; got != "Needs a token, please" {
		t.Errorf("error_description = %q", got)
	}
	if len(parseChallenge("")) != 0 {
		t.Error("expected an absent header to read as no parameters")
	}
}

func TestCanonicalResource(t *testing.T) {
	cases := map[string]string{
		"https://MCP.Example.com/mcp":      "https://mcp.example.com/mcp",
		"https://mcp.example.com:443/mcp/": "https://mcp.example.com/mcp",
		"https://mcp.example.com":          "https://mcp.example.com",
		"https://mcp.example.com/mcp#top":  "https://mcp.example.com/mcp",
	}
	for raw, want := range cases {
		got, err := canonicalResource(raw)
		if err != nil {
			t.Fatalf("canonicalResource(%q): %v", raw, err)
		}
		if got != want {
			t.Errorf("canonicalResource(%q) = %q, want %q", raw, got, want)
		}
	}
	if _, err := canonicalResource("mcp.example.com"); err == nil {
		t.Error("expected a URL with no scheme to be refused")
	}
}

func TestProtectedResourceURLs(t *testing.T) {
	// A challenge that named the document is the only place asked.
	named := protectedResourceURLs("https://mcp.example.com/mcp", "https://elsewhere.example/prm")
	if !reflect.DeepEqual(named, []string{"https://elsewhere.example/prm"}) {
		t.Errorf("named = %#v", named)
	}
	// Without one, the path-carrying form first: a host may serve more than one.
	got := protectedResourceURLs("https://example.com/public/mcp", "")
	want := []string{
		"https://example.com/.well-known/oauth-protected-resource/public/mcp",
		"https://example.com/.well-known/oauth-protected-resource",
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("got %#v, want %#v", got, want)
	}
	if got := protectedResourceURLs("https://example.com", ""); len(got) != 1 {
		t.Errorf("a server at the root has one place to look, got %#v", got)
	}
}

// Both well-known forms are asked, and the one the failure names is the first:
// the fallback answering "nothing here" says nothing about this server.
func TestDiscoveryNamesTheAddressItLookedAtFirst(t *testing.T) {
	asked := []string{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		asked = append(asked, r.URL.Path)
		if r.URL.Path == "/.well-known/oauth-protected-resource/v1/mcp" {
			http.Error(w, "boom", http.StatusInternalServerError)
			return
		}
		http.NotFound(w, r)
	}))
	defer server.Close()

	_, err := testAuthorizer(t).readProtectedResource(server.URL+"/v1/mcp", "")
	if err == nil {
		t.Fatal("expected the discovery to fail")
	}
	if len(asked) != 2 {
		t.Errorf("asked = %v, want both well-known forms", asked)
	}
	if !strings.Contains(err.Error(), "/.well-known/oauth-protected-resource/v1/mcp") {
		t.Errorf("err = %v, want the address it looked at first", err)
	}
	if strings.Contains(err.Error(), "404") {
		t.Errorf("err = %v, want the fallback's answer left out", err)
	}
}

func TestAuthorizationServerURLs(t *testing.T) {
	got, err := authorizationServerURLs("https://auth.example.com/tenant1")
	if err != nil {
		t.Fatalf("authorizationServerURLs: %v", err)
	}
	want := []string{
		"https://auth.example.com/.well-known/oauth-authorization-server/tenant1",
		"https://auth.example.com/.well-known/openid-configuration/tenant1",
		"https://auth.example.com/tenant1/.well-known/openid-configuration",
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("got %#v, want %#v", got, want)
	}
	got, err = authorizationServerURLs("https://auth.example.com")
	if err != nil {
		t.Fatalf("authorizationServerURLs: %v", err)
	}
	want = []string{
		"https://auth.example.com/.well-known/oauth-authorization-server",
		"https://auth.example.com/.well-known/openid-configuration",
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("got %#v, want %#v", got, want)
	}
}

// RFC 9207: an `iss` that arrived is checked whatever the metadata says, and one
// that did not is only missing where the server said it would send one.
func TestCheckIssuedBy(t *testing.T) {
	server := &authorizationServer{Issuer: "https://auth.example.com"}
	if err := checkIssuedBy(server, ""); err != nil {
		t.Errorf("a server that promises no iss is not missing one: %v", err)
	}
	if err := checkIssuedBy(server, "https://auth.example.com"); err != nil {
		t.Errorf("the recorded issuer: %v", err)
	}
	if err := checkIssuedBy(server, "https://attacker.example"); err == nil {
		t.Error("expected another issuer to be refused")
	}
	promised := &authorizationServer{Issuer: "https://auth.example.com", IssParameterSupported: true}
	if err := checkIssuedBy(promised, ""); err == nil {
		t.Error("expected a promised iss to be required")
	}
}

func TestPickScope(t *testing.T) {
	resource := &protectedResource{ScopesSupported: []string{"files:read", "files:write"}}
	if got := pickScope("files:write", "everything", resource); got != "files:write" {
		t.Errorf("the challenge is authoritative, got %q", got)
	}
	if got := pickScope("", "mine", resource); got != "mine" {
		t.Errorf("what the app asks for, got %q", got)
	}
	if got := pickScope("", "", resource); got != "files:read files:write" {
		t.Errorf("what the resource says it needs, got %q", got)
	}
	if got := pickScope("", "", nil); got != "" {
		t.Errorf("nothing to ask for, got %q", got)
	}
}

// fakeAuthorization is an authorization server and the resource it guards, as
// far as the flow reads them.
type fakeAuthorization struct {
	as       *httptest.Server
	resource *httptest.Server
	// registered records that the client was registered here rather than given.
	registered bool
	// lastForm is the token request the flow last made.
	lastForm url.Values
	// authorized turns the resource's answers from 401 into something readable.
	authorized   bool
	issueRefresh bool
	expiresIn    int64
	// device turns the server into one that offers the device grant.
	device bool
	// pending is how many times the token endpoint says the person has not
	// answered yet, and the answer it gives while they haven't.
	pending        int
	pendingRefusal string
	// deviceForms is every token request the device grant made.
	deviceForms []url.Values
}

func newFakeAuthorization(t *testing.T) *fakeAuthorization {
	t.Helper()
	fake := &fakeAuthorization{expiresIn: 3600}

	asMux := http.NewServeMux()
	fake.as = httptest.NewServer(asMux)
	t.Cleanup(fake.as.Close)

	resourceMux := http.NewServeMux()
	fake.resource = httptest.NewServer(resourceMux)
	t.Cleanup(fake.resource.Close)

	asMux.HandleFunc("GET /.well-known/oauth-authorization-server", func(w http.ResponseWriter, r *http.Request) {
		document := map[string]any{
			"issuer":                           fake.as.URL,
			"authorization_endpoint":           fake.as.URL + "/authorize",
			"token_endpoint":                   fake.as.URL + "/token",
			"registration_endpoint":            fake.as.URL + "/register",
			"code_challenge_methods_supported": []string{"S256"},
			"authorization_response_iss_parameter_supported": true,
		}
		if fake.device {
			document["device_authorization_endpoint"] = fake.as.URL + "/device"
		}
		writeJSON(w, document)
	})
	asMux.HandleFunc("POST /device", func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseForm()
		fake.lastForm = r.PostForm
		writeJSON(w, map[string]any{
			"device_code":      "the-device-code",
			"user_code":        "WDJB-MJHT",
			"verification_uri": fake.as.URL + "/activate",
			"expires_in":       900,
			// A test is not waiting the default five seconds between polls.
			"interval": 1,
		})
	})
	asMux.HandleFunc("POST /register", func(w http.ResponseWriter, r *http.Request) {
		fake.registered = true
		writeJSON(w, map[string]any{"client_id": "registered-client"})
	})
	asMux.HandleFunc("POST /token", func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseForm()
		fake.lastForm = r.PostForm
		if r.PostForm.Get("grant_type") == deviceGrantType {
			fake.deviceForms = append(fake.deviceForms, r.PostForm)
			if fake.pending > 0 {
				fake.pending--
				// The refusal comes back with a 200, which is what GitHub does and
				// what a status therefore cannot be read as a verdict.
				writeJSON(w, map[string]any{"error": fake.pendingRefusal})
				return
			}
		}
		answer := map[string]any{"access_token": "token-" + r.PostForm.Get("grant_type"), "token_type": "Bearer", "expires_in": fake.expiresIn}
		if fake.issueRefresh {
			answer["refresh_token"] = "refresh-1"
		}
		writeJSON(w, answer)
	})

	resourceMux.HandleFunc("POST /mcp", func(w http.ResponseWriter, r *http.Request) {
		if !fake.authorized {
			w.Header().Set("WWW-Authenticate", fmt.Sprintf(`Bearer resource_metadata=%q, scope="files:read"`,
				fake.resource.URL+"/.well-known/oauth-protected-resource/mcp"))
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		writeJSON(w, map[string]any{"jsonrpc": "2.0", "id": 1, "result": map[string]any{"tools": []any{}}})
	})
	resourceMux.HandleFunc("GET /.well-known/oauth-protected-resource/mcp", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, map[string]any{
			"resource":              fake.resource.URL + "/mcp",
			"authorization_servers": []string{fake.as.URL},
			"scopes_supported":      []string{"files:read"},
		})
	})
	return fake
}

func (f *fakeAuthorization) endpoint() string { return f.resource.URL + "/mcp" }

func writeJSON(w http.ResponseWriter, body any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(body)
}

func testAuthorizer(t *testing.T) *Authorizer {
	t.Helper()
	authorizer := NewAuthorizer(NewTokenStore(filepath.Join(t.TempDir(), "mcp-oauth.json")), &http.Client{Timeout: 5 * time.Second})
	// The fixed port is what an authorization server is registered against; a test
	// takes whatever the OS has spare.
	authorizer.port = 0
	return authorizer
}

// The whole flow, with the browser's part done by hand: kaja reads the challenge,
// finds the authorization server, registers itself, and exchanges the code the
// redirect brings back for a token it keeps.
func TestSignsInAndKeepsTheToken(t *testing.T) {
	fake := newFakeAuthorization(t)
	authorizer := testAuthorizer(t)

	prompt, done, err := authorizer.Begin(AppAuthorization{Endpoint: fake.endpoint()})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if !fake.registered {
		t.Error("expected kaja to register itself where no client id was given")
	}

	opened, err := url.Parse(prompt.URL)
	if err != nil {
		t.Fatalf("the authorization URL: %v", err)
	}
	query := opened.Query()
	if query.Get("code_challenge_method") != "S256" || query.Get("code_challenge") == "" {
		t.Error("expected the request to be proved with PKCE")
	}
	if got := query.Get("resource"); got != fake.endpoint() {
		t.Errorf("resource = %q, want the server the token is for", got)
	}
	if got := query.Get("scope"); got != "files:read" {
		t.Errorf("scope = %q, want what the challenge asked for", got)
	}
	if got := query.Get("client_id"); got != "registered-client" {
		t.Errorf("client_id = %q", got)
	}

	sendBack(t, authorizer, query.Get("redirect_uri"), url.Values{
		"code":  {"the-code"},
		"state": {query.Get("state")},
		"iss":   {fake.as.URL},
	})
	if err := <-done; err != nil {
		t.Fatalf("the sign-in: %v", err)
	}

	if fake.lastForm.Get("grant_type") != "authorization_code" || fake.lastForm.Get("code_verifier") == "" {
		t.Errorf("the token request = %v", fake.lastForm)
	}
	if got := fake.lastForm.Get("resource"); got != fake.endpoint() {
		t.Errorf("the token was not asked for one server: resource = %q", got)
	}

	if !authorizer.SignedIn(fake.endpoint()) {
		t.Fatal("expected the token to be kept")
	}
	token, err := authorizer.Token(fake.endpoint())
	if err != nil {
		t.Fatalf("Token: %v", err)
	}
	if token != "token-authorization_code" {
		t.Errorf("token = %q", token)
	}

	if err := authorizer.Forget(fake.endpoint()); err != nil {
		t.Fatalf("Forget: %v", err)
	}
	if authorizer.SignedIn(fake.endpoint()) {
		t.Error("expected signing out to drop the token")
	}
}

// An authorization response from another issuer is refused before the code is
// sent anywhere, which is the whole point of recording the issuer first.
func TestRefusesAnAnswerFromAnotherIssuer(t *testing.T) {
	fake := newFakeAuthorization(t)
	authorizer := testAuthorizer(t)

	prompt, done, err := authorizer.Begin(AppAuthorization{Endpoint: fake.endpoint()})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	query := mustQuery(t, prompt.URL)
	sendBack(t, authorizer, query.Get("redirect_uri"), url.Values{
		"code":  {"the-code"},
		"state": {query.Get("state")},
		"iss":   {"https://attacker.example"},
	})
	err = <-done
	if err == nil || !strings.Contains(err.Error(), "attacker.example") {
		t.Fatalf("expected the answer to be refused, got %v", err)
	}
	if fake.lastForm != nil {
		t.Error("expected the code never to be sent")
	}
}

// A token near its end is renewed where the server issued something to renew it
// with, on the call rather than on the next time the app is opened.
func TestRenewsAnExpiredToken(t *testing.T) {
	fake := newFakeAuthorization(t)
	fake.issueRefresh = true
	fake.expiresIn = 1
	authorizer := testAuthorizer(t)

	prompt, done, err := authorizer.Begin(AppAuthorization{Endpoint: fake.endpoint()})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	query := mustQuery(t, prompt.URL)
	sendBack(t, authorizer, query.Get("redirect_uri"), url.Values{
		"code":  {"the-code"},
		"state": {query.Get("state")},
		"iss":   {fake.as.URL},
	})
	if err := <-done; err != nil {
		t.Fatalf("the sign-in: %v", err)
	}

	if _, err := authorizer.Token(fake.endpoint()); err != nil {
		t.Fatalf("Token: %v", err)
	}
	if got := fake.lastForm.Get("grant_type"); got != "refresh_token" {
		t.Errorf("grant_type = %q, want the token to have been renewed", got)
	}
	if got := fake.lastForm.Get("refresh_token"); got != "refresh-1" {
		t.Errorf("refresh_token = %q", got)
	}
}

// A client id the person already has is used as it stands, which is how a server
// that registers nobody - and a client ID metadata document - is reached.
func TestUsesAClientIdOfYourOwn(t *testing.T) {
	fake := newFakeAuthorization(t)
	authorizer := testAuthorizer(t)

	prompt, _, err := authorizer.Begin(AppAuthorization{Endpoint: fake.endpoint(), ClientID: "https://kaja.example/client.json"})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if fake.registered {
		t.Error("expected no registration where a client id was given")
	}
	if got := mustQuery(t, prompt.URL).Get("client_id"); got != "https://kaja.example/client.json" {
		t.Errorf("client_id = %q", got)
	}
}

func TestBuiltInClient(t *testing.T) {
	shipped := builtInClient("https://github.com/login/oauth")
	if shipped == nil || shipped.ClientID == "" {
		t.Fatal("expected kaja to ship a client for GitHub")
	}
	if shipped.ClientSecret != "" {
		t.Error("a client kaja ships is public and proves itself with PKCE")
	}
	if builtInClient("https://github.com/login/oauth/") == nil {
		t.Error("expected a trailing slash to name the same issuer")
	}
	if builtInClient("https://auth.example.com") != nil {
		t.Error("expected nothing to be shipped for a server kaja has never met")
	}
	// GitHub refuses a code exchange carrying no client secret, whoever the
	// client is, so the device grant is the only one a sign-in there can finish.
	if !knownServer("https://github.com/login/oauth").Device {
		t.Error("expected GitHub to be signed in to with the device grant")
	}
}

// What reaches a server that registers nobody, with no form to fill in first.
func TestUsesTheClientIdKajaShips(t *testing.T) {
	fake := newFakeAuthorization(t)
	shipsClient(t, fake.as.URL, "shipped-client")
	authorizer := testAuthorizer(t)

	prompt, _, err := authorizer.Begin(AppAuthorization{Endpoint: fake.endpoint()})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if fake.registered {
		t.Error("expected no registration where kaja ships a client")
	}
	if got := mustQuery(t, prompt.URL).Get("client_id"); got != "shipped-client" {
		t.Errorf("client_id = %q", got)
	}
}

func TestAConfiguredClientIdOutranksTheOneKajaShips(t *testing.T) {
	fake := newFakeAuthorization(t)
	shipsClient(t, fake.as.URL, "shipped-client")
	authorizer := testAuthorizer(t)

	prompt, _, err := authorizer.Begin(AppAuthorization{Endpoint: fake.endpoint(), ClientID: "mine"})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if got := mustQuery(t, prompt.URL).Get("client_id"); got != "mine" {
		t.Errorf("client_id = %q", got)
	}
}

// Neither a shipped nor a configured client is in the store, so a renewal that
// looked for one there sent no client id at all.
func TestRenewsWithTheClientTheTokenWasIssuedTo(t *testing.T) {
	fake := newFakeAuthorization(t)
	fake.issueRefresh = true
	fake.expiresIn = 1
	authorizer := testAuthorizer(t)

	prompt, done, err := authorizer.Begin(AppAuthorization{Endpoint: fake.endpoint(), ClientID: "mine"})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	query := mustQuery(t, prompt.URL)
	sendBack(t, authorizer, query.Get("redirect_uri"), url.Values{
		"code": {"the-code"}, "state": {query.Get("state")}, "iss": {fake.as.URL},
	})
	if err := <-done; err != nil {
		t.Fatalf("the sign-in: %v", err)
	}

	if _, err := authorizer.Token(fake.endpoint()); err != nil {
		t.Fatalf("Token: %v", err)
	}
	if got := fake.lastForm.Get("grant_type"); got != "refresh_token" {
		t.Fatalf("grant_type = %q, want the token to have been renewed", got)
	}
	if got := fake.lastForm.Get("client_id"); got != "mine" {
		t.Errorf("client_id = %q, want the client the token was issued to", got)
	}
}

// A server that refuses a public client's code exchange is signed in to with the
// device grant instead: kaja asks for a code, the person types it somewhere else,
// and the token endpoint is asked until they have.
func TestSignsInWithTheDeviceGrant(t *testing.T) {
	fake := newFakeAuthorization(t)
	fake.device = true
	fake.pending = 1
	fake.pendingRefusal = "authorization_pending"
	shipsServer(t, fake.as.URL, builtInServer{ClientID: "shipped-client", Device: true})
	authorizer := testAuthorizer(t)

	prompt, done, err := authorizer.Begin(AppAuthorization{Endpoint: fake.endpoint()})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if prompt.UserCode != "WDJB-MJHT" {
		t.Errorf("user code = %q, want the code the person types", prompt.UserCode)
	}
	if prompt.URL != fake.as.URL+"/activate" {
		t.Errorf("page = %q, want where the code is typed", prompt.URL)
	}
	if got := fake.lastForm.Get("client_id"); got != "shipped-client" {
		t.Errorf("client_id = %q", got)
	}
	if authorizer.listener != nil {
		t.Error("expected no loopback listener: nothing is being sent back to one")
	}

	if err := <-done; err != nil {
		t.Fatalf("the sign-in: %v", err)
	}
	if len(fake.deviceForms) != 2 {
		t.Fatalf("polled %d times, want one refusal and one token", len(fake.deviceForms))
	}
	asked := fake.deviceForms[len(fake.deviceForms)-1]
	if asked.Get("device_code") != "the-device-code" || asked.Get("client_secret") != "" {
		t.Errorf("the token request = %v, want the device code and no secret", asked)
	}
	token, err := authorizer.Token(fake.endpoint())
	if err != nil {
		t.Fatalf("Token: %v", err)
	}
	if token != "token-"+deviceGrantType {
		t.Errorf("token = %q", token)
	}
}

// Everything but `authorization_pending` and `slow_down` ends the flow, and a
// refusal carried by a 200 is still a refusal.
func TestADeviceGrantStopsOnARefusal(t *testing.T) {
	fake := newFakeAuthorization(t)
	fake.device = true
	fake.pending = 3
	fake.pendingRefusal = "access_denied"
	shipsServer(t, fake.as.URL, builtInServer{ClientID: "shipped-client", Device: true})
	authorizer := testAuthorizer(t)

	_, done, err := authorizer.Begin(AppAuthorization{Endpoint: fake.endpoint()})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	err = <-done
	if err == nil || !strings.Contains(err.Error(), "access_denied") {
		t.Fatalf("the sign-in = %v, want the refusal said as it stands", err)
	}
	if len(fake.deviceForms) != 1 {
		t.Errorf("polled %d times, want a refusal not to be asked again", len(fake.deviceForms))
	}
}

// The redirect flow is what a server that registers clients gets, device grant
// advertised or not: it is the one that needs nothing typed across.
func TestADeviceEndpointAloneIsNotTheDeviceGrant(t *testing.T) {
	fake := newFakeAuthorization(t)
	fake.device = true
	authorizer := testAuthorizer(t)

	prompt, done, err := authorizer.Begin(AppAuthorization{Endpoint: fake.endpoint()})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	t.Cleanup(func() { authorizer.Cancel(done) })
	if prompt.UserCode != "" {
		t.Errorf("user code = %q, want the browser to carry the answer back", prompt.UserCode)
	}
	if mustQuery(t, prompt.URL).Get("code_challenge") == "" {
		t.Error("expected the redirect flow")
	}
}

// A token endpoint that answers 200 with an error in it is answering with a
// refusal, and the refusal is what a sign-in reports.
func TestReadsARefusalCarriedByA200(t *testing.T) {
	refusal := readTokenRefusal([]byte(`{"error":"incorrect_client_credentials","error_description":"The client_id and/or client_secret passed are incorrect."}`))
	if refusal == nil {
		t.Fatal("expected an error body to read as a refusal")
	}
	if !strings.Contains(refusal.Error(), "incorrect_client_credentials") || !strings.Contains(refusal.Error(), "client_secret") {
		t.Errorf("the refusal reads %q", refusal.Error())
	}
	if readTokenRefusal([]byte(`{"access_token":"a-token"}`)) != nil {
		t.Error("expected a token to read as no refusal")
	}
}

func TestFallsBackToAFreePortWhenTheFixedOneIsTaken(t *testing.T) {
	taken, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("holding a port: %v", err)
	}
	defer taken.Close()
	held := taken.Addr().(*net.TCPAddr).Port

	authorizer := testAuthorizer(t)
	authorizer.port = held
	if err := authorizer.listen(); err != nil {
		t.Fatalf("listen: %v", err)
	}
	t.Cleanup(func() {
		if authorizer.listener != nil {
			_ = authorizer.listener.Close()
		}
	})
	if got := authorizer.redirectURI(); strings.Contains(got, fmt.Sprintf(":%d%s", held, callbackPath)) {
		t.Errorf("redirectURI = %q, want a port that was free", got)
	}
}

func shipsClient(t *testing.T, issuer, id string) {
	t.Helper()
	shipsServer(t, issuer, builtInServer{ClientID: id})
}

func shipsServer(t *testing.T, issuer string, entry builtInServer) {
	t.Helper()
	builtInServers[issuer] = entry
	t.Cleanup(func() { delete(builtInServers, issuer) })
}

func mustQuery(t *testing.T, target string) url.Values {
	t.Helper()
	parsed, err := url.Parse(target)
	if err != nil {
		t.Fatalf("the authorization URL: %v", err)
	}
	return parsed.Query()
}

// sendBack is the browser's half: the authorization server redirecting the person
// to the loopback address kaja is listening on.
func sendBack(t *testing.T, authorizer *Authorizer, redirect string, query url.Values) {
	t.Helper()
	response, err := http.Get(redirect + "?" + query.Encode())
	if err != nil {
		t.Fatalf("the redirect back: %v", err)
	}
	defer response.Body.Close()
}

// An app configured to sign in sends the token kaja holds, read as the call is
// made rather than held from when the app was opened.
func TestAnAppSignedInSendsItsToken(t *testing.T) {
	fake := newFakeAuthorization(t)
	authorizer := testAuthorizer(t)

	prompt, done, err := authorizer.Begin(AppAuthorization{Endpoint: fake.endpoint()})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	query := mustQuery(t, prompt.URL)
	sendBack(t, authorizer, query.Get("redirect_uri"), url.Values{
		"code": {"the-code"}, "state": {query.Get("state")}, "iss": {fake.as.URL},
	})
	if err := <-done; err != nil {
		t.Fatalf("the sign-in: %v", err)
	}

	credential, err := credentialSource(map[string]string{"url": fake.endpoint(), "auth": AuthOAuth}, authorizer)
	if err != nil {
		t.Fatalf("credentialSource: %v", err)
	}
	headers, err := credential()
	if err != nil {
		t.Fatalf("the credential: %v", err)
	}
	if got := headers["Authorization"]; got != "Bearer token-authorization_code" {
		t.Errorf("Authorization = %q", got)
	}
}

// A build with nowhere to keep a sign-in says so where the credential is asked
// for, rather than opening an app that would be refused on every call.
func TestAnAppCannotSignInWithoutAnAuthorizer(t *testing.T) {
	if _, err := credentialSource(map[string]string{"url": "https://example.com/mcp", "auth": AuthOAuth}, nil); err == nil {
		t.Fatal("expected the app to refuse to open")
	}
}

// Signing in is what puts a token there. Until then the call says so rather than
// going out without one.
func TestAnAppNotSignedInSaysSo(t *testing.T) {
	authorizer := testAuthorizer(t)
	credential, err := credentialSource(map[string]string{"url": "https://example.com/mcp", "auth": AuthOAuth}, authorizer)
	if err != nil {
		t.Fatalf("credentialSource: %v", err)
	}
	if _, err := credential(); err == nil || !strings.Contains(err.Error(), "not signed in") {
		t.Errorf("expected the call to say it is not signed in, got %v", err)
	}
}
