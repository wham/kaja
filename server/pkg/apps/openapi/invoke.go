package openapi

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"

	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/types/dynamicpb"

	"github.com/wham/kaja/v2/pkg/apps"
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
	auth    *auth
}

func (in *instance) Invoke(methodPath string, request []byte, headers map[string]string) (*apps.InvokeResult, error) {
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

	respJSON, reqHeaders, respHeaders, err := in.transcode(method.binding, reqJSON, headers)
	if err != nil {
		return nil, err
	}

	// Encode the JSON response back into the method's protobuf response, ignoring
	// any extra REST fields not modeled in the proto.
	respMsg := dynamicpb.NewMessage(method.output)
	if err := (protojson.UnmarshalOptions{DiscardUnknown: true}).Unmarshal(respJSON, respMsg); err != nil {
		return nil, fmt.Errorf("decoding response JSON: %w", err)
	}
	body, err := proto.Marshal(respMsg)
	if err != nil {
		return nil, err
	}
	return &apps.InvokeResult{Body: body, RequestHeaders: reqHeaders, ResponseHeaders: respHeaders}, nil
}

// transcode runs the upstream REST call for a method given the proto3-JSON
// request, returning the proto3-JSON response along with the request headers
// actually sent upstream and the response headers received.
func (in *instance) transcode(binding *methodBinding, request []byte, headers map[string]string) ([]byte, map[string]string, map[string]string, error) {
	req := map[string]json.RawMessage{}
	if len(bytes.TrimSpace(request)) > 0 {
		if err := json.Unmarshal(request, &req); err != nil {
			return nil, nil, nil, fmt.Errorf("decoding request: %w", err)
		}
	}

	path := binding.pathTemplate
	for _, name := range binding.pathParams {
		path = strings.ReplaceAll(path, "{"+name+"}", url.PathEscape(jsonScalar(req[name])))
	}

	query := url.Values{}
	for _, qp := range binding.queryParams {
		raw, ok := req[qp.name]
		if !ok {
			continue
		}
		switch qp.style {
		case "deepObject":
			// {"filter":{"model":"gpt-4"}} becomes filter[model]=gpt-4.
			var obj map[string]json.RawMessage
			if err := json.Unmarshal(bytes.TrimSpace(raw), &obj); err == nil {
				keys := make([]string, 0, len(obj))
				for k := range obj {
					keys = append(keys, k)
				}
				sort.Strings(keys)
				for _, k := range keys {
					query.Add(qp.name+"["+k+"]", jsonScalar(obj[k]))
				}
			} else if vs := jsonQueryValues(raw); len(vs) > 0 {
				query.Add(qp.name, strings.Join(vs, ","))
			}
		case "csv":
			// form style with explode=false: values are comma-joined.
			if vs := jsonQueryValues(raw); len(vs) > 0 {
				query.Add(qp.name, strings.Join(vs, ","))
			}
		default:
			for _, v := range jsonQueryValues(raw) {
				query.Add(qp.name, v)
			}
		}
	}
	in.auth.applyQuery(query)

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
		return nil, nil, nil, fmt.Errorf("building request: %w", err)
	}
	// Apply the spec's auth first so an explicit per-request header can still override it.
	in.auth.applyRequest(httpReq)
	for k, v := range headers {
		httpReq.Header.Set(k, v)
	}
	if httpReq.Header.Get("Accept") == "" {
		httpReq.Header.Set("Accept", "application/json")
	}
	if hasBody && httpReq.Header.Get("Content-Type") == "" {
		contentType := binding.bodyContentType
		if contentType == "" {
			contentType = "application/json"
		}
		httpReq.Header.Set("Content-Type", contentType)
	}
	reqHeaders := apps.SurfaceHeaders(httpReq.Header)

	resp, err := in.client.Do(httpReq)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("calling %s %s: %w", binding.verb, fullURL, err)
	}
	defer resp.Body.Close()
	respHeaders := apps.SurfaceHeaders(resp.Header)

	respBody, err := io.ReadAll(io.LimitReader(resp.Body, 16<<20))
	if err != nil {
		return nil, nil, nil, fmt.Errorf("reading response: %w", err)
	}

	if resp.StatusCode >= 400 {
		return nil, nil, nil, apps.NewUpstreamError(binding.verb, fullURL, resp.StatusCode, respBody).WithHeaders(reqHeaders, respHeaders)
	}

	return wrapResponse(binding.responseWrap, respBody), reqHeaders, respHeaders, nil
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

// serviceOfMethodPath returns the service-type portion of a "<service>/<Method>"
// gRPC method path.
func serviceOfMethodPath(s string) string {
	if i := strings.LastIndex(s, "/"); i >= 0 {
		return s[:i]
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
	case "text":
		// The body is plain text, not JSON; carry it as a JSON string.
		out, _ := json.Marshal(map[string]string{"value": string(trimmed)})
		return out
	default: // object
		if len(trimmed) == 0 {
			return []byte("{}")
		}
		return trimmed
	}
}
