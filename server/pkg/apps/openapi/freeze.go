package openapi

import (
	"strings"

	"github.com/wham/kaja/v2/pkg/apps"
)

// Freeze reads the document once and writes it into the app, so an exported
// copy opens from the bytes rather than from the URL. Two things change: the
// spec travels as spec_content, and the base URL is resolved and stated.
//
// The second is not an optimisation — it is what makes the first correct. A
// document's `servers` may be relative, and relative to the document is a
// question only the document's own URL can answer; an inlined spec has no URL,
// so a base that was implied has to become one that is written down. Resolving
// it here is also the last moment anything can: at export time the document is
// in hand and its URL is known.
//
// The fetch credentials are left alone. They are how the document was read and
// may be how the API is read too, and the export is not the place to decide
// that a token is no longer needed.
func (a *App) Freeze(parameters map[string]string) (map[string]string, error) {
	specURL := strings.TrimSpace(parameters["spec_url"])
	if specURL == "" {
		// Already inline — an uploaded spec is frozen by construction.
		return nil, nil
	}
	if err := requireHTTPScheme(specURL); err != nil {
		return nil, err
	}

	body, contentType, p := fetchSpec(specURL, specFetchCredentials(parameters), func(string) {})
	if p != nil {
		return nil, p
	}
	s, p := readSpec(body, contentType)
	if p != nil {
		return nil, p
	}

	baseURL, err := resolveBaseURL(specURL, parameters["base_url"], s)
	if err != nil {
		return nil, err
	}

	return map[string]string{
		"spec_content": string(body),
		"base_url":     baseURL,
		"spec_url":     "",
		// The document is in the bundle, so the credentials that fetched it have
		// nothing left to fetch. They are usually a different token from the API's
		// own, and one that never has to travel shouldn't.
		"spec_header_name":  "",
		"spec_header_value": "",
	}, nil
}

// Freeze is what the exporter looks for.
var _ apps.Freezer = (*App)(nil)
