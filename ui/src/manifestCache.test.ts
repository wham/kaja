import { describe, expect, it } from "bun:test";
import { manifestFingerprint, matchesStored } from "./manifestCache";
import { WorkspaceApp } from "./server/api";

function grpc(name: string, url: string, headers: { [key: string]: string } = {}): WorkspaceApp {
  return { name, app: { oneofKind: "grpc", grpc: { url, protoDir: "", headers } } } as unknown as WorkspaceApp;
}

describe("manifestFingerprint", () => {
  it("is the type and the parameters, so a rename and a header change keep the head start", () => {
    const a = manifestFingerprint(grpc("grpcbin", "localhost:50051"));
    expect(manifestFingerprint(grpc("stage", "localhost:50051"))).toBe(a);
    expect(manifestFingerprint(grpc("grpcbin", "localhost:50051", { Authorization: "Bearer ${TOKEN}" }))).toBe(a);
  });

  it("moves with a parameter", () => {
    expect(manifestFingerprint(grpc("grpcbin", "localhost:50051"))).not.toBe(manifestFingerprint(grpc("grpcbin", "localhost:50052")));
  });

  it("moves with the type", () => {
    const twirp = { name: "grpcbin", app: { oneofKind: "twirp", twirp: { url: "localhost:50051", protoDir: "", headers: {} } } } as unknown as WorkspaceApp;
    expect(manifestFingerprint(twirp)).not.toBe(manifestFingerprint(grpc("grpcbin", "localhost:50051")));
  });
});

describe("matchesStored", () => {
  const app = grpc("grpcbin", "localhost:50051");

  it("takes a manifest stored for this configuration", () => {
    expect(matchesStored(app, { fingerprint: manifestFingerprint(app), manifest: "{}" })).toBe(true);
  });

  it("refuses one stored for another, nothing stored, and an empty manifest", () => {
    expect(matchesStored(app, { fingerprint: manifestFingerprint(grpc("grpcbin", "elsewhere")), manifest: "{}" })).toBe(false);
    expect(matchesStored(app, undefined)).toBe(false);
    expect(matchesStored(app, { fingerprint: manifestFingerprint(app), manifest: "" })).toBe(false);
  });
});
