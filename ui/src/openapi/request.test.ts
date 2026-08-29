import { describe, it, expect } from "bun:test";
import { Parameter, ResolvedOperation, Schema } from "./document";
import { buildRequest, requestTarget } from "./request";

function operation(over: Partial<ResolvedOperation> = {}): ResolvedOperation {
  return { verb: "GET", path: "/shows", deprecated: false, tag: "Shows", parameters: [], ...over };
}

function parameter(name: string, where: Parameter["in"], over: Partial<Parameter> = {}): Parameter {
  return { name, in: where, ...over };
}

describe("buildRequest", () => {
  it("fills a path parameter in and escapes it", () => {
    const built = buildRequest(operation({ path: "/shows/{showId}", parameters: [parameter("showId", "path")] }), { showId: "a/b" });
    expect(built.path).toBe("/shows/a%2Fb");
  });

  // A hole in the URL would be a call to /shows/undefined, which the API answers
  // for; the template reaching it is the honest account of what was not written.
  it("leaves a path parameter that was not written in place", () => {
    expect(buildRequest(operation({ path: "/shows/{showId}", parameters: [parameter("showId", "path")] }), {}).path).toBe("/shows/{showId}");
  });

  it("sends a query parameter, and leaves out one nothing was written for", () => {
    const shows = operation({ parameters: [parameter("city", "query"), parameter("limit", "query")] });
    expect(buildRequest(shows, { city: "Chicago" }).query).toEqual([["city", "Chicago"]]);
    expect(buildRequest(shows, {}).query).toEqual([]);
    // An absent value is absent, which a message could not express.
    expect(buildRequest(shows, { city: undefined, limit: 0 }).query).toEqual([["limit", "0"]]);
  });

  it("sends a header parameter as a header", () => {
    const built = buildRequest(operation({ parameters: [parameter("X-Trace", "header")] }), { "X-Trace": "1" });
    expect(built.headers).toEqual({ "X-Trace": "1" });
  });

  describe("the spellings a document may choose for an array", () => {
    const exploded = operation({ parameters: [parameter("tag", "query")] });
    const joined = operation({ parameters: [parameter("tag", "query", { explode: false })] });

    it("repeats the name when exploded, which is the default", () => {
      expect(buildRequest(exploded, { tag: ["a", "b"] }).query).toEqual([
        ["tag", "a"],
        ["tag", "b"],
      ]);
    });

    it("comma-joins when the document says not to explode", () => {
      expect(buildRequest(joined, { tag: ["a", "b"] }).query).toEqual([["tag", "a,b"]]);
    });

    it("sends nothing for an empty array", () => {
      expect(buildRequest(exploded, { tag: [] }).query).toEqual([]);
    });
  });

  it("writes a deepObject as name[key]", () => {
    const filtered = operation({ parameters: [parameter("filter", "query", { style: "deepObject" })] });
    expect(buildRequest(filtered, { filter: { model: "gpt-4", tier: "pro" } }).query).toEqual([
      ["filter[model]", "gpt-4"],
      ["filter[tier]", "pro"],
    ]);
  });

  describe("the body", () => {
    const objectBody: Schema = { type: "object", properties: { title: { type: "string" } } };

    it("is the input's own members, minus what travels in the URL", () => {
      const create = operation({
        verb: "POST",
        path: "/shows/{showId}",
        parameters: [parameter("showId", "path"), parameter("dryRun", "query")],
        requestBody: { content: {} },
        requestSchema: objectBody,
      });
      const built = buildRequest(create, { showId: "vera-lune", dryRun: true, title: "Vera Lune", venueId: "the-foundry" });

      expect(built.path).toBe("/shows/vera-lune");
      expect(built.query).toEqual([["dryRun", "true"]]);
      expect(JSON.parse(built.body!)).toEqual({ title: "Vera Lune", venueId: "the-foundry" });
      expect(built.headers["Content-Type"]).toBe("application/json");
    });

    // A body that is an array has nothing to spread, so it is named. Under proto
    // this needed an envelope field that the API never declared.
    it("is taken from `body` where the document says the body is not an object", () => {
      const ingest = operation({ verb: "POST", requestBody: { content: {} }, requestSchema: { type: "array", items: { type: "string" } } });
      expect(JSON.parse(buildRequest(ingest, { body: ["a", "b"] }).body!)).toEqual(["a", "b"]);
      expect(buildRequest(ingest, {}).body).toBeUndefined();
    });

    it("lets an explicit `body` win, so an API with its own `body` property is reachable", () => {
      const create = operation({ verb: "POST", requestBody: { content: {} }, requestSchema: objectBody });
      expect(JSON.parse(buildRequest(create, { body: { title: "x" } }).body!)).toEqual({ title: "x" });
    });

    it("is absent where the operation declares none, whatever was written", () => {
      expect(buildRequest(operation(), { title: "x" }).body).toBeUndefined();
    });

    it("is sent empty where the API requires one and nothing was written", () => {
      const create = operation({ verb: "POST", requestBody: { required: true, content: {} }, requestSchema: objectBody });
      expect(buildRequest(create, {}).body).toBe("{}");
    });

    it("uses the content type the document declared", () => {
      const create = operation({ verb: "POST", requestBody: { content: {} }, requestSchema: objectBody, requestContentType: "application/merge-patch+json" });
      expect(buildRequest(create, { title: "x" }).headers["Content-Type"]).toBe("application/merge-patch+json");
    });
  });
});

describe("requestTarget", () => {
  it("is the path alone where there is no query", () => {
    expect(requestTarget({ method: "GET", path: "/shows", query: [], headers: {} })).toBe("/shows");
  });

  it("escapes both halves of every pair", () => {
    const target = requestTarget({ method: "GET", path: "/shows", query: [["q", "a b&c"]], headers: {} });
    expect(target).toBe("/shows?q=a%20b%26c");
  });
});
