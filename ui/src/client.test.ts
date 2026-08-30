import { describe, expect, it } from "bun:test";
import type { RpcOptions } from "@protobuf-ts/runtime-rpc";
import { createAppRef, Service } from "./apps";
import { Kaja, KajaHost, MethodCall } from "./kaja";
import { LogLevel } from "./server/api";
import { classifyFailure } from "./callFailure";
import { UNSUPPORTED_CODE } from "./streaming";

// The client asks where the page is served from when it builds its transport, which
// is the one thing about a browser these tests need to be in.
(globalThis as unknown as { window: unknown }).window = { location: { href: "http://localhost:41520/" } };

const { createClient } = await import("./client");

// What the stub was called with — the only question these tests ask of the transport.
const sent: { message: unknown; options: RpcOptions }[] = [];

// Set by the one test about a call that was refused; a call is answered otherwise.
let refuse: Error | undefined;

class FakeShowsClient {
  readonly methods = [{ name: "ListShows" }];

  constructor(_transport: unknown) {}

  // A method that streams from the client is refused before the transport is reached,
  // so this is here to record that it never was.
  upload(message: unknown, options: RpcOptions) {
    sent.push({ message, options });
    return { response: Promise.resolve({}), headers: Promise.resolve({}), trailers: Promise.resolve({}) };
  }

  listShows(message: unknown, options: RpcOptions) {
    sent.push({ message, options });
    if (refuse) {
      return { response: Promise.reject(refuse), headers: Promise.reject(refuse), trailers: Promise.reject(refuse) };
    }
    return {
      response: Promise.resolve({ shows: [] }),
      headers: Promise.resolve({ "content-type": "application/grpc-web+proto" }),
      trailers: Promise.resolve({
        // What the app exchanged with the API it carried the call to.
        "kaja-upstream-response-headers": JSON.stringify({ "X-RateLimit-Remaining": "42" }),
      }),
    };
  }
}

const service: Service = {
  name: "Shows",
  packageName: "theatre",
  sourcePath: "theatre",
  clientStubModuleId: "theatre.client",
  methods: [{ name: "ListShows" }],
};

const app = {
  name: "theatre",
  app: {
    oneofKind: "grpc",
    grpc: { headers: { "X-Tenant": "acme", Authorization: "Bearer ${TOKEN}" } },
  },
};

function client() {
  sent.length = 0;
  refuse = undefined;
  const calls: MethodCall[] = [];
  const kaja: Kaja = new KajaHost().run({
    onMethodCallUpdate: (methodCall) => void calls.push(methodCall),
    onAsk: () => Promise.reject(new Error("not asked")),
    onApprove: () => Promise.resolve("all" as const),
    onBlockUpdate: () => {},
    onLog: (_level: LogLevel, _message: string) => {},
  });
  const stub = { serviceInfos: {}, "theatre.client": { ShowsClient: FakeShowsClient } };
  const appRef = createAppRef(app as never, "https://theatre.example");
  return { methods: createClient(service, stub, appRef).methodsFor(kaja), calls };
}

const meta = () => sent[0].options.meta as Record<string, string>;

describe("a call's headers", () => {
  it("sends the app's own where the call says nothing", async () => {
    const { methods } = client();
    await methods.ListShows({ pageSize: 25 });
    expect(meta()["X-Header-X-Tenant"]).toBe("acme");
    expect(meta()["X-Header-Authorization"]).toBe("Bearer ${TOKEN}");
  });

  it("lays the call's own over them, replacing by name whatever the case", async () => {
    const { methods } = client();
    await methods.ListShows({}, { headers: { authorization: "Bearer other", "Idempotency-Key": "k1" } });
    expect(meta()["X-Header-authorization"]).toBe("Bearer other");
    expect(meta()["X-Header-Authorization"]).toBeUndefined();
    expect(meta()["X-Header-Idempotency-Key"]).toBe("k1");
    expect(meta()["X-Header-X-Tenant"]).toBe("acme");
  });

  it("names the app the call belongs to, and where it is going", async () => {
    const { methods } = client();
    await methods.ListShows({});
    expect(meta()["X-Header-X-Kaja-App"]).toBe("theatre");
    expect(meta()["X-Target"]).toBe("https://theatre.example");
  });

  it("shows the call's whole set as written, references intact", async () => {
    const { methods, calls } = client();
    await methods.ListShows({}, { headers: { "Idempotency-Key": "k1" } });
    expect(calls[0].requestHeaders).toEqual({
      "X-Tenant": "acme",
      Authorization: "Bearer ${TOKEN}",
      "Idempotency-Key": "k1",
    });
  });

  it("refuses the reserved one where it is written, rather than sending it", () => {
    const { methods } = client();
    expect(() => methods.ListShows({}, { headers: { "x-kaja-app": "somebody-else" } })).toThrow("X-Kaja-App");
    expect(sent).toHaveLength(0);
  });

  it("hands them back on a refusal, which is when they say why", async () => {
    const { methods } = client();
    refuse = Object.assign(new Error("unauthenticated"), {
      code: "UNAUTHENTICATED",
      meta: { "WWW-Authenticate": "Bearer" },
    });
    // A failed call is reported rather than thrown, so it is the response that is
    // missing — the headers it was refused with are there to be read.
    expect(await methods.ListShows({}).withHeaders()).toEqual({
      response: undefined,
      headers: { "www-authenticate": "Bearer" },
    });
  });

  it("hands back the response with what the API answered with beside it", async () => {
    const { methods } = client();
    const { response, headers } = await methods.ListShows({}).withHeaders();
    expect(response).toEqual({ shows: [] });
    expect(headers).toEqual({ "x-ratelimit-remaining": "42" });
  });
});

describe("a method that streams from the client", () => {
  const streaming: Service = { ...service, methods: [{ name: "Upload", clientStreaming: true }] };

  function streamingClient() {
    sent.length = 0;
    const calls: MethodCall[] = [];
    const kaja: Kaja = new KajaHost().run({
      onMethodCallUpdate: (methodCall) => void calls.push(methodCall),
      onAsk: () => Promise.reject(new Error("not asked")),
      onApprove: () => Promise.resolve("all" as const),
      onBlockUpdate: () => {},
      onLog: (_level: LogLevel, _message: string) => {},
    });
    const stub = { serviceInfos: {}, "theatre.client": { ShowsClient: FakeShowsClient } };
    const appRef = createAppRef(app as never, "https://theatre.example");
    return { methods: createClient(streaming, stub, appRef).methodsFor(kaja), calls };
  }

  it("is refused with Kaja's own sentence, before any transport is asked", async () => {
    const { methods, calls } = streamingClient();

    expect(await methods.Upload({ chunk: "a" })).toBeUndefined();
    expect(sent).toHaveLength(0);
    expect(calls[0].error).toEqual({ message: "Client streaming is not supported by Kaja yet.", code: UNSUPPORTED_CODE });
    // Reported rather than thrown, like any other refused call, and read back as the
    // one kind no request can fix.
    expect(classifyFailure(calls[0].error).kind).toBe("UNSUPPORTED");
  });

  it("is still a row, because the script did make the call", async () => {
    const { methods, calls } = streamingClient();
    await methods.Upload({ chunk: "a" });
    expect(calls[0].method.name).toBe("Upload");
    expect(calls[0].input).toEqual({ chunk: "a" });
  });
});
