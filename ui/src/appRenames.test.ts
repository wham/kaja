import { describe, it, expect } from "bun:test";
import { appModulesMoved, detectAppRenames } from "./appRenames";
import { ConfigurationApp } from "./server/api";

function grpc(name: string, url: string): ConfigurationApp {
  return { name, app: { oneofKind: "grpc", grpc: { url, headers: {} } } } as unknown as ConfigurationApp;
}

function openapi(name: string, specUrl: string): ConfigurationApp {
  return { name, app: { oneofKind: "openapi", openapi: { specUrl, headers: {} } } } as unknown as ConfigurationApp;
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

describe("appModulesMoved", () => {
  it("is true for a rename, an addition and a removal", () => {
    expect(appModulesMoved([grpc("a", "x")], [grpc("b", "x")], none, none)).toBe(true);
    expect(appModulesMoved([grpc("a", "x")], [grpc("a", "x"), grpc("b", "y")], none, none)).toBe(true);
    expect(appModulesMoved([grpc("a", "x")], [], none, none)).toBe(true);
  });

  it("is true when an app is reopened against different parameters", () => {
    expect(appModulesMoved([grpc("a", "x")], [grpc("a", "y")], none, none)).toBe(true);
  });

  it("is false when only the headers moved, which are per request", () => {
    const before = { name: "a", app: { oneofKind: "grpc", grpc: { url: "x", headers: {} } } } as unknown as ConfigurationApp;
    const after = { name: "a", app: { oneofKind: "grpc", grpc: { url: "x", headers: { Authorization: "Bearer t" } } } } as unknown as ConfigurationApp;
    expect(appModulesMoved([before], [after], none, none)).toBe(false);
  });
});
