import { describe, expect, it } from "bun:test";
import { expandHeaders, expandVariables, setVariables, variableReferences } from "./variableExpansion";

describe("expandVariables", () => {
  it("expands known references and leaves unknown ones as-is", () => {
    const variables = { HOST: "api.example.com", TOKEN: "secret" };

    expect(expandVariables("https://${HOST}/twirp", variables)).toBe("https://api.example.com/twirp");
    expect(expandVariables("Bearer ${TOKEN}", variables)).toBe("Bearer secret");
    expect(expandVariables("${HOST}${TOKEN}", variables)).toBe("api.example.comsecret");
    expect(expandVariables("${UNDEFINED}", variables)).toBe("${UNDEFINED}");
    expect(expandVariables("$HOST and {HOST} and ${not-a-name}", variables)).toBe("$HOST and {HOST} and ${not-a-name}");
    expect(expandVariables("", variables)).toBe("");
  });

  it("reads the registered variables by default", () => {
    setVariables({ TEAM_ID: "42" });
    expect(expandVariables("team-${TEAM_ID}")).toBe("team-42");
    setVariables({});
    expect(expandVariables("team-${TEAM_ID}")).toBe("team-${TEAM_ID}");
  });
});

describe("expandHeaders", () => {
  it("expands every header value", () => {
    setVariables({ TOKEN: "secret" });
    expect(expandHeaders({ Authorization: "Bearer ${TOKEN}", "X-Plain": "as-is" })).toEqual({
      Authorization: "Bearer secret",
      "X-Plain": "as-is",
    });
    setVariables({});
  });
});

describe("variableReferences", () => {
  it("returns the referenced names", () => {
    expect(variableReferences("https://${HOST}/${PATH}?token=${TOKEN}")).toEqual(["HOST", "PATH", "TOKEN"]);
    expect(variableReferences("no references")).toEqual([]);
  });
});
