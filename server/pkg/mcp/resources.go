package mcp

import (
	"encoding/json"
	"fmt"
	"time"
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
	return cacheable(map[string]interface{}{"resources": resources}, workspaceTTL), nil
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
		return resourceContents(p.URI, "text/markdown", guide, staticTTL), nil
	case servicesURI:
		// The same index list_services returns.
		return resourceContents(p.URI, "text/plain", s.bridge.Catalog().listServices("", "", ""), workspaceTTL), nil
	default:
		return nil, &rpcError{Code: codeInvalidParams, Message: fmt.Sprintf("unknown resource %q", p.URI)}
	}
}

// resourceContents is one resource's text. The guide never changes while the process
// runs and the services index follows the apps, so the read is cacheable for as long
// as the slower-moving of the two is: a caller holding a stale index of what it can
// call would write a script against an app that has been deleted.
func resourceContents(uri, mimeType, text string, ttl time.Duration) interface{} {
	return cacheable(map[string]interface{}{
		"contents": []map[string]interface{}{
			{"uri": uri, "mimeType": mimeType, "text": text},
		},
	}, ttl)
}
