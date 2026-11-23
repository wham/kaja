import { describe, expect, it } from "bun:test";
import { knownGrpcServerFor, knownGrpcServers, matchingGrpcServers } from "./knownGrpcServers";

describe("knownGrpcServerFor", () => {
  it("matches the server as it is bundled, written however", () => {
    expect(knownGrpcServerFor("demo.connectrpc.com:443")?.name).toBe("Eliza");
    expect(knownGrpcServerFor(" dns:///DEMO.CONNECTRPC.COM:443 ")?.name).toBe("Eliza");
  });

  it("says nothing about another port on the same host", () => {
    expect(knownGrpcServerFor("demo.connectrpc.com:8443")).toBeUndefined();
    expect(knownGrpcServerFor("")).toBeUndefined();
  });
});

describe("matchingGrpcServers", () => {
  it("offers every server until something is typed", () => {
    expect(matchingGrpcServers("")).toEqual(knownGrpcServers);
  });

  it("matches a name or an address", () => {
    expect(matchingGrpcServers("eli").map((server) => server.name)).toEqual(["Eliza"]);
    expect(matchingGrpcServers("connectrpc").map((server) => server.name)).toEqual(["Eliza"]);
    expect(matchingGrpcServers("example.com")).toEqual([]);
  });
});
