# Introduction

kaja-twirp is a lightweight UI for exploring and calling Twirp APIs. It is designed to be embedded into your
development workflow as a Docker container.

kaja-twirp is in an early prototype stage.

```
docker run --pull always --name kaja-twirp -d -p 41520:41520 -v /my_app/proto:/app/proto -e BASE_URL="http://host.docker.internal:8080" --add-host=host.docker.internal:host-gateway lilwham/kaja-twirp:latest
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