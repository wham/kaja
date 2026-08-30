package api

import (
	"context"
	"fmt"
	"strings"

	"google.golang.org/grpc"
	"google.golang.org/protobuf/proto"
)

var _ ApiServer = (*ApiService)(nil)

// apiMethods indexes the generated service description by method name. Each handler
// decodes the request into the type its method takes and calls it, which is the whole
// of what dispatching a call needs.
var apiMethods = func() map[string]grpc.MethodHandler {
	methods := make(map[string]grpc.MethodHandler, len(Api_ServiceDesc.Methods))
	for _, method := range Api_ServiceDesc.Methods {
		methods[method.MethodName] = method.Handler
	}
	return methods
}()

// Invoke dispatches one unary call, taking and returning encoded protobuf. A caller
// needs no generated code of its own, which is what lets the web's gRPC-Web door and
// the desktop's Wails binding reach this service through the same door.
func (s *ApiService) Invoke(ctx context.Context, methodPath string, message []byte) ([]byte, error) {
	handler, ok := apiMethods[methodPath[strings.LastIndex(methodPath, "/")+1:]]
	if !ok {
		return nil, fmt.Errorf("unknown method %q", methodPath)
	}
	response, err := handler(s, ctx, func(request any) error {
		return proto.Unmarshal(message, request.(proto.Message))
	}, nil)
	if err != nil {
		return nil, err
	}
	return proto.Marshal(response.(proto.Message))
}
