# syntax=docker/dockerfile:1

FROM alpine:latest AS builder
RUN apk add --update nodejs npm
COPY --from=golang:1.22.4-alpine /usr/local/go/ /usr/local/go/
ENV PATH="/usr/local/go/bin:${PATH}"


COPY ui /ui
WORKDIR /ui
RUN npm ci --omit=dev

COPY server /server
WORKDIR /server
RUN go run cmd/build-ui/main.go
RUN go build -o /build/kaja ./cmd/server

FROM alpine:latest AS runner
COPY --from=builder /build/kaja /app/
COPY --from=builder /build/protoc-gen-ts /build/
RUN apk add --update nodejs
RUN apk update && apk add --no-cache make protobuf-dev
WORKDIR /app
EXPOSE 41520
#CMD ["sh", "-c", "sleep 10000000 && ./kaja"]
CMD ["./kaja"]