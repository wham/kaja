import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { describeRequest } from "./fetchCall";
import { desktopFetchUrl, sendThroughDesktop } from "./fetchTransport";

const realFetch = globalThis.fetch;
const realWindow = globalThis.window;

// The lane is on the page's own origin, which is wails://localhost on the desktop.
beforeEach(() => {
  globalThis.window = { location: { href: "wails://localhost/" } } as unknown as Window & typeof globalThis;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  globalThis.window = realWindow;
});

// What the lane answered, and what it was asked. Every test states one and reads the
// other back off the request the transport made.
function lane(answer: (request: Request) => Response) {
  const asked: Request[] = [];
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input as RequestInfo, init);
    asked.push(request);
    return Promise.resolve(answer(request));
  }) as unknown as typeof fetch;
  return asked;
}

// The transport takes what runFetch already read off the call's arguments.
function send(input: RequestInfo | URL, init?: RequestInit) {
  return sendThroughDesktop(describeRequest(input, init).request, input, init);
}

describe("the desktop's fetch lane", () => {
  it("sends the target and the script's own headers on the lane", async () => {
    const asked = lane(() => new Response("{}"));

    await send("https://api.example.com/orders", { method: "POST", headers: { Authorization: "Bearer t" }, body: '{"name":"x"}' });

    const [request] = asked;
    expect(new URL(request.url).pathname).toBe(new URL(desktopFetchUrl()).pathname);
    expect(request.method).toBe("POST");
    expect(request.headers.get("X-Kaja-Fetch-Method")).toBe("POST");
    expect(request.headers.get("X-Kaja-Fetch-Url")).toBe("https://api.example.com/orders");
    expect(request.headers.get("X-Header-Authorization")).toBe("Bearer t");
    expect(await request.text()).toBe('{"name":"x"}');
  });

  it("hands back the response the API answered with", async () => {
    lane(() => new Response('{"id":1}', { status: 201, headers: { "content-type": "application/json", "x-request-id": "r1" } }));

    const response = await send("https://api.example.com/orders/1");

    expect(response.status).toBe(201);
    expect(response.ok).toBe(true);
    expect(response.headers.get("x-request-id")).toBe("r1");
    expect(await response.json()).toEqual({ id: 1 });
  });

  it("never shows kaja's own channel as a response header", async () => {
    lane(() => new Response("{}", { headers: { "X-Kaja-Fetch-Url": "https://api.example.com/orders/1" } }));

    const response = await send("https://api.example.com/orders");

    expect(response.headers.get("X-Kaja-Fetch-Url")).toBeNull();
  });

  it("reads the URL the response was finally read from off that channel", async () => {
    lane(() => new Response("{}", { headers: { "X-Kaja-Fetch-Url": "https://api.example.com/new" } }));

    const response = await send("https://api.example.com/old");

    expect(response.url).toBe("https://api.example.com/new");
    expect(response.redirected).toBe(true);
  });

  it("throws what fetch throws for a request that never completed", async () => {
    lane(() => new Response("", { status: 502, headers: { "X-Kaja-Fetch-Error": "dial tcp 127.0.0.1:1: connection refused" } }));

    expect(send("https://api.example.com/orders")).rejects.toThrow("connection refused");
  });

  it("hands back a status the API answered with rather than throwing", async () => {
    lane(() => new Response('{"error":"nope"}', { status: 404, statusText: "Not Found" }));

    const response = await send("https://api.example.com/orders/9");

    expect(response.ok).toBe(false);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "nope" });
  });

  it("carries the run's signal, so Stop reaches the call", async () => {
    const asked = lane(() => new Response("{}"));
    const controller = new AbortController();

    await send("https://api.example.com/orders", { signal: controller.signal });

    expect(asked[0].signal).toBeDefined();
    expect(asked[0].signal.aborted).toBe(false);
    controller.abort();
    expect(asked[0].signal.aborted).toBe(true);
  });
});
