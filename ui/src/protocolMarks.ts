import { createLucideIcon, type LucideIcon } from "lucide-react";

/**
 * The four protocol marks — the one place an icon in Kaja is not lucide's own.
 *
 * A tree full of words needs the mark to say what kind of app a method belongs to, and
 * lucide has no gRPC. `Server` / `Globe` / `Plug` / `Blocks` stood in for four
 * protocols that are all servers reached over the wire, so none of them told the four
 * apart. These do, in one language: **a node and what leaves it.** gRPC is two nodes on
 * a double rail (streams both ways), OpenAPI a node fanning to three endpoints (paths),
 * Twirp a node reaching one box (one request, one response), MCP a hexagon around a
 * node — the one that is a tool rather than a wire.
 *
 * They are built with lucide's own factory so they arrive on its grid (24 viewBox, 2px
 * round stroke, `size` in props) and type as a `LucideIcon`: everywhere an app type is
 * shown takes them without knowing they are ours. The test each has to pass is 13px in
 * muted grey — the tree and the finder — rather than how it looks at 40.
 */

export const GrpcMark: LucideIcon = createLucideIcon("grpc", [
  ["circle", { cx: "6", cy: "12", r: "2.5", key: "grpc-in" }],
  ["circle", { cx: "18", cy: "12", r: "2.5", key: "grpc-out" }],
  ["path", { d: "M8.5 9.5h7M8.5 14.5h7", key: "grpc-rail" }],
]);

export const OpenApiMark: LucideIcon = createLucideIcon("openapi", [
  ["circle", { cx: "6", cy: "12", r: "2.5", key: "openapi-in" }],
  ["path", { d: "M8.5 12h6M8.3 10.8 16 6M8.3 13.2 16 18", key: "openapi-fan" }],
  ["circle", { cx: "18", cy: "12", r: "1.25", key: "openapi-path-2" }],
  ["circle", { cx: "18", cy: "5", r: "1.25", key: "openapi-path-1" }],
  ["circle", { cx: "18", cy: "19", r: "1.25", key: "openapi-path-3" }],
]);

export const McpMark: LucideIcon = createLucideIcon("mcp", [
  ["path", { d: "M12 3l7.8 4.5v9L12 21l-7.8-4.5v-9z", key: "mcp-hex" }],
  ["circle", { cx: "12", cy: "12", r: "2.5", key: "mcp-node" }],
]);

export const TwirpMark: LucideIcon = createLucideIcon("twirp", [
  ["circle", { cx: "6", cy: "12", r: "2.5", key: "twirp-in" }],
  ["path", { d: "M8.5 12H15", key: "twirp-wire" }],
  ["rect", { x: "15", y: "8.5", width: "5", height: "7", rx: "1", key: "twirp-out" }],
]);
