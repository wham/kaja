# syntax=docker/dockerfile:1

FROM alpine:latest as builder
COPY app app
RUN apk add --update nodejs npm
WORKDIR /app
RUN npm ci --omit=dev
RUN npm run clean-modules
# Both use the same version of typescript but npm can't dedupe them. Patch here with a symlink instead. Saves 50MB of space.
RUN rm -rf /app/node_modules/@protobuf-ts/plugin-framework/node_modules/typescript
RUN ln -sf /app/node_modules/@protobuf-ts/plugin/node_modules/typescript /app/node_modules/@protobuf-ts/plugin-framework/node_modules

FROM alpine:latest as runner
COPY --from=builder /app /app
RUN apk add --update nodejs npm
WORKDIR /app
EXPOSE 41520
CMD ["npm", "start"]