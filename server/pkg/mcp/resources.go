package mcp

import (
	"encoding/json"
	"fmt"
)

const (
	guideURI    = "kaja://guide"
	servicesURI = "kaja://services"
)

// handleResourcesList advertises the guide and the live services index. The
// generated modules are deliberately not here: describe_method and describe_type
// hand back the declarations from them, and one module's full text is hundreds of
// kilobytes of runtime machinery around the few lines anyone wanted.
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
			"description": "Index of the apps, services and methods a script can call.",
			"mimeType":    "text/plain",
		},
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

	switch p.URI {
	case guideURI:
		return resourceContents(p.URI, "text/markdown", guide), nil
	case servicesURI:
		// The same index list_services returns.
		return resourceContents(p.URI, "text/plain", s.bridge.Catalog().listServices("", "", "")), nil
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
