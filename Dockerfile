# syntax=docker/dockerfile:1

FROM golang:alpine as builder
WORKDIR /workspace
COPY . .
RUN go mod download
RUN GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -o protoc-gen-kaja-twirp ./cmd/protoc-gen-kaja-twirp/protoc-gen-kaja-twirp.go
RUN GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -o kaja-twirp ./cmd/kaja-twirp/kaja-twirp.go

FROM alpine AS runner
WORKDIR /app
COPY --from=builder /workspace/protoc-gen-kaja-twirp .
COPY --from=builder /workspace/kaja-twirp .
COPY --from=builder /workspace/script/ ./script
COPY --from=builder /workspace/web/ ./web
RUN apk update && apk add --no-cache make protobuf-dev

EXPOSE 41520

CMD [ "./script/run" ]