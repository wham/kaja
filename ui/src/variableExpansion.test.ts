import { describe, expect, it } from "bun:test";
import {
  environmentReferences,
  expandVariables,
  setVariables,
  storedEnvName,
  variableKind,
  variableNameError,
  variableReferences,
  variableValueError,
} from "./variableExpansion";

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

describe("variableReferences", () => {
  it("returns the referenced names", () => {
    expect(variableReferences("https://${HOST}/${PATH}?token=${TOKEN}")).toEqual(["HOST", "PATH", "TOKEN"]);
    expect(variableReferences("no references")).toEqual([]);
  });
});

describe("variableKind", () => {
  it("classifies what a value says about where it comes from", () => {
    expect(variableKind("https://api.example.com")).toBe("value");
    expect(variableKind("")).toBe("value");
    expect(variableKind("${secret}")).toBe("stored");
    expect(variableKind("  ${secret}  ")).toBe("stored");
    expect(variableKind("${env:GITHUB_TOKEN}")).toBe("environment");
    expect(variableKind("https://${env:HOST}/v1")).toBe("environment");
  });
});

describe("environmentReferences", () => {
  it("returns the environment variables a value reads", () => {
    expect(environmentReferences("https://${env:HOST}/${env:STAGE}")).toEqual(["HOST", "STAGE"]);
    expect(environmentReferences("${HOST}")).toEqual([]);
  });
});

describe("storedEnvName", () => {
  it("mirrors the fallback the server reads", () => {
    expect(storedEnvName("OPENMETER_API_KEY")).toBe("KAJA_OPENMETER_API_KEY");
  });
});

describe("variableNameError", () => {
  it("rejects names ${NAME} could never reference", () => {
    expect(variableNameError("API_BASE_URL")).toBeUndefined();
    expect(variableNameError("_private")).toBeUndefined();
    expect(variableNameError("my-var")).toBeDefined();
    expect(variableNameError("2fast")).toBeDefined();
    expect(variableNameError("")).toBeDefined();
  });
});

describe("variableValueError", () => {
  it("rejects a ${secret} that isn't the whole value", () => {
    expect(variableValueError("${secret}")).toBeUndefined();
    expect(variableValueError("https://api.example.com")).toBeUndefined();
    expect(variableValueError("Bearer ${secret}")).toBeDefined();
  });
});
