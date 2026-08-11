package mcp

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/wham/kaja/v2/pkg/apps"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/dynamicpb"
)

// instance is a live opened mcp app: one client, and the methods generated from
// what that server exposed when the app was opened.
type instance struct {
	client  *Client
	methods map[string]*boundMethod
}

func (in *instance) Invoke(methodPath string, request []byte, headers map[string]string) (*apps.InvokeResult, error) {
	method := in.lookup(methodPath)
	if method == nil {
		return nil, fmt.Errorf("unknown method %q (the app may need to be recompiled)", methodPath)
	}

	arguments, err := decodeRequest(method, request)
	if err != nil {
		return nil, err
	}

	params, err := callParams(method.binding, arguments)
	if err != nil {
		return nil, err
	}

	result, exchange, err := in.client.Call(method.binding.method, params, headers)
	if err != nil {
		return nil, withExchange(err, exchange)
	}

	body, err := encodeResult(method, result)
	if err != nil {
		return nil, err
	}
	invoked := &apps.InvokeResult{Body: body}
	if exchange != nil {
		invoked.RequestHeaders = exchange.RequestHeaders
		invoked.ResponseHeaders = exchange.ResponseHeaders
	}
	return invoked, nil
}

// lookup finds a method by its exact gRPC path, falling back to its name alone,
// which is unique across the app's services.
func (in *instance) lookup(methodPath string) *boundMethod {
	if method, ok := in.methods[methodPath]; ok {
		return method
	}
	want := lastSegment(methodPath)
	for path, method := range in.methods {
		if strings.EqualFold(lastSegment(path), want) {
			return method
		}
	}
	return nil
}

// decodeRequest turns the protobuf request into the JSON object the request
// message stands for. Every generated field carries the property's own name as
// its json_name, so what comes out is exactly the shape the server declared.
func decodeRequest(method *boundMethod, request []byte) (map[string]json.RawMessage, error) {
	message := dynamicpb.NewMessage(method.input)
	if len(request) > 0 {
		if err := proto.Unmarshal(request, message); err != nil {
			return nil, fmt.Errorf("decoding request: %w", err)
		}
	}
	encoded, err := protojson.MarshalOptions{UseProtoNames: false}.Marshal(message)
	if err != nil {
		return nil, fmt.Errorf("encoding request: %w", err)
	}
	arguments := map[string]json.RawMessage{}
	if err := json.Unmarshal(encoded, &arguments); err != nil {
		return nil, fmt.Errorf("encoding request: %w", err)
	}
	return arguments, nil
}

// callParams builds the JSON-RPC params for one call. A tool call and a prompt
// carry the request under `arguments` beside the name they address; everything
// else is the params.
func callParams(bound *binding, arguments map[string]json.RawMessage) (map[string]any, error) {
	params := map[string]any{}
	switch bound.kind {
	case "tool":
		params["name"] = bound.name
		params["arguments"] = arguments
	case "prompt":
		// Prompt arguments are strings on the wire, which is why every generated
		// field is one.
		values := map[string]string{}
		for name, raw := range arguments {
			var value string
			if json.Unmarshal(raw, &value) != nil {
				value = string(raw)
			}
			values[name] = value
		}
		params["name"] = bound.name
		params["arguments"] = values
	default:
		for name, raw := range arguments {
			var value any
			if err := json.Unmarshal(raw, &value); err != nil {
				return nil, fmt.Errorf("encoding request: %w", err)
			}
			params[name] = value
		}
	}
	return params, nil
}

// encodeResult shapes a JSON-RPC result into the method's protobuf response. The
// generated response fields carry the result's own keys as their json_name, so
// the result decodes into it directly; anything the response has no field for -
// the `resultType` and `_meta` every modern result carries - is dropped.
func encodeResult(method *boundMethod, result json.RawMessage) ([]byte, error) {
	if err := rejectInputRequired(result); err != nil {
		return nil, err
	}
	message := dynamicpb.NewMessage(method.output)
	if err := (protojson.UnmarshalOptions{DiscardUnknown: true}).Unmarshal(result, message); err != nil {
		return nil, fmt.Errorf("decoding response: %w", err)
	}
	return proto.Marshal(message)
}

// rejectInputRequired says so when a server asks the client for something back
// mid-call - a model completion, a question for the user, the roots it may read.
// kaja declares none of those capabilities, so there is nothing to answer with,
// and a silent empty result would read as the tool having returned nothing.
func rejectInputRequired(result json.RawMessage) error {
	var envelope struct {
		ResultType string `json:"resultType"`
	}
	if json.Unmarshal(result, &envelope) != nil || envelope.ResultType != "input_required" {
		return nil
	}
	return fmt.Errorf("the server asked for input to finish this call (sampling, elicitation or roots), which kaja does not provide")
}

// withExchange attaches the headers a failed call exchanged to the error, so the
// Headers view still has them. A 401 is exactly when they matter most.
func withExchange(err error, exchange *Exchange) error {
	if exchange == nil {
		return err
	}
	var upstream *apps.UpstreamError
	if asUpstream(err, &upstream) && upstream.RequestHeaders == nil {
		upstream.WithHeaders(exchange.RequestHeaders, exchange.ResponseHeaders)
	}
	return err
}
