module github.com/wham/kaja/desktop

go 1.26.0

require (
	github.com/wailsapp/wails/v3 v3.0.0-beta.30
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
	github.com/coder/websocket v1.8.15 // indirect
	github.com/danieljoos/wincred v1.2.3 // indirect
	github.com/evanw/esbuild v0.28.2 // indirect
	github.com/go-ole/go-ole v1.3.0 // indirect
	github.com/godbus/dbus/v5 v5.2.4 // indirect
	github.com/mattn/go-colorable v0.1.16 // indirect
	github.com/mattn/go-isatty v0.0.24 // indirect
	github.com/wham/kaja/v2/protoc-gen-kaja v0.0.0 // indirect
	github.com/wham/protoc-go v0.5.0 // indirect
	go.yaml.in/yaml/v2 v2.4.4 // indirect
	golang.org/x/net v0.61.0 // indirect
	golang.org/x/sys v0.49.0 // indirect
	golang.org/x/text v0.43.0 // indirect
	google.golang.org/genproto/googleapis/rpc v0.0.0-20261012220534-4341edf3f941 // indirect
	google.golang.org/grpc v1.84.0 // indirect
	google.golang.org/protobuf v1.36.12 // indirect
)
