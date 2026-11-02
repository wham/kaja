import { describe, it, expect } from "bun:test";
import { appReferencesVariable, detectAppRenames } from "./appRenames";
import { WorkspaceApp } from "./server/api";

function grpc(name: string, url: string): WorkspaceApp {
  return { name, app: { oneofKind: "grpc", grpc: { url, headers: {} } } } as unknown as WorkspaceApp;
}

function openapi(name: string, specUrl: string): WorkspaceApp {
  return { name, app: { oneofKind: "openapi", openapi: { specUrl, headers: {} } } } as unknown as WorkspaceApp;
}

const none = {};

describe("detectAppRenames", () => {
  it("reads a name that left and a name that arrived describing the same server as one rename", () => {
    const renames = detectAppRenames([grpc("OpenMeter", "dns:api:443")], [grpc("OpenMeterDev", "dns:api:443")], none, none);
    expect([...renames]).toEqual([["OpenMeter", "OpenMeterDev"]]);
  });

  it("says nothing about an app whose parameters moved with its name", () => {
    const renames = detectAppRenames([grpc("OpenMeter", "dns:api:443")], [grpc("OpenMeterDev", "dns:staging:443")], none, none);
    expect(renames.size).toBe(0);
  });

  it("says nothing about an app deleted or added on its own", () => {
    expect(detectAppRenames([grpc("a", "x")], [], none, none).size).toBe(0);
    expect(detectAppRenames([], [grpc("a", "x")], none, none).size).toBe(0);
  });

  it("leaves the apps that stayed alone", () => {
    const previous = [grpc("a", "x"), openapi("b", "y")];
    const next = [grpc("a", "x"), openapi("c", "y")];
    expect([...detectAppRenames(previous, next, none, none)]).toEqual([["b", "c"]]);
  });

  it("pairs each newcomer with one orphan", () => {
    const previous = [grpc("a", "x"), grpc("b", "x")];
    const next = [grpc("c", "x"), grpc("d", "x")];
    expect([...detectAppRenames(previous, next, none, none)].length).toBe(2);
  });

  it("is not a rename when a ${NAME} the app reads changed under it", () => {
    const previous = [grpc("a", "dns:${HOST}:443")];
    const next = [grpc("b", "dns:${HOST}:443")];
    expect(detectAppRenames(previous, next, { HOST: "one" }, { HOST: "two" }).size).toBe(0);
    expect(detectAppRenames(previous, next, { HOST: "one" }, { HOST: "one" }).size).toBe(1);
  });
});

describe("appReferencesVariable", () => {
  it("names an app that expands it in a parameter", () => {
    expect(appReferencesVariable(grpc("a", "dns:${HOST}:443"), new Set(["HOST"]))).toBe(true);
    expect(appReferencesVariable(grpc("a", "dns:${HOST}:443"), new Set(["TOKEN"]))).toBe(false);
  });

  it("leaves an app that only sends it as a header, which is expanded per call", () => {
    const app = { name: "a", app: { oneofKind: "grpc", grpc: { url: "x", headers: { Authorization: "Bearer ${TOKEN}" } } } } as unknown as WorkspaceApp;
    expect(appReferencesVariable(app, new Set(["TOKEN"]))).toBe(false);
  });
});
