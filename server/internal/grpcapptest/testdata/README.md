The specs this suite reads a server out of, each as its project publishes it:

- `routeguide/` — the gRPC tutorial's route guide, from grpc-go's examples. It is
  edition 2023, which is the one thing here that is not proto3 or proto2.
- `interop/` — `grpc.testing.TestService`, the grpc project's own interop surface:
  every permutation of unary and streaming, and the messages a client is tested with.
- `googleapis/` — Google Cloud Pub/Sub, imports and all, which is the largest real
  spec a gRPC app is pointed at here.
- `health/` — the gRPC health checking protocol.
- `legacy/`, `fidelity/`, `nothing/` — written for this suite: a proto2 surface, a
  proto3 one holding the marks a reflected file has to keep, and a file with no
  service in it.

The first four are Apache-2.0, and their license headers are as they were published.
