import { createLucideIcon, type LucideIcon } from "lucide-react";

/**
 * Each mark echoes what its protocol already looks or sounds like, so no two share a
 * silhouette: gRPC is the g of its wordmark, OpenAPI the initiative's ring with a spoke
 * out to an endpoint, MCP two interlocked hooks after its woven mark, Twirp a twirl.
 */

export const GrpcMark: LucideIcon = createLucideIcon("grpc", [
  ["circle", { cx: "11", cy: "10.5", r: "4.5", key: "grpc-bowl" }],
  ["path", { d: "M15.5 6v10.5a4.5 4.5 0 0 1-8.2 2.5", key: "grpc-tail" }],
]);

export const OpenApiMark: LucideIcon = createLucideIcon("openapi", [
  ["circle", { cx: "10.5", cy: "13.5", r: "6.5", key: "openapi-ring" }],
  ["path", { d: "M10.5 13.5l6.7-6.7", key: "openapi-spoke" }],
  ["circle", { cx: "18.5", cy: "5.5", r: "1.75", key: "openapi-endpoint" }],
]);

export const McpMark: LucideIcon = createLucideIcon("mcp", [
  ["path", { d: "M5 11.5l6-6a3.54 3.54 0 0 1 5 5L10.5 16", key: "mcp-hook-1" }],
  ["path", { d: "M19 12.5l-6 6a3.54 3.54 0 0 1-5-5L13.5 8", key: "mcp-hook-2" }],
]);

export const TwirpMark: LucideIcon = createLucideIcon("twirp", [
  ["path", { d: "M12 12a2 2 0 0 1 4 0a4 4 0 0 1-8 0a6 6 0 0 1 12 0a8 8 0 0 1-8 8", key: "twirp-twirl" }],
]);
