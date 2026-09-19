package mcp

// The client ids kaja ships, keyed by the authorization server that issued them.
//
// A client id is not a credential. It is a public name, and a public client
// proves itself with PKCE rather than with a secret, so one belongs in the
// source the way a redirect URI does and there is nothing to be gained by
// keeping it out.
//
// An entry exists for a server that issues a client to nobody: it registers none
// on demand and reads no client ID metadata document, which leaves a client
// somebody registered by hand as the only way in. Asking each person to register
// their own is a form to fill in before kaja can be used at all, so kaja
// registered one and ships it.
//
// What a person configured outranks anything here, which is what makes an entry
// a default rather than a decision.
var builtInClients = map[string]string{
	// Kaja, an OAuth app registered by kaja-tools. GitHub's own MCP server
	// declares the classic scopes that only an OAuth app can be granted, so a
	// GitHub app - which has permissions instead, and reaches only what it is
	// installed on - could not stand in for it.
	"https://github.com/login/oauth": "Ov23li6bDZlzKlA8sKTe",
}

// builtInClient is the client kaja ships for an authorization server, or nothing
// where it ships none.
func builtInClient(issuer string) *registration {
	for known, id := range builtInClients {
		if sameIssuer(known, issuer) {
			return &registration{ClientID: id}
		}
	}
	return nil
}
