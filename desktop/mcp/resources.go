package mcp

import (
	"encoding/json"
	"fmt"
	"strings"
)

const (
	guideURI    = "kaja://guide"
	servicesURI = "kaja://services"
	stubScheme  = "kaja://stub/"
)

// handleResourcesList advertises the guide, the live services catalog, and one
// resource per generated TypeScript stub.
func (s *Server) handleResourcesList() (interface{}, *rpcError) {
	resources := []map[string]interface{}{
		{
			"uri":         guideURI,
			"name":        "Kaja scripting guide",
			"description": "How Kaja scripts work and the kaja runtime object.",
			"mimeType":    "text/markdown",
		},
		{
			"uri":         servicesURI,
			"name":        "Available services",
			"description": "Projects, services, methods, and types a script can call.",
			"mimeType":    "application/json",
		},
	}
	for _, src := range s.bridge.Catalog().Sources {
		resources = append(resources, map[string]interface{}{
			"uri":         stubScheme + src.Path,
			"name":        src.Path,
			"description": "Generated TypeScript types for " + src.Path,
			"mimeType":    "text/x-typescript",
		})
	}
	return map[string]interface{}{"resources": resources}, nil
}

type resourceReadParams struct {
	URI string `json:"uri"`
}

func (s *Server) handleResourceRead(params json.RawMessage) (interface{}, *rpcError) {
	var p resourceReadParams
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, &rpcError{Code: codeInvalidParams, Message: "invalid params"}
	}

	switch {
	case p.URI == guideURI:
		return resourceContents(p.URI, "text/markdown", guide), nil
	case p.URI == servicesURI:
		b, err := json.MarshalIndent(s.bridge.Catalog(), "", "  ")
		if err != nil {
			return nil, &rpcError{Code: codeInternal, Message: err.Error()}
		}
		return resourceContents(p.URI, "application/json", string(b)), nil
	case strings.HasPrefix(p.URI, stubScheme):
		path := strings.TrimPrefix(p.URI, stubScheme)
		for _, src := range s.bridge.Catalog().Sources {
			if src.Path == path {
				return resourceContents(p.URI, "text/x-typescript", src.Content), nil
			}
		}
		return nil, &rpcError{Code: codeInvalidParams, Message: fmt.Sprintf("unknown stub %q", path)}
	default:
		return nil, &rpcError{Code: codeInvalidParams, Message: fmt.Sprintf("unknown resource %q", p.URI)}
	}
}

func resourceContents(uri, mimeType, text string) interface{} {
	return map[string]interface{}{
		"contents": []map[string]interface{}{
			{"uri": uri, "mimeType": mimeType, "text": text},
		},
	}
}
