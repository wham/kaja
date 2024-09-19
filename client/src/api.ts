import { TwirpFetchTransport } from "@protobuf-ts/twirp-transport";
import { ServerClient } from "./server/server.client";

export function getServerClient(): ServerClient {
  return new ServerClient(
    new TwirpFetchTransport({
      baseUrl: getBaseUrl(),
    }),
  );
}

export function getBaseUrl(): string {
  const url = new URL(window.location.href);
  return url.origin + "/twirp";
}
