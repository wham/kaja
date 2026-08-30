import { GrpcWebFetchTransport } from "@protobuf-ts/grpcweb-transport";
import { ApiClient } from "./api.client";

/**
 * How every call kaja makes is framed, on the Api lane and the app lane alike. The
 * transport's own default is base64, which is a third more bytes on the way out and,
 * coming back, a frame that cannot be read until the base64 group its last bytes land
 * in is complete - which on a stream is a message held until the next one.
 */
export const GRPC_WEB_FORMAT = "binary" as const;

export function getApiClient(): ApiClient {
  return new ApiClient(
    new GrpcWebFetchTransport({
      baseUrl: getBaseUrlForApi(),
      format: GRPC_WEB_FORMAT,
    }),
  );
}

// api.proto declares no package, so the transport appends /Api/<Method> to this.
export function getBaseUrlForApi(): string {
  return servedFrom();
}

// Where an app's calls go. The transport appends the method path; which app the call
// belongs to is the reserved header it already carries, so the address never varies.
export function getBaseUrlForApp(): string {
  return `${servedFrom()}/app`;
}

/**
 * Where this page is served from, which is not the same as where it currently
 * points. A deeplink names its script in the fragment (`/#run/<script>?…`), and
 * appending a path to a URL that carries a query or a fragment puts the path
 * inside one — `…/#run/nightly/app` resolves back to `/`, so every call lands
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
