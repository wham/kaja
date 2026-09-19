package mcp

// What kaja knows about particular authorization servers: the client it is
// identified as where the server issues one to nobody, and the grant to use
// where the redirect flow is one kaja cannot finish.
//
// A client id is a public name rather than a credential - a public client proves
// itself with PKCE - so one belongs in the source the way a redirect URI does.
// An entry exists only for a server kaja has had to learn something about,
// registering none on demand and reading no client ID metadata document.
var builtInServers = map[string]builtInServer{
	// An OAuth app rather than a GitHub app: GitHub's own MCP server declares the
	// classic scopes, which only an OAuth app can be granted.
	//
	// GitHub draws no line between a public client and a confidential one, so it
	// refuses the code exchange without a `client_secret` however the request was
	// proved - which is the whole of why the device grant is what kaja finishes a
	// sign-in with here.
	"https://github.com/login/oauth": {ClientID: "Ov23li6bDZlzKlA8sKTe", Device: true},
}

type builtInServer struct {
	// ClientID is the client kaja ships for this server.
	ClientID string
	// Device says the server's token endpoint refuses a client with no secret, so
	// the device grant - which asks for none - is the one grant kaja can carry
	// through. It applies to the server rather than to the client, because a
	// client id of the person's own runs into the same refusal.
	Device bool
}

// knownServer is what kaja knows about an issuer, or the zero value where it has
// never met one.
func knownServer(issuer string) builtInServer {
	for known, entry := range builtInServers {
		if sameIssuer(known, issuer) {
			return entry
		}
	}
	return builtInServer{}
}

// builtInClient is the client kaja ships for a server, where it ships one.
func builtInClient(issuer string) *registration {
	if id := knownServer(issuer).ClientID; id != "" {
		return &registration{ClientID: id}
	}
	return nil
}
