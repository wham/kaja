package openapi

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
)

// instance is a live opened OpenAPI app. It transcodes proto3-JSON method calls
// into HTTP requests against the upstream REST API and shapes the responses back
// into the method's proto response.
type instance struct {
	baseURL  string
	bindings map[string]*methodBinding
	client   *http.Client
}

func (in *instance) Invoke(methodPath string, request []byte, headers map[string]string) ([]byte, error) {
	binding := in.lookup(methodPath)
	if binding == nil {
		return nil, fmt.Errorf("unknown method %q", methodPath)
	}

	req := map[string]json.RawMessage{}
	if len(bytes.TrimSpace(request)) > 0 {
		if err := json.Unmarshal(request, &req); err != nil {
			return nil, fmt.Errorf("decoding request: %w", err)
		}
	}

	path := binding.pathTemplate
	for _, name := range binding.pathParams {
		path = strings.ReplaceAll(path, "{"+name+"}", url.PathEscape(jsonScalar(req[name])))
	}

	query := url.Values{}
	for _, name := range binding.queryParams {
		if raw, ok := req[name]; ok && len(raw) > 0 && string(raw) != "null" {
			query.Set(name, jsonScalar(raw))
		}
	}

	fullURL := in.baseURL + path
	if len(query) > 0 {
		fullURL += "?" + query.Encode()
	}

	var body io.Reader
	hasBody := false
	if binding.bodyKey != "" {
		if raw, ok := req[binding.bodyKey]; ok && len(raw) > 0 && string(raw) != "null" {
			body = bytes.NewReader(raw)
			hasBody = true
		}
	}

	httpReq, err := http.NewRequest(binding.verb, fullURL, body)
	if err != nil {
		return nil, fmt.Errorf("building request: %w", err)
	}
	for k, v := range headers {
		httpReq.Header.Set(k, v)
	}
	httpReq.Header.Set("Accept", "application/json")
	if hasBody {
		httpReq.Header.Set("Content-Type", "application/json")
	}

	resp, err := in.client.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("calling %s %s: %w", binding.verb, fullURL, err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(io.LimitReader(resp.Body, 16<<20))
	if err != nil {
		return nil, fmt.Errorf("reading response: %w", err)
	}

	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("upstream %s %s returned %s: %s", binding.verb, fullURL, resp.Status, truncate(respBody, 500))
	}

	return wrapResponse(binding.responseWrap, respBody), nil
}

// lookup finds a binding by exact Twirp method path, falling back to a
// case-insensitive match on the method-name segment.
func (in *instance) lookup(methodPath string) *methodBinding {
	if b, ok := in.bindings[methodPath]; ok {
		return b
	}
	want := lastSegment(methodPath)
	for k, b := range in.bindings {
		if strings.EqualFold(lastSegment(k), want) {
			return b
		}
	}
	return nil
}

func lastSegment(s string) string {
	if i := strings.LastIndex(s, "/"); i >= 0 {
		return s[i+1:]
	}
	return s
}

// jsonScalar renders a JSON value as a plain string for use in a path or query.
func jsonScalar(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var s string
	if err := json.Unmarshal(raw, &s); err == nil {
		return s
	}
	return strings.TrimSpace(string(raw))
}

// wrapResponse shapes the upstream HTTP body into the proto3-JSON the client's
// generated message expects.
func wrapResponse(wrap string, body []byte) []byte {
	trimmed := bytes.TrimSpace(body)
	switch wrap {
	case "empty":
		return []byte("{}")
	case "array":
		if len(trimmed) == 0 {
			trimmed = []byte("[]")
		}
		out, _ := json.Marshal(map[string]json.RawMessage{"items": json.RawMessage(trimmed)})
		return out
	case "scalar":
		if len(trimmed) == 0 {
			trimmed = []byte("null")
		}
		out, _ := json.Marshal(map[string]json.RawMessage{"value": json.RawMessage(trimmed)})
		return out
	default: // object
		if len(trimmed) == 0 {
			return []byte("{}")
		}
		return trimmed
	}
}

func truncate(b []byte, n int) string {
	s := strings.TrimSpace(string(b))
	if len(s) > n {
		return s[:n] + "…"
	}
	return s
}
