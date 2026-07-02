package openapi

import (
	"net/http"
	"net/url"
	"strings"
)

// authKind is the shape of credential the upstream expects.
type authKind string

const (
	authNone   authKind = ""
	authBearer authKind = "bearer" // Authorization: Bearer <token>
	authBasic  authKind = "basic"  // Authorization: Basic base64(user:pass)
	authAPIKey authKind = "apiKey" // a named header/query/cookie carrying the key
)

// auth resolves the spec's security scheme together with the credentials the user
// configured, and knows how to inject them into an outgoing request. It is shared
// by every method of an opened app.
type auth struct {
	kind       authKind
	apiKeyIn   string // header | query | cookie (apiKey only)
	apiKeyName string // parameter name (apiKey only)

	token    string // bearer token or api key value
	username string // basic auth user
	password string // basic auth password
}

// configured reports whether the user supplied any credentials.
func (a *auth) configured() bool {
	return a != nil && (a.token != "" || a.username != "" || a.password != "")
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
			req.Header.Set("Authorization", "Bearer "+a.token)
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

// resolveAuth builds the auth for an opened app from the spec's security schemes
// and the user's credentials. When the spec declares no usable scheme it falls
// back to a sensible default based on which credentials were provided, so the app
// still works against APIs whose specs omit their security section.
func resolveAuth(s *spec, token, username, password string) *auth {
	a := &auth{token: token, username: username, password: password}

	if scheme := pickScheme(s); scheme != nil {
		switch scheme.Type {
		case "http":
			// Scheme names are case-insensitive; specs write "Bearer" and "bearer".
			if strings.EqualFold(scheme.Scheme, "basic") {
				a.kind = authBasic
			} else {
				a.kind = authBearer
			}
		case "apiKey":
			a.kind = authAPIKey
			a.apiKeyIn = scheme.In
			a.apiKeyName = scheme.Name
		case "oauth2", "openIdConnect":
			a.kind = authBearer
		}
	}

	if a.kind == authNone {
		// No declared scheme: guess from the credentials so the app is still usable.
		if a.username != "" || a.password != "" {
			a.kind = authBasic
		} else if a.token != "" {
			a.kind = authBearer
		}
	}
	return a
}

// pickScheme chooses the security scheme to apply across the app. It honours the
// document-level security requirement, falling back to the sole defined scheme
// when the requirement is absent (common when security is declared per-operation).
func pickScheme(s *spec) *securityScheme {
	schemes := s.Components.SecuritySchemes
	if len(schemes) == 0 {
		return nil
	}
	for _, requirement := range s.Security {
		for name := range requirement {
			if sc, ok := schemes[name]; ok {
				return sc
			}
		}
	}
	if len(schemes) == 1 {
		for _, sc := range schemes {
			return sc
		}
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
		return "sending token as Authorization: Bearer"
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
