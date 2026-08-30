import { afterEach, describe, expect, it } from "bun:test";
import { ApproveBlock, Block } from "./blocks";
import { callKey, callLabel, callResponseHeaders, Kaja, MethodCall } from "./kaja";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

// What the network answers, and what it was asked. Every test states one and reads
// the other back off the call the run recorded.
function answering(answer: (request: { url: string; init?: RequestInit }) => Response | Promise<Response> | Promise<never>) {
  const asked: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const request = { url: input instanceof Request ? input.url : String(input), init };
    asked.push(request);
    return Promise.resolve(answer(request));
  }) as unknown as typeof fetch;
  return asked;
}

function run() {
  const calls: MethodCall[] = [];
  const blocks = new Map<string, Block>();
  const kaja = new Kaja({
    onMethodCallUpdate: (call) => void calls.push(call),
    onAsk: () => Promise.reject(new Error("not asked")),
    onApprove: () => Promise.resolve("approved" as const),
    onBlockUpdate: (blockId, block) => void blocks.set(blockId, block),
    onLog: () => {},
  });
  // The same object is reported as the call is issued and again as it settles, so the
  // last one is the whole of it.
  const settled = (): MethodCall => calls[calls.length - 1];
  return { kaja, calls, settled, blocks };
}

describe("kaja.fetch", () => {
  it("hands back the response fetch would have", async () => {
    answering(() => new Response('{"id":1}', { headers: { "content-type": "application/json" } }));
    const { kaja } = run();

    const response = await kaja.fetch("https://api.example.com/orders/1");

    expect(response.ok).toBe(true);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: 1 });
  });

  it("records it as a call, named by the verb and the host and keyed by the path", async () => {
    answering(() => new Response('{"id":1}', { headers: { "content-type": "application/json", "x-request-id": "r1" } }));
    const { kaja, settled } = run();

    await kaja.fetch("https://api.example.com/orders/1");

    const call = settled();
    expect(callLabel(call)).toBe("GET api.example.com");
    expect(callKey(call)).toBe("/orders/1");
    expect(call.appName).toBe("api.example.com");
    expect(call.http).toEqual({ method: "GET", url: "https://api.example.com/orders/1" });
    expect(call.input).toEqual({ method: "GET", url: "https://api.example.com/orders/1" });
    expect(call.output).toEqual({ id: 1 });
    expect(call.error).toBeUndefined();
    expect(callResponseHeaders(call)["x-request-id"]).toBe("r1");
  });

  it("is a row the moment it is issued, so a slow call is not an invisible one", async () => {
    answering(() => new Response("{}"));
    const { kaja, calls } = run();

    await kaja.fetch("https://api.example.com/orders");

    // Twice: once as it goes out and once as it settles, and the same object both
    // times — the console holds it and reads it again rather than being handed a copy.
    expect(calls).toHaveLength(2);
    expect(calls[0]).toBe(calls[1]);
  });

  it("reports an HTTP status as the failure it is, and still hands the response back", async () => {
    answering(() => new Response('{"error":"gone"}', { status: 404, statusText: "Not Found", headers: { "content-type": "application/json" } }));
    const { kaja, settled } = run();

    const response = await kaja.fetch("https://api.example.com/orders/9");

    // fetch's own contract: a status is a response, not a throw.
    expect(response.ok).toBe(false);
    expect(response.status).toBe(404);
    const call = settled();
    // The shape an app's upstream failure arrives in, so the log reads it the same way.
    expect(call.error).toEqual({
      message: "404 Not Found",
      status: 404,
      statusText: "Not Found",
      request: "GET https://api.example.com/orders/9",
      body: { error: "gone" },
    });
  });

  it("reports a request that never completed, and throws what fetch throws", async () => {
    answering(() => Promise.reject(new TypeError("Failed to fetch")));
    const { kaja, settled } = run();

    await expect(Promise.resolve(kaja.fetch("https://api.example.com/orders"))).rejects.toThrow("Failed to fetch");

    expect(settled().error).toEqual({ message: "Failed to fetch", request: "GET https://api.example.com/orders" });
    expect(settled().output).toBeUndefined();
  });

  it("holds the call for kaja.approve, with the body it is about to send", async () => {
    const asked = answering(() => new Response("{}"));
    const { kaja, blocks } = run();

    await kaja.approve(kaja.fetch("https://api.example.com/orders", { method: "POST", body: '{"title":"Vera Lune"}' }));

    const approve = [...blocks.values()].find((block): block is ApproveBlock => block.kind === "approve");
    expect(approve?.method).toBe("POST api.example.com");
    expect(approve?.request).toContain('"title": "Vera Lune"');
    expect(asked).toHaveLength(1);
  });

  it("is never sent when it is not approved", async () => {
    const asked = answering(() => new Response("{}"));
    const calls: MethodCall[] = [];
    const kaja = new Kaja({
      onMethodCallUpdate: (call) => void calls.push(call),
      onAsk: () => Promise.reject(new Error("not asked")),
      onApprove: () => Promise.reject(new Error("no")),
      onBlockUpdate: () => {},
      onLog: () => {},
    });

    await expect(kaja.approve(kaja.fetch("https://api.example.com/orders", { method: "DELETE" }))).rejects.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));

    // A held call writes no row, because it never happened.
    expect(asked).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });

  it("is paced against the host, which is what it has instead of an app", async () => {
    answering(() => new Response("{}", { headers: { "ratelimit-limit": "100", "ratelimit-remaining": "99" } }));
    const { kaja } = run();

    const limit = kaja.rateLimit("api.example.com");
    await kaja.fetch("https://api.example.com/orders");

    expect(limit.calls).toBe(1);
    expect(limit.limit).toBe(100);
    expect(limit.remaining).toBe(99);
  });

  // Where the id was minted with crypto.randomUUID the call threw before it was ever a
  // row, so the run failed with nothing in the log saying what it had tried to do.
  it("is a call in a context that has no crypto.randomUUID", async () => {
    answering(() => new Response('{"id":1}', { headers: { "content-type": "application/json" } }));
    const { kaja, settled } = run();
    const realCrypto = globalThis.crypto;
    globalThis.crypto = { getRandomValues: (array: Uint8Array) => realCrypto.getRandomValues(array) } as Crypto;

    try {
      const response = await kaja.fetch("https://api.example.com/orders/1");
      expect(response.ok).toBe(true);
      expect(settled().http).toEqual({ method: "GET", url: "https://api.example.com/orders/1" });
    } finally {
      globalThis.crypto = realCrypto;
    }
  });

  it("goes out with the run's abort signal, so Stop reaches it", async () => {
    const asked = answering(() => new Response("{}"));
    const { kaja } = run();
    const controller = new AbortController();
    kaja._internal.abortSignal = controller.signal;

    await kaja.fetch("https://api.example.com/orders");

    const signal = asked[0].init?.signal;
    expect(signal).toBeDefined();
    controller.abort();
    expect(signal!.aborted).toBe(true);
  });
});
