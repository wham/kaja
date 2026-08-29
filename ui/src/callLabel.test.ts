import { describe, it, expect } from "bun:test";
import { Method, Service } from "./apps";
import { callLabel, MethodCall } from "./kaja";

function call(method: Method, http?: { method: string; url: string }): MethodCall {
  const service: Service = { name: "Shows", packageName: "", sourcePath: "", clientStubModuleId: "", methods: [method] };
  return { id: "1", appName: "theatre", service, method, input: {}, requestHeaders: {}, timestamp: 0, http } as MethodCall;
}

// Three kinds of call, each named the way its own world names it. The fetch case is
// covered where fetch is; these two are the rest of the rule.
describe("callLabel", () => {
  it("names a method the API gives a path by that path", () => {
    expect(callLabel(call({ name: "GetShow", http: "GET /shows/{showId}" }))).toBe("GET /shows/{showId}");
  });

  it("names a method with no path by its service and its name", () => {
    expect(callLabel(call({ name: "GetShow" }))).toBe("Shows.GetShow");
  });

  // A fetch has neither a service nor an operation, and it wins: the method beside
  // it on a fetch call is a placeholder, not something to read.
  it("names a fetch by its verb and host, whatever the method says", () => {
    expect(callLabel(call({ name: "fetch", http: "GET /shows" }, { method: "POST", url: "https://api.example.com/orders" }))).toBe("POST api.example.com");
  });
});
