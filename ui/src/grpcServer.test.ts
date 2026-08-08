import { describe, expect, test } from "bun:test";
import { GrpcServer } from "./server/api";
import {
  AUTH_APIKEY,
  AUTH_BASIC,
  AUTH_BEARER,
  DEFAULT_API_KEY_NAME,
  TLS_AUTO,
  TLS_OFF,
  TLS_ON,
  apiKeyName,
  authNote,
  deriveAppName,
  isDialableTarget,
  nameFromAddress,
  streamingMethods,
  targetHost,
  tlsFromServer,
  uniqueAppName,
} from "./grpcServer";

function server(fields: Partial<GrpcServer> = {}): GrpcServer {
  return {
    source: "reflection",
    target: "",
    tls: false,
    reachable: true,
    services: [],
    methodCount: 0,
    reflectionVersion: "",
    fileCount: 0,
    protoDir: "",
    ...fields,
  };
}

describe("targetHost", () => {
  test("reads the host out of every spelling of a gRPC address", () => {
    expect(targetHost("dns:seating.kaja.tools:443")).toBe("seating.kaja.tools");
    expect(targetHost("dns:///seating.kaja.tools:443")).toBe("seating.kaja.tools");
    expect(targetHost("grpcs://seating.kaja.tools")).toBe("seating.kaja.tools");
    expect(targetHost("grpcb.in:9000")).toBe("grpcb.in");
    expect(targetHost("https://example.com/twirp")).toBe("example.com");
    expect(targetHost("  localhost:50051  ")).toBe("localhost");
  });

  test("keeps an IPv6 literal whole", () => {
    expect(targetHost("[::1]:50051")).toBe("::1");
  });

  test("says nothing about an empty address", () => {
    expect(targetHost("")).toBe("");
  });
});

describe("isDialableTarget", () => {
  test("asks only for a host", () => {
    expect(isDialableTarget("dns:seating.kaja.tools:443")).toBe(true);
    expect(isDialableTarget("localhost:50051")).toBe(true);
    expect(isDialableTarget("")).toBe(false);
    expect(isDialableTarget("   ")).toBe(false);
  });

  test("takes an address that reads a variable on trust", () => {
    expect(isDialableTarget("${SEATING_URL}")).toBe(true);
    expect(isDialableTarget("dns:${HOST}:443")).toBe(true);
  });
});

describe("deriveAppName", () => {
  test("names an app after the subdomain that identifies it", () => {
    expect(deriveAppName("dns:seating.kaja.tools:443", [])).toBe("seating");
  });

  test("keeps a two-label host as written, since it is already a handle", () => {
    expect(deriveAppName("grpcb.in:9000", [])).toBe("grpcb.in");
  });

  test("skips a label that says only that it is an API", () => {
    expect(deriveAppName("grpcs://api.example.com", [])).toBe("example");
    expect(deriveAppName("grpc.acme.io:443", [])).toBe("acme");
  });

  test("falls back to the services when the host names the machine", () => {
    expect(deriveAppName("localhost:50051", ["seating.Seating"])).toBe("seating");
    expect(deriveAppName("127.0.0.1:50051", ["grpcbin.GRPCBin"])).toBe("grpcbin");
    expect(deriveAppName("[::1]:50051", ["Health"])).toBe("Health");
  });

  test("has nothing to offer when neither says anything", () => {
    expect(deriveAppName("localhost:50051", [])).toBe("");
    expect(deriveAppName("", [])).toBe("");
  });
});

describe("nameFromAddress", () => {
  test("is the half of the name the address can answer", () => {
    expect(nameFromAddress("dns:seating.kaja.tools:443")).toBe("seating");
    expect(nameFromAddress("grpcb.in:9000")).toBe("grpcb.in");
  });

  test("says nothing about an address that names the machine, or none at all", () => {
    expect(nameFromAddress("localhost:50051")).toBe("");
    expect(nameFromAddress("")).toBe("");
  });
});

describe("uniqueAppName", () => {
  test("numbers a name that is taken", () => {
    expect(uniqueAppName("seating", ["seating"])).toBe("seating2");
    expect(uniqueAppName("seating", ["seating", "seating2"])).toBe("seating3");
  });

  test("leaves a free name alone", () => {
    expect(uniqueAppName("seating", ["quirks"])).toBe("seating");
  });
});

describe("apiKeyName", () => {
  test("defaults, and lower-cases, because metadata keys are", () => {
    expect(apiKeyName("")).toBe(DEFAULT_API_KEY_NAME);
    expect(apiKeyName("  ")).toBe(DEFAULT_API_KEY_NAME);
    expect(apiKeyName("X-Tenant-Key")).toBe("x-tenant-key");
  });
});

describe("authNote", () => {
  test("shows a wire format as one", () => {
    expect(authNote(AUTH_BEARER, "")).toEqual({ text: "authorization: Bearer ‹token›", mono: true });
    expect(authNote(AUTH_APIKEY, "X-Api-Token")).toEqual({ text: "x-api-token: ‹key›", mono: true });
  });

  test("says who does the encoding for Basic", () => {
    expect(authNote(AUTH_BASIC, "").mono).toBe(false);
  });
});

describe("tlsFromServer", () => {
  test("records the transport that answered", () => {
    expect(tlsFromServer(server({ tls: true }))).toBe(TLS_ON);
    expect(tlsFromServer(server({ tls: false }))).toBe(TLS_OFF);
  });

  test("settles nothing when the server never answered", () => {
    expect(tlsFromServer(server({ reachable: false, tls: false }))).toBe(TLS_AUTO);
  });
});

describe("streamingMethods", () => {
  test("counts what gRPC-Web can't carry", () => {
    const counted = server({
      services: [
        { name: "a.A", methodCount: 4, streamingMethodCount: 1 },
        { name: "b.B", methodCount: 2, streamingMethodCount: 2 },
      ],
    });
    expect(streamingMethods(counted)).toBe(3);
  });
});
