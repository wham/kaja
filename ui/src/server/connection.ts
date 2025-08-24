import { TwirpFetchTransport } from "@protobuf-ts/twirp-transport";
import { ApiClient } from "./api.client";
import { WailsTransport } from "./wails-transport";
import { isWailsEnvironment } from "../wails";

// Immediate logging when module loads
console.log("connection.ts module loaded", {
  hasWindow: typeof window !== "undefined",
  hasRuntime: typeof window !== "undefined" && typeof (window as any).runtime !== "undefined",
  hasGo: typeof window !== "undefined" && typeof (window as any).go !== "undefined",
  windowGo: typeof window !== "undefined" ? (window as any).go : undefined,
});

// Also log after a short delay to see if bindings load later
setTimeout(() => {
  console.log("connection.ts delayed check", {
    hasWindow: typeof window !== "undefined",
    hasRuntime: typeof window !== "undefined" && typeof (window as any).runtime !== "undefined",
    hasGo: typeof window !== "undefined" && typeof (window as any).go !== "undefined",
    windowGo: typeof window !== "undefined" ? (window as any).go : undefined,
  });
}, 1000);

let cachedClient: ApiClient | null = null;

export function getApiClient(): ApiClient {
  // Always check environment fresh - don't cache if we're in a transitional state
  const isWails = isWailsEnvironment();
  console.log("getApiClient() called - Creating API client for environment:", isWails ? "Wails" : "Web");

  if (isWails) {
    console.log("Using WailsTransport in API mode");
    return new ApiClient(new WailsTransport({ mode: "api" }));
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
