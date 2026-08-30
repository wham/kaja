package api

import (
	"context"
	"fmt"
	"io"
	"strings"

	"github.com/wham/kaja/v2/pkg/apps"
	"google.golang.org/grpc"
	"google.golang.org/protobuf/proto"
)

var _ ApiServer = (*ApiService)(nil)

// apiMethods and apiStreams index the generated service description by method name.
// Each handler decodes the request into the type its method takes and calls it, which
// is the whole of what dispatching a call needs.
var apiMethods = func() map[string]grpc.MethodHandler {
	methods := make(map[string]grpc.MethodHandler, len(Api_ServiceDesc.Methods))
	for _, method := range Api_ServiceDesc.Methods {
		methods[method.MethodName] = method.Handler
	}
	return methods
}()

var apiStreams = func() map[string]grpc.StreamHandler {
	streams := make(map[string]grpc.StreamHandler, len(Api_ServiceDesc.Streams))
	for _, stream := range Api_ServiceDesc.Streams {
		streams[stream.StreamName] = stream.Handler
	}
	return streams
}()

// Invoke starts one call on this service and hands back the stream its responses
// arrive on, which is the same contract an app is invoked under: a caller needs no
// generated code of its own, and a unary method is the stream that stops after one
// message. Nothing is forwarded here, so no call has an upstream to report.
func (s *ApiService) Invoke(ctx context.Context, methodPath string, message []byte, _ map[string]string) (apps.Stream, error) {
	name := methodPath[strings.LastIndex(methodPath, "/")+1:]

	if handler, ok := apiMethods[name]; ok {
		response, err := handler(s, ctx, func(request any) error {
			return proto.Unmarshal(message, request.(proto.Message))
		}, nil)
		if err != nil {
			return nil, err
		}
		encoded, err := proto.Marshal(response.(proto.Message))
		if err != nil {
			return nil, err
		}
		return apps.OneMessage(encoded, nil), nil
	}

	if handler, ok := apiStreams[name]; ok {
		return startServerStream(ctx, s, handler, message), nil
	}

	return nil, fmt.Errorf("unknown method %q", methodPath)
}

// serverStream is both halves of a streaming method: the grpc.ServerStream the
// generated handler writes to, and the apps.Stream the lane reads from. A handler
// writes and a lane reads, so the two meet at an unbuffered channel and the handler
// runs for as long as the call does. Nothing of what a stream carries on the wire -
// headers, trailers, a client half - has anywhere to go on a dispatch inside one
// process, so the embedded interface is left nil and a handler that reached for one
// would say so.
type serverStream struct {
	grpc.ServerStream
	ctx      context.Context
	request  []byte
	messages chan []byte
	done     chan error
	ended    bool
	err      error
}

func startServerStream(ctx context.Context, service *ApiService, handler grpc.StreamHandler, request []byte) *serverStream {
	stream := &serverStream{
		ctx:      ctx,
		request:  request,
		messages: make(chan []byte),
		done:     make(chan error, 1),
	}
	go func() {
		defer close(stream.messages)
		stream.done <- handler(service, stream)
	}()
	return stream
}

func (s *serverStream) Recv() ([]byte, error) {
	if message, ok := <-s.messages; ok {
		return message, nil
	}
	if !s.ended {
		s.ended = true
		s.err = <-s.done
	}
	if s.err != nil {
		return nil, s.err
	}
	return nil, io.EOF
}

func (s *serverStream) Report() *apps.Report { return nil }

func (s *serverStream) Context() context.Context { return s.ctx }

func (s *serverStream) RecvMsg(m any) error {
	return proto.Unmarshal(s.request, m.(proto.Message))
}

// SendMsg hands the message to whoever is reading, or gives up when the call is over:
// a browser that went away leaves nobody to read, and a handler blocked on that would
// outlive the request that started it.
func (s *serverStream) SendMsg(m any) error {
	encoded, err := proto.Marshal(m.(proto.Message))
	if err != nil {
		return err
	}
	select {
	case s.messages <- encoded:
		return nil
	case <-s.ctx.Done():
		return s.ctx.Err()
	}
}
