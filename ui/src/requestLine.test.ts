import { describe, expect, it } from "bun:test";
import { splitRequestLine } from "./requestLine";

describe("splitRequestLine", () => {
  it("splits a verb, an origin, a path and a query", () => {
    expect(splitRequestLine("GET https://openmeter.cloud/api/v1/customers?page=1&pageSize=50")).toEqual({
      method: "GET",
      origin: "https://openmeter.cloud",
      path: "/api/v1/customers",
      query: "?page=1&pageSize=50",
    });
  });

  it("leaves the query out when there is none", () => {
    expect(splitRequestLine("POST https://api.example.com/orders")).toEqual({
      method: "POST",
      origin: "https://api.example.com",
      path: "/orders",
    });
  });

  it("reads a bare URL as a line naming no method", () => {
    expect(splitRequestLine("https://api.example.com/orders")).toEqual({
      method: undefined,
      origin: "https://api.example.com",
      path: "/orders",
    });
  });

  it("keeps a relative target whole rather than inventing an origin", () => {
    expect(splitRequestLine("GET /twirp/Haberdasher/MakeHat?size=8")).toEqual({
      method: "GET",
      path: "/twirp/Haberdasher/MakeHat",
      query: "?size=8",
    });
  });

  it("prints a line it cannot read as the path", () => {
    expect(splitRequestLine("not a request line at all")).toEqual({ method: undefined, path: "not a request line at all" });
  });

  it("keeps the port, which is part of where the call went", () => {
    expect(splitRequestLine("POST http://localhost:9000/twirp/Quirks/Sum")).toEqual({
      method: "POST",
      origin: "http://localhost:9000",
      path: "/twirp/Quirks/Sum",
    });
  });

  it("carries a fragment with the path", () => {
    expect(splitRequestLine("GET https://api.example.com/docs#section")).toEqual({
      method: "GET",
      origin: "https://api.example.com",
      path: "/docs#section",
    });
  });
});
