import { describe, expect, it } from "bun:test";
import { knownApiFor, knownApis, matchingApis } from "./knownApis";

describe("knownApiFor", () => {
  it("matches the document as it is bundled, written however", () => {
    expect(knownApiFor("https://petstore3.swagger.io/api/v3/openapi.json")?.name).toBe("Petstore");
    expect(knownApiFor(" HTTPS://Benchling.com/api/v3/openapi.yaml ")?.name).toBe("Benchling");
  });

  it("says nothing about another document on the same host", () => {
    expect(knownApiFor("https://benchling.com/api/v2/openapi.yaml")).toBeUndefined();
  });
});

describe("matchingApis", () => {
  it("offers every API until something is typed", () => {
    expect(matchingApis("")).toEqual(knownApis);
  });

  it("matches a name or an address", () => {
    expect(matchingApis("pet").map((api) => api.name)).toEqual(["Petstore"]);
    expect(matchingApis("rest-api-description").map((api) => api.name)).toEqual(["GitHub"]);
  });
});
