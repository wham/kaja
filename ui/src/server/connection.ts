import { TwirpFetchTransport } from "@protobuf-ts/twirp-transport";
import { ApiClient } from "./api.client";
import { WailsTransport } from "./wails-transport";
import { isWailsEnvironment } from "../wails";

export function getApiClient(): ApiClient {
  // Always check environment fresh - don't cache if we're in a transitional state
  const isWails = isWailsEnvironment();
  console.log("getApiClient() called - Creating API client for environment:", isWails ? "Wails" : "Web");

  if (isWails) {
    console.log("Using WailsTransport in API mode");
    return new ApiClient(new WailsTransport({ mode: "api", protocol: 0 }));
  } else {
    console.log("Using TwirpFetchTransport with baseUrl:", getBaseUrlForApi());
    return new ApiClient(
      new TwirpFetchTransport({
        baseUrl: getBaseUrlForApi(),
      }),
    );
  }
}

export function getBaseUrlForApi(): string {
  const currentUrl = trimTrailingSlash(window.location.href);
  return `${currentUrl}/twirp`;
}

export function getBaseUrlForTarget(): string {
  const currentUrl = trimTrailingSlash(window.location.href);
  return `${currentUrl}/target`;
}

export function getBaseUrlForAi(): string {
  const currentUrl = trimTrailingSlash(window.location.href);
  return `${currentUrl}/ai`;
}

function trimTrailingSlash(s: string): string {
  return s.replace(/\/+$/, "");
}
