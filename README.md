# Introduction

kaja-twirp is a lightweight UI for exploring and calling Twirp APIs. It is designed to be embedded into your
development workflow as a Docker container.

kaja-twirp is in an early prototype stage.

```
docker run --pull always --name kaja-twirp -d -p 41520:41520 -v /my_app/proto:/app/proto -e BASE_URL="http://host.docker.internal:8080" --add-host=host.docker.internal:host-gateway lilwham/kaja-twirp:latest
```

# Configuration

Configuration can be provided via environment variables or a config file. Use the [-e parameter](https://docs.docker.com/engine/reference/commandline/run/#env) when running the Docker container.

```
docker run -e BASE_URL="http://host.docker.internal:8080" ...
```

List of configuration options:

* `BASE_URL` - The base URL of the Twirp API. Example: `http://host.docker.internal:8080`.
* `HEADER_1` - Custom HTTP header that will be passed with each Twirp request. Typically used for authentication. Example: `Authentication: Bearer <token>`.
* `HEADER_2` - Another custom HTTP header.
* `HEADER_{3..5}` - More custom HTTP headers. Up to five in total.

Alternatively, kaja-twirp will use [godotenv](https://github.com/joho/godotenv) to look for a `.env` file in the `/app` directory of the Docker container. You can use the [-v parameter](https://docs.docker.com/engine/reference/commandline/run/#volume) to mount a `.env` file from the host file system. This is useful when
you need to dynamically change the configuration. For example, when an authentication header needs to refreshed.

```
docker run -v /tmp/kaja-twirp.env:/app/.env ...
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