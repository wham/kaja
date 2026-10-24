package openapi

import (
	"net/url"
	"strings"
)

// What kaja knows about an API that its document does not say. GitHub's REST
// description declares no security at all - reported upstream in 2021 and closed
// unfixed - so every call went out anonymous and the form had nothing to offer.
//
// An entry is keyed by the server the document declares rather than by where the
// document was fetched from, because the credential belongs to the server: a copy
// of the description pinned to a commit is the same API. It supplies schemes only
// to a document declaring none, so a description that starts saying it outranks
// kaja.
type knownAPI struct {
	server  string
	schemes []suppliedScheme
}

type suppliedScheme struct {
	key    string
	scheme securityScheme
}

// signIn is a scheme kaja can carry through itself: the authorization server it
// signs in at, what it asks for, and the one resource the token may be sent to.
type signIn struct {
	issuer   string
	scope    string
	resource string
}

var knownAPIs = []knownAPI{
	{
		server: "https://api.github.com",
		schemes: []suppliedScheme{
			{key: "githubSignIn", scheme: securityScheme{
				Type:        "oauth2",
				Description: "Sign in with GitHub.",
				// The scopes GitHub's own MCP server asks for, which is this API underneath.
				signIn: &signIn{
					issuer:   "https://github.com/login/oauth",
					scope:    "repo read:org read:user user:email read:packages write:packages read:project project gist notifications",
					resource: "https://api.github.com",
				},
			}},
			{key: "personalAccessToken", scheme: securityScheme{
				Type:   "http",
				Scheme: "bearer",
			}},
		},
	},
}

// supplement adds the schemes kaja knows a document's server takes, where the
// document declares none of its own. It runs once, as the document is read, so
// what is cached is the document as kaja reads it.
func supplement(s *spec) {
	if s.Components.SecuritySchemes.len() > 0 {
		return
	}
	for _, known := range knownAPIs {
		if !declaresServer(s, known.server) {
			continue
		}
		for _, supplied := range known.schemes {
			scheme := supplied.scheme
			scheme.supplied = true
			s.Components.SecuritySchemes.add(supplied.key, &scheme)
			s.Security = append(s.Security, map[string][]string{supplied.key: {}})
		}
		return
	}
}

func declaresServer(s *spec, server string) bool {
	for _, declared := range s.Servers {
		if sameServer(applyServerDefaults(declared), server) {
			return true
		}
	}
	return false
}

// sameServer compares two base URLs the way a token's resource is compared:
// scheme and host case-insensitively, a trailing slash ignored.
func sameServer(a, b string) bool {
	return canonicalServer(a) != "" && canonicalServer(a) == canonicalServer(b)
}

func canonicalServer(raw string) string {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return ""
	}
	return strings.ToLower(parsed.Scheme) + "://" + strings.ToLower(parsed.Host) + strings.TrimSuffix(parsed.Path, "/")
}
