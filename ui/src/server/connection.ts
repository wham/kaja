import { TwirpFetchTransport } from "@protobuf-ts/twirp-transport";
import { ApiClient } from "./api.client";
import { WailsTransport } from "./wails-transport";

/**
 * Detects if we're running in a Wails desktop environment
 */
function isWailsEnvironment(): boolean {
  // Check for Wails runtime first - this is the most reliable indicator
  const hasRuntime = typeof window !== "undefined" && typeof (window as any).runtime !== "undefined";
  const hasGoBindings = typeof (window as any).go?.main?.App !== "undefined";
  
  console.log('Environment detection:', {
    hasWindow: typeof window !== "undefined",
    hasRuntime,
    hasGoBindings,
    windowGo: typeof (window as any).go,
    isWails: hasRuntime && hasGoBindings
  });
  
  return hasRuntime && hasGoBindings;
}

export function getApiClient(): ApiClient {
  const isWails = isWailsEnvironment();
  console.log('Creating API client for environment:', isWails ? 'Wails' : 'Web');
  
  if (isWails) {
    console.log('Using WailsTransport');
    return new ApiClient(new WailsTransport());
  } else {
    console.log('Using TwirpFetchTransport with baseUrl:', getBaseUrlForApi());
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
