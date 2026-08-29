import { describe, it, expect } from "bun:test";
import { Method, Service } from "./apps";
import { isRestService, methodLabel, parseHttpRequest, pathParameters, pathParts, restOperations, verbMember } from "./httpMethod";

function method(name: string, http?: string): Method {
  return { name, http };
}

function service(name: string, methods: Method[]): Service {
  return { name, packageName: "", sourcePath: "", clientStubModuleId: "", methods };
}

describe("parseHttpRequest", () => {
  it("splits the verb from the path", () => {
    expect(parseHttpRequest("GET /shows")).toEqual({ verb: "GET", path: "/shows" });
    expect(parseHttpRequest("DELETE /shows/{showId}")).toEqual({ verb: "DELETE", path: "/shows/{showId}" });
  });

  it("normalizes the verb, so a document shouting or whispering reads the same", () => {
    expect(parseHttpRequest("get /shows")).toEqual({ verb: "GET", path: "/shows" });
  });

  it("is nothing where the method carries no request", () => {
    expect(parseHttpRequest(undefined)).toBeUndefined();
    expect(parseHttpRequest("")).toBeUndefined();
  });

  // A verb with no door would generate a member nothing can call, and a path that is
  // not a path is not an address.
  it("refuses what the door could not offer", () => {
    expect(parseHttpRequest("TRACE /shows")).toBeUndefined();
    expect(parseHttpRequest("GET shows")).toBeUndefined();
    expect(parseHttpRequest("/shows")).toBeUndefined();
  });
});

describe("verbMember", () => {
  it("is the lowercase verb the script writes", () => {
    expect(verbMember({ verb: "GET", path: "/shows" })).toBe("get");
    expect(verbMember({ verb: "DELETE", path: "/shows" })).toBe("delete");
  });
});

describe("pathParameters", () => {
  it("reads the templated names in the order the path names them", () => {
    expect(pathParameters("/shows/{showId}/cast/{castId}")).toEqual(["showId", "castId"]);
  });

  it("is empty for a path that templates nothing", () => {
    expect(pathParameters("/shows")).toEqual([]);
  });
});

describe("pathParts", () => {
  it("splits the address from what is filled in", () => {
    expect(pathParts("/shows/{showId}/cast")).toEqual([
      { text: "/shows/", parameter: false },
      { text: "{showId}", parameter: true },
      { text: "/cast", parameter: false },
    ]);
  });

  it("keeps a path with nothing templated in one part", () => {
    expect(pathParts("/shows")).toEqual([{ text: "/shows", parameter: false }]);
  });

  it("puts a trailing parameter last rather than inventing an empty part after it", () => {
    expect(pathParts("/shows/{showId}")).toEqual([
      { text: "/shows/", parameter: false },
      { text: "{showId}", parameter: true },
    ]);
  });
});

describe("methodLabel", () => {
  it("names a REST method by the request it stands for", () => {
    expect(methodLabel(method("GetShow", "GET /shows/{showId}"))).toBe("GET /shows/{showId}");
  });

  it("leaves a method with no request under its own name", () => {
    expect(methodLabel(method("ListShows"))).toBe("ListShows");
  });
});

describe("isRestService and restOperations", () => {
  it("finds the operations across every service of an app", () => {
    const services = [
      service("Shows", [method("ListShows", "GET /shows"), method("GetShow", "GET /shows/{showId}")]),
      service("Venues", [method("ListVenues", "GET /venues")]),
    ];
    expect(restOperations(services).map((operation) => `${operation.request.verb} ${operation.request.path}`)).toEqual([
      "GET /shows",
      "GET /shows/{showId}",
      "GET /venues",
    ]);
  });

  it("says a service with nothing to route is not one", () => {
    expect(isRestService(service("Shows", [method("ListShows")]))).toBe(false);
    expect(restOperations([service("Shows", [method("ListShows")])])).toEqual([]);
  });
});
