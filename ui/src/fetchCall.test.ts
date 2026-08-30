import { describe, expect, it } from "bun:test";
import { describeRequest, fetchKey, fetchLabel, holdResponse, rateLimitHost, readBody } from "./fetchCall";

describe("how a fetch is named", () => {
  it("is the verb and the host, so a loop shares one name", () => {
    expect(fetchLabel("GET", "https://api.example.com/v1/orders/42")).toBe("GET api.example.com");
    expect(fetchLabel("POST", "http://localhost:8080/hooks")).toBe("POST localhost:8080");
  });

  it("is the path that tells two of them apart", () => {
    expect(fetchKey("https://api.example.com/orders/42")).toBe("/orders/42");
    expect(fetchKey("https://api.example.com/orders?page=2")).toBe("/orders?page=2");
  });

  it("has no key when the host is the whole address", () => {
    expect(fetchKey("https://api.example.com")).toBeUndefined();
    expect(fetchKey("https://api.example.com/")).toBeUndefined();
  });

  it("falls back to what it was given when that is not a URL", () => {
    expect(fetchLabel("GET", "not a url")).toBe("GET not a url");
    expect(fetchKey("not a url")).toBeUndefined();
  });
});

describe("the host a budget belongs to", () => {
  it("is the same one however it is written", () => {
    expect(rateLimitHost("https://api.example.com/v3")).toBe("api.example.com");
    expect(rateLimitHost("api.example.com")).toBe("api.example.com");
    expect(rateLimitHost(" API.Example.com/orders ")).toBe("api.example.com");
    expect(rateLimitHost("http://localhost:9000")).toBe("localhost:9000");
  });
});

describe("the request as it is recorded", () => {
  it("reads the verb, the URL and the headers without sending anything", () => {
    const { request, headers } = describeRequest("https://api.example.com/orders", {
      method: "post",
      headers: { "Content-Type": "application/json" },
      body: '{"title":"Vera Lune"}',
    });
    expect(request).toEqual({ method: "POST", url: "https://api.example.com/orders", body: { title: "Vera Lune" } });
    expect(headers).toEqual({ "content-type": "application/json" });
  });

  it("keeps a body that isn't JSON as the text it is", () => {
    const { request } = describeRequest("https://api.example.com/notes", { method: "PUT", body: "plain text" });
    expect(request.body).toBe("plain text");
  });

  it("describes a body it cannot read rather than leaving a write looking empty", () => {
    const { request } = describeRequest("https://api.example.com/upload", { method: "POST", body: new Blob(["12345"], { type: "text/csv" }) });
    expect(request.body).toBe("<text/csv, 5 bytes>");
  });

  it("takes what a Request carries when the call was written with one", () => {
    const { request, headers } = describeRequest(new Request("https://api.example.com/orders", { method: "DELETE", headers: { "x-key": "k" } }));
    expect(request).toEqual({ method: "DELETE", url: "https://api.example.com/orders" });
    expect(headers).toEqual({ "x-key": "k" });
  });

  it("defaults to GET", () => {
    expect(describeRequest("https://api.example.com/orders").request.method).toBe("GET");
  });
});

describe("the body as the log holds it", () => {
  const bytes = (text: string) => new TextEncoder().encode(text).buffer as ArrayBuffer;

  it("is the parsed JSON where it is JSON", () => {
    expect(readBody(bytes('{"id":1}'), "application/json; charset=utf-8")).toEqual({ id: 1 });
    expect(readBody(bytes("[1,2]"), "application/vnd.api+json")).toEqual([1, 2]);
  });

  it("is the text where it is text, JSON or not", () => {
    expect(readBody(bytes("<html>"), "text/html")).toBe("<html>");
    expect(readBody(bytes("not json {"), "application/json")).toBe("not json {");
    expect(readBody(bytes("{}"), "")).toEqual({});
  });

  it("states what it was where it is neither", () => {
    expect(readBody(bytes(" "), "image/png")).toBe("<image/png, 1 bytes>");
  });

  it("is nothing at all when the response had no body", () => {
    expect(readBody(new ArrayBuffer(0), "application/json")).toBeUndefined();
  });
});

describe("a response read once and handed over again", () => {
  it("reads the body for the log and still hands the script one it can read", async () => {
    const held = await holdResponse(new Response('{"id":1}', { status: 200, headers: { "content-type": "application/json" } }));
    expect(held.body).toEqual({ id: 1 });
    expect(await held.response.json()).toEqual({ id: 1 });
    expect(held.response.ok).toBe(true);
  });

  it("keeps the status, the text and the headers a failure is read by", async () => {
    const held = await holdResponse(new Response("nope", { status: 404, statusText: "Not Found", headers: { "x-request-id": "r1" } }));
    expect(held.response.status).toBe(404);
    expect(held.response.statusText).toBe("Not Found");
    expect(held.response.headers.get("x-request-id")).toBe("r1");
    expect(await held.response.text()).toBe("nope");
  });

  it("hands back a status that may not carry a body without inventing one", async () => {
    const held = await holdResponse(new Response(null, { status: 204 }));
    expect(held.response.status).toBe(204);
    expect(held.body).toBeUndefined();
  });
});
