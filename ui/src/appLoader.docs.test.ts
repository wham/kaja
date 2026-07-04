import { describe, it, expect } from "bun:test";
import { loadApp } from "./appLoader";
import type { Source as ApiSource } from "./server/api";

// createClients reads window.location for the base URL; provide it as the browser would.
(globalThis as any).window = { location: { href: "http://localhost/" } };

// A generated service source (.ts) + its client interface (.client.ts) with the
// JSDoc protoc-gen-kaja emits from proto doc comments. Verifies the doc survives
// into the kaja service model that Monaco reads for hover/autocomplete.
const serviceTs = `
import { ServiceType } from "@protobuf-ts/runtime-rpc";
export interface SumRequest { a: number; b: number; }
export interface SumResponse { v: number; }
export const Add = new ServiceType("Add", []);
`;

const clientTs = `
import type { RpcOptions, UnaryCall } from "@protobuf-ts/runtime-rpc";
import type { SumRequest, SumResponse } from "./addsvc";
/**
 * @generated from protobuf service Add
 */
export interface IAddClient {
    /**
     * Sums two integers.
     *
     * @generated from protobuf rpc: Sum
     */
    sum(input: SumRequest, options?: RpcOptions): UnaryCall<SumRequest, SumResponse>;
}
`;

// Minimal stub module exporting a ServiceInfo-like object keyed by stubModuleId.
const stubCode = `
export const proto$addsvc = {
  Add: { typeName: "addsvc.Add", methods: [{ name: "Sum", serverStreaming: false, clientStreaming: false }] },
};
export const proto$addsvc$client = { AddClient: class { sum() {} } };
`;

describe("proto doc comments in service model", () => {
  it("carries method JSDoc into the generated kaja service source", async () => {
    const apiSources: ApiSource[] = [
      { path: "proto/addsvc.ts", content: serviceTs },
      { path: "proto/addsvc.client.ts", content: clientTs },
    ] as ApiSource[];

    const app = await loadApp(apiSources, stubCode, { name: "grpcbin" } as any, "kaja-app://x", "grpc" as any);
    const serviceSource = app.sources.find((s) => s.serviceNames.includes("Add"));
    expect(serviceSource).toBeDefined();
    const text = serviceSource!.file.text;

    expect(text).toContain("Sums two integers.");
    expect(text).toContain("Sum: async (input: SumRequest)");
    // JSDoc must be attached to the method, not floating elsewhere.
    const idx = text.indexOf("Sum: async");
    const before = text.slice(Math.max(0, idx - 200), idx);
    expect(before).toContain("Sums two integers.");
  });
});
