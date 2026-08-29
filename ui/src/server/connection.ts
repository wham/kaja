import { GrpcWebFetchTransport } from "@protobuf-ts/grpcweb-transport";
import { ApiClient } from "./api.client";
import { Transport } from "../apps";
import { WailsTransport } from "./wails-transport";
import { isWailsEnvironment } from "../wails";

export function getApiClient(): ApiClient {
  // Always check environment fresh - don't cache if we're in a transitional state
  const isWails = isWailsEnvironment();
  if (isWails) {
    return new ApiClient(new WailsTransport({ mode: "api", protocol: Transport.GRPC }));
  } else {
    return new ApiClient(
      new GrpcWebFetchTransport({
        baseUrl: getBaseUrlForApi(),
      }),
    );
  }
}

// api.proto declares no package, so the transport appends /Api/<Method> to this.
export function getBaseUrlForApi(): string {
  return servedFrom();
}

export function getBaseUrlForTarget(): string {
  return `${servedFrom()}/target`;
}

// Where a REST app's calls go. Its own door rather than /target's, because what
// crosses is an HTTP request the browser built rather than an encoded message.
export function getBaseUrlForRest(): string {
  return `${servedFrom()}/rest`;
}

export function getBaseUrlForAi(): string {
  return `${servedFrom()}/ai`;
}

/**
 * Where this page is served from, which is not the same as where it currently
 * points. A deeplink names its script in the fragment (`/#run/<script>?…`), and
 * appending a path to a URL that carries a query or a fragment puts the path
 * inside one — `…/#run/nightly/target` resolves back to `/`, so every call lands
 * on index.html and comes back as a protobuf that won't decode.
 */
function servedFrom(): string {
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  return trimTrailingSlash(url.href);
}

function trimTrailingSlash(s: string): string {
  return s.replace(/\/+$/, "");
}
