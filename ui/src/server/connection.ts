import { TwirpFetchTransport } from "@protobuf-ts/twirp-transport";
import { ApiClient } from "./api.client";

export function getApiClient(): ApiClient {
  return new ApiClient(
    new TwirpFetchTransport({
      baseUrl: getBaseUrl(),
    }),
  );
}

export function getBaseUrl(): string {
  const url = new URL(window.location.href);
  return window.location.href + "twirp";
}
