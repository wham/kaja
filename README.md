# Introduction

kaja-twirp is a lightweight UI for exploring and calling Twirp APIs. It is designed to be embedded into your
development workflow as a Docker container.

kaja-twirp is in an early prototype stage.

```
docker run -v /my_app/proto:/app/proto -p 41520:41520 -e BASE_URL="http://localhost:8080"
```

# Development

```
sudo apt-get update && sudo apt-get install -y protobuf-compiler
brew install protobuf
script/server
```

## Testing

```
go test ./...
```

Run `script/server` to regenerate model testdata.proto.