# syntax=docker/dockerfile:1

FROM alpine:latest AS builder
ARG RUN_TESTS=false
ARG GIT_REF=""
RUN apk add --update nodejs npm
COPY --from=golang:1.22.4-alpine /usr/local/go/ /usr/local/go/
ENV PATH="/usr/local/go/bin:${PATH}"

COPY ui /ui
WORKDIR /ui
RUN npm ci
RUN if [ "$RUN_TESTS" = "true" ] ; then \
  npm run tsc; \
  npm test -- run; \
  fi

COPY server /server
WORKDIR /server
RUN go run cmd/build-ui/main.go
RUN if [ "$RUN_TESTS" = "true" ] ; then \
  go test ./... -v; \
  fi
RUN go build -ldflags "-X main.GitRef=$GIT_REF" -o /build/server ./cmd/server

FROM alpine:latest AS runner
COPY --from=builder /build/server /server/
COPY --from=builder /server/build/protoc-gen-ts /server/build/
RUN apk add --update nodejs
RUN apk update && apk add --no-cache make protobuf-dev
WORKDIR /server
EXPOSE 41520
#CMD ["sh", "-c", "sleep 10000000 && ./server"]
CMD ["./server"]