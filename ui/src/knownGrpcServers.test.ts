import { describe, expect, it } from "bun:test";
import { knownGrpcServerFor, knownGrpcServers, matchingGrpcServers } from "./knownGrpcServers";

describe("knownGrpcServerFor", () => {
  it("matches the server as it is bundled, written however", () => {
    expect(knownGrpcServerFor("grpcb.in:9000")?.name).toBe("grpcb.in");
    expect(knownGrpcServerFor(" dns:///GRPCB.IN:9000 ")?.name).toBe("grpcb.in");
  });

  it("says nothing about another port on the same host", () => {
    expect(knownGrpcServerFor("grpcb.in:9001")).toBeUndefined();
    expect(knownGrpcServerFor("")).toBeUndefined();
  });
});

describe("matchingGrpcServers", () => {
  it("offers every server until something is typed", () => {
    expect(matchingGrpcServers("")).toEqual(knownGrpcServers);
  });

  it("matches a name or an address", () => {
    expect(matchingGrpcServers("grpcb").map((server) => server.name)).toEqual(["grpcb.in"]);
    expect(matchingGrpcServers(":9000").map((server) => server.name)).toEqual(["grpcb.in"]);
    expect(matchingGrpcServers("example.com")).toEqual([]);
  });
});
