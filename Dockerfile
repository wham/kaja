# syntax=docker/dockerfile:1

FROM alpine:latest as builder
RUN apk add --update nodejs npm
COPY --from=golang:1.22.4-alpine /usr/local/go/ /usr/local/go/
ENV PATH="/usr/local/go/bin:${PATH}"


COPY client /client
WORKDIR /client
RUN npm ci --omit=dev

COPY server /server
WORKDIR /server
RUN go run cmd/build-assets/build-assets.go
RUN go build -o /bin/kaja-twirp ./cmd/kaja-twirp

FROM alpine:latest as runner
COPY --from=builder /bin/kaja-twirp /app/
COPY --from=builder /bin/protoc-gen-ts /bin/
RUN apk add --update nodejs
RUN apk update && apk add --no-cache make protobuf-dev
WORKDIR /app
EXPOSE 41520
#CMD ["sh", "-c", "sleep 10000000 && ./kaja-twirp"]
CMD ["./kaja-twirp"]