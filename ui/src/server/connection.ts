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
  const currentUrl = trimTrailingSlash(window.location.href);
  return `${currentUrl}/twirp`;
}

function trimTrailingSlash(s: string): string {
  return s.replace(/\/+$/, "");
}
