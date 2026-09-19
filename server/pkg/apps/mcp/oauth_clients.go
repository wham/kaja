package mcp

// The client ids kaja ships, keyed by the authorization server that issued them.
// A client id is a public name rather than a credential - a public client proves
// itself with PKCE - so one belongs in the source the way a redirect URI does.
// An entry exists only for a server that issues a client to nobody, registering
// none on demand and reading no client ID metadata document.
var builtInClients = map[string]string{
	// An OAuth app rather than a GitHub app: GitHub's own MCP server declares the
	// classic scopes, which only an OAuth app can be granted.
	"https://github.com/login/oauth": "Ov23li6bDZlzKlA8sKTe",
}

func builtInClient(issuer string) *registration {
	for known, id := range builtInClients {
		if sameIssuer(known, issuer) {
			return &registration{ClientID: id}
		}
	}
	return nil
}
