import { TwirpFetchTransport } from "@protobuf-ts/twirp-transport";
import { ApiClient } from "./api.client";

export function getApiClient(): ApiClient {
  return new ApiClient(
    new TwirpFetchTransport({
      baseUrl: getBaseUrlForApi(),
    }),
  );
}

export function getBaseUrlForApi(): string {
  const currentUrl = trimTrailingSlash(window.location.href);
  return `${currentUrl}/twirp`;
}

export function getBaseUrlForTarget(): string {
  const currentUrl = trimTrailingSlash(window.location.href);
  return `${currentUrl}/target`;
}

function trimTrailingSlash(s: string): string {
  return s.replace(/\/+$/, "");
}
