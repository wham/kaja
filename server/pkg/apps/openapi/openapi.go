// Package openapi implements the built-in "openapi" app: it reads an OpenAPI 3.x
// document, converts its operations into a proto service kaja can render, and
// transcodes method calls into HTTP requests against the upstream REST API.
package openapi

import (
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/wham/kaja/v2/pkg/apps"
)

// App is the openapi app factory. Register it with the apps.Manager.
type App struct{}

func New() *App { return &App{} }

func (a *App) Open(parameters map[string]string, protoDir string, log func(string)) (apps.Instance, error) {
	specURL := strings.TrimSpace(parameters["spec_url"])
	if specURL == "" {
		return nil, fmt.Errorf("missing required parameter %q", "spec_url")
	}

	log("Fetching OpenAPI spec from " + specURL)
	s, err := loadSpec(specURL)
	if err != nil {
		return nil, err
	}
	log(fmt.Sprintf("Loaded %q (OpenAPI %s) with %d path(s)", s.Info.Title, s.OpenAPI, len(s.Paths)))

	gen, err := generateProto(s)
	if err != nil {
		return nil, err
	}
	log(fmt.Sprintf("Generated service %s with %d method(s)", gen.serviceTypeName, len(gen.bindings)))

	if err := os.WriteFile(filepath.Join(protoDir, "service.proto"), []byte(gen.proto), 0o644); err != nil {
		return nil, fmt.Errorf("writing proto: %w", err)
	}

	baseURL, err := resolveBaseURL(specURL, s)
	if err != nil {
		return nil, err
	}
	log("Upstream base URL: " + baseURL)

	return &instance{
		baseURL:  baseURL,
		bindings: gen.bindings,
		client:   &http.Client{Timeout: 30 * time.Second},
	}, nil
}

// resolveBaseURL determines the upstream base URL from the spec's servers list,
// resolving relative server URLs against the document URL.
func resolveBaseURL(specURL string, s *spec) (string, error) {
	docURL, err := url.Parse(specURL)
	if err != nil {
		return "", fmt.Errorf("invalid spec URL: %w", err)
	}

	var serverURL string
	if len(s.Servers) > 0 {
		serverURL = strings.TrimSpace(s.Servers[0].URL)
	}
	if serverURL == "" {
		return docURL.Scheme + "://" + docURL.Host, nil
	}

	ref, err := url.Parse(serverURL)
	if err != nil {
		return "", fmt.Errorf("invalid server URL %q: %w", serverURL, err)
	}
	if ref.IsAbs() {
		return strings.TrimRight(serverURL, "/"), nil
	}
	return strings.TrimRight(docURL.ResolveReference(ref).String(), "/"), nil
}
