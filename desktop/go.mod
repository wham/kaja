module github.com/wham/kaja/desktop

go 1.25.0

require (
	github.com/wailsapp/wails/v3 v3.0.0-beta.14
	github.com/wham/kaja/v2 v2.0.0-20240101000000-000000000000
	github.com/zalando/go-keyring v0.2.8
	sigs.k8s.io/yaml v1.6.0
)

replace (
	github.com/wham/kaja/v2 => ../server
	github.com/wham/kaja/v2/protoc-gen-kaja => ../protoc-gen-kaja
)

require (
	github.com/adrg/xdg v0.5.3 // indirect
	github.com/coder/websocket v1.8.14 // indirect
	github.com/danieljoos/wincred v1.2.3 // indirect
	github.com/evanw/esbuild v0.28.1 // indirect
	github.com/go-ole/go-ole v1.3.0 // indirect
	github.com/godbus/dbus/v5 v5.2.2 // indirect
	github.com/jchv/go-winloader v0.0.0-20250406163304-c1995be93bd1 // indirect
	github.com/mattn/go-colorable v0.1.15 // indirect
	github.com/mattn/go-isatty v0.0.24 // indirect
	github.com/twitchtv/twirp v8.1.3+incompatible // indirect
	github.com/wham/kaja/v2/protoc-gen-kaja v0.0.0 // indirect
	github.com/wham/protoc-go v0.2.1 // indirect
	go.yaml.in/yaml/v2 v2.4.4 // indirect
	golang.org/x/net v0.57.0 // indirect
	golang.org/x/sys v0.47.0 // indirect
	golang.org/x/text v0.40.0 // indirect
	google.golang.org/genproto/googleapis/rpc v0.0.0-20260729162451-8efbd57d26e0 // indirect
	google.golang.org/grpc v1.83.0 // indirect
	google.golang.org/protobuf v1.36.12 // indirect
)
