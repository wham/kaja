# syntax=docker/dockerfile:1

FROM alpine:latest AS builder
ARG RUN_TESTS=false
ARG GIT_REF=""
RUN apk add --no-cache libgcc libstdc++
COPY --from=oven/bun:alpine /usr/local/bin/bun /usr/local/bin/bun
COPY --from=golang:1.25-alpine /usr/local/go/ /usr/local/go/
ENV PATH="/usr/local/go/bin:${PATH}"

COPY ui /ui
WORKDIR /ui
RUN bun i
RUN if [ "$RUN_TESTS" = "true" ] ; then \
  bun run tsc; \
  bun test; \
  fi

COPY protoc-gen-kaja /protoc-gen-kaja
COPY server /server
WORKDIR /server
RUN go run cmd/build-ui/main.go
RUN if [ "$RUN_TESTS" = "true" ] ; then \
  go test ./... -v; \
  fi
RUN go build -ldflags "-X main.GitRef=$GIT_REF" -o /build/server ./cmd/server

FROM alpine:latest AS server
COPY --from=builder /build/server /server/
RUN apk update && apk add --no-cache make
WORKDIR /server
EXPOSE 41520
#CMD ["sh", "-c", "sleep 10000000 && ./server"]
CMD ["./server"]

# The same server with the demo workspace baked in, so it needs no volume to
# have something to show. Both Fly deployments are this one image: demo.kaja.tools
# (deploy/demo/fly.toml) and every pull request's own app
# (deploy/preview/fly.toml). One target rather than two is the point — what a
# pull request is clicked through on is what the demo will be once it merges.
FROM server AS demo
COPY workspace /workspace

# What ships, and last on purpose: a `docker build .` that names no target
# builds the final stage, so the published image stays the plain server however
# many variants are added above it.
FROM server AS runner
