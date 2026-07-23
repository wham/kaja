module github.com/wham/kaja/v2

go 1.25.0

require (
	github.com/evanw/esbuild v0.27.2
	github.com/twitchtv/twirp v8.1.3+incompatible
	github.com/wham/kaja/v2/protoc-gen-kaja v0.0.0
	github.com/wham/protoc-go v0.0.0-20260613044033-37f17d357916
	google.golang.org/grpc v1.79.3
	google.golang.org/protobuf v1.36.11
	sigs.k8s.io/yaml v1.6.0
)

replace github.com/wham/kaja/v2/protoc-gen-kaja => ../protoc-gen-kaja

require (
	golang.org/x/net v0.55.0 // indirect
	golang.org/x/text v0.37.0 // indirect
	google.golang.org/genproto/googleapis/rpc v0.0.0-20251222181119-0a764e51fe1b // indirect
)

require (
	github.com/pkg/errors v0.9.1 // indirect
	go.yaml.in/yaml/v2 v2.4.2 // indirect
	golang.org/x/sys v0.45.0 // indirect
)
