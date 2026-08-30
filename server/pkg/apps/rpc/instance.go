package rpc

import (
	"context"

	"github.com/wham/kaja/v2/pkg/apps"
	"github.com/wham/kaja/v2/pkg/grpc"
)

// instance forwards a call to the upstream gRPC server. It holds the address and
// nothing else: the credential arrives on the call's headers and the transport
// security on the call itself, both read from kaja.json when the call is made, so
// replacing either takes effect on the next call rather than the next compile.
type instance struct {
	url string
}

// Invoke opens the call as a server stream, whichever kind of method it names: at
// this end of the wire there is nothing to tell a unary call from a streaming one —
// the request framing is identical, and a unary method answers with the one message
// and the status that a stream of one is.
//
// The call lives as long as ctx and no longer: a stream ends when the server runs out
// or when Stop cancels it, and a deadline of kaja's own would cut a long one short at
// a number nobody chose.
func (in *instance) Invoke(ctx context.Context, call *apps.Call) (apps.Stream, error) {
	client, err := grpc.NewClientFromString(in.url, call.TLS)
	if err != nil {
		return nil, err
	}

	stream, err := client.OpenServerStream(ctx, call.Method, call.Request, call.Headers)
	if err != nil {
		return nil, err
	}
	return &forwarded{stream: stream}, nil
}

// forwarded is the upstream stream as an apps.Stream. This lane is a bridge rather
// than a hop — the same call is forwarded — so what the server answered with is the
// response's own metadata rather than an exchange kaja made on its behalf.
type forwarded struct {
	stream *grpc.ServerStream
}

func (f *forwarded) Recv() ([]byte, error) { return f.stream.Recv() }

func (f *forwarded) Report() *apps.Report {
	return &apps.Report{Metadata: f.stream.Metadata()}
}
