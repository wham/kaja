# Introduction

kaja-twirp is a lightweight UI for exploring and calling [Twirp](https://github.com/twitchtv/twirp) APIs. It is designed to be embedded into your
development workflow as a Docker container.

```
docker run --pull always --name kaja-twirp -d -p 41520:41520 \
    -v /my_app/proto:/app/proto -e BASE_URL="http://host.docker.internal:8080" \
    --add-host=host.docker.internal:host-gateway kajatools/kaja-twirp:latest
```

`docker run` arguments explained:

* `--pull always` - Always pull the latest image from Docker Hub. kaja-twirp is updated frequently.
* `--name kaja-twirp` - Name the container. Useful for managing multiple containers.
* `-d` - Run the container in the [detached mode](https://docs.docker.com/engine/reference/run/#detached--d).
* `-p 41520:41520` - Expose the container's port 41520 on the host's port 41520. kaja-twirp listens on port 41520 by default.
* `-v /my_app/proto:/app/proto` - Mount the `/my_app/proto` directory from the host file system into the container's `/app/proto` directory. kaja-twirp will recursively search for `.proto` files in this directory. `/my_app/proto` should be your application's [--proto_path](https://protobuf.dev/reference/cpp/api-docs/google.protobuf.compiler.command_line_interface/), the directory where your `.proto` files are located.
* `-e BASE_URL="http://host.docker.internal:8080"` - Set the `BASE_URL` environment variable. This is the base URL of the Twirp API. kaja-twirp will use this URL to when calling the Twirp APIs. See [Configuration](#configuration) for all the available configuration options.
* `--add-host=host.docker.internal:host-gateway` - Expose the host's locahost to the container. This is required for kaja-twirp to be able to call the Twirp API from inside the container.
* `kajatools/kaja-twirp:latest` - kaja-twirp is available on [Docker Hub](https://hub.docker.com/r/kajatools/kaja-twirp).

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