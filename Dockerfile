# syntax=docker/dockerfile:1

FROM alpine:latest AS builder
ARG RUN_TESTS=false
ARG GIT_REF=""
RUN apk add --no-cache libgcc libstdc++
COPY --from=oven/bun:alpine /usr/local/bin/bun /usr/local/bin/bun
COPY --from=golang:1.24-alpine /usr/local/go/ /usr/local/go/
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
RUN go build -C /protoc-gen-kaja -o /server/build/protoc-gen-kaja .
RUN GOBIN=/server/build go install github.com/wham/protoc-go/cmd/protoc-go@latest && mv /server/build/protoc-go /server/build/protoc
RUN if [ "$RUN_TESTS" = "true" ] ; then \
  go test ./... -v; \
  fi
RUN go build -ldflags "-X main.GitRef=$GIT_REF" -o /build/server ./cmd/server

FROM alpine:latest AS runner
COPY --from=builder /build/server /server/
COPY --from=builder /server/build/protoc-gen-kaja /server/build/
COPY --from=builder /server/build/protoc /server/build/
RUN apk update && apk add --no-cache make
WORKDIR /server
EXPOSE 41520
#CMD ["sh", "-c", "sleep 10000000 && ./server"]
CMD ["./server"]