import { GrpcWebFetchTransport } from "@protobuf-ts/grpcweb-transport";
import { ApiClient } from "./api.client";

export function getApiClient(): ApiClient {
  return new ApiClient(
    new GrpcWebFetchTransport({
      baseUrl: getBaseUrlForApi(),
    }),
  );
}

// api.proto declares no package, so the transport appends /Api/<Method> to this.
export function getBaseUrlForApi(): string {
  return servedFrom();
}

export function getBaseUrlForTarget(): string {
  return `${servedFrom()}/target`;
}

/**
 * Where this page is served from, which is not the same as where it currently
 * points. A deeplink names its script in the fragment (`/#run/<script>?…`), and
 * appending a path to a URL that carries a query or a fragment puts the path
 * inside one — `…/#run/nightly/target` resolves back to `/`, so every call lands
 * on index.html and comes back as a protobuf that won't decode.
 *
 * The desktop is served from `wails://localhost/`, which is a page origin like
 * any other: the webview fetches the mux the app mounts behind its own scheme.
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
