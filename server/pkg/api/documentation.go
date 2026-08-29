package api

import (
	"context"
	"strings"
)

// GetMethodDocumentation reads one of a live app's methods back out of the document
// its surface was generated from — what the generated proto could not carry: the
// prose under each parameter, the examples, the response codes a method never
// returns as values, the vendor extensions.
//
// It reaches the opened app by its target, the same key an invocation uses, so it
// answers about the app as it is running rather than re-reading a document that may
// since have moved. An app type that documents nothing, a method it does not
// declare, or an instance replaced by a recompile all answer the same way: with
// nothing, and not with an error. The caller is a hover.
func (s *ApiService) GetMethodDocumentation(ctx context.Context, req *GetMethodDocumentationRequest) (*GetMethodDocumentationResponse, error) {
	target := strings.TrimSpace(req.Target)
	method := strings.TrimSpace(req.Method)
	if target == "" || method == "" {
		return &GetMethodDocumentationResponse{}, nil
	}

	documentation, ok := s.apps.Documentation(target, method)
	if !ok {
		return &GetMethodDocumentationResponse{}, nil
	}

	return &GetMethodDocumentationResponse{Documentation: &MethodDocumentation{
		Summary:     documentation.Summary,
		Description: documentation.Description,
		Deprecated:  documentation.Deprecated,
		Document:    documentation.Document,
		Language:    documentation.Language,
	}}, nil
}
