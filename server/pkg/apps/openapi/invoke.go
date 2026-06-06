package openapi

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"

	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/types/dynamicpb"
)

// boundMethod pairs a method's HTTP binding with the protobuf descriptors used to
// decode the request and encode the response.
type boundMethod struct {
	binding *methodBinding
	input   protoreflect.MessageDescriptor
	output  protoreflect.MessageDescriptor
}

// instance is a live opened OpenAPI app. It is a gRPC app: method calls arrive as
// protobuf, are transcoded into HTTP requests against the upstream REST API, and
// the responses are shaped back into the method's protobuf response.
type instance struct {
	baseURL string
	methods map[string]*boundMethod
	client  *http.Client
}

func (in *instance) Invoke(methodPath string, request []byte, headers map[string]string) ([]byte, error) {
	method := in.lookup(methodPath)
	if method == nil {
		return nil, fmt.Errorf("unknown method %q", methodPath)
	}

	// Decode the protobuf request into the proto3-JSON shape the transcoder reads.
	// Field json_names match the OpenAPI parameter/property names by construction.
	reqMsg := dynamicpb.NewMessage(method.input)
	if len(request) > 0 {
		if err := proto.Unmarshal(request, reqMsg); err != nil {
			return nil, fmt.Errorf("decoding request: %w", err)
		}
	}
	reqJSON, err := protojson.Marshal(reqMsg)
	if err != nil {
		return nil, fmt.Errorf("encoding request to JSON: %w", err)
	}

	respJSON, err := in.transcode(method.binding, reqJSON, headers)
	if err != nil {
		return nil, err
	}

	// Encode the JSON response back into the method's protobuf response, ignoring
	// any extra REST fields not modeled in the proto.
	respMsg := dynamicpb.NewMessage(method.output)
	if err := (protojson.UnmarshalOptions{DiscardUnknown: true}).Unmarshal(respJSON, respMsg); err != nil {
		return nil, fmt.Errorf("decoding response JSON: %w", err)
	}
	return proto.Marshal(respMsg)
}

// transcode runs the upstream REST call for a method given the proto3-JSON
// request, returning the proto3-JSON response.
func (in *instance) transcode(binding *methodBinding, request []byte, headers map[string]string) ([]byte, error) {
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
		if raw, ok := req[name]; ok {
			for _, v := range jsonQueryValues(raw) {
				query.Add(name, v)
			}
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

// lookup finds a method by exact gRPC path, falling back to a case-insensitive
// match on the method-name segment.
func (in *instance) lookup(methodPath string) *boundMethod {
	if m, ok := in.methods[methodPath]; ok {
		return m
	}
	want := lastSegment(methodPath)
	for k, m := range in.methods {
		if strings.EqualFold(lastSegment(k), want) {
			return m
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

// jsonQueryValues renders a JSON value as one or more query-string values.
// Arrays are expanded into repeated values (OpenAPI form/explode style), so
// {"tags":["a","b"]} becomes tags=a&tags=b instead of a single tags=["a","b"].
func jsonQueryValues(raw json.RawMessage) []string {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 || string(trimmed) == "null" {
		return nil
	}
	if trimmed[0] == '[' {
		var arr []json.RawMessage
		if err := json.Unmarshal(trimmed, &arr); err == nil {
			values := make([]string, 0, len(arr))
			for _, e := range arr {
				values = append(values, jsonScalar(e))
			}
			return values
		}
	}
	return []string{jsonScalar(trimmed)}
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
