import { describe, expect, it } from "bun:test";
import {
  environmentReferences,
  expandVariables,
  setVariables,
  signInCredential,
  signsIn,
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

describe("signInCredential", () => {
  it("names the variable after the app", () => {
    expect(signInCredential("", "GitHub", {})).toBe("${GITHUB_SIGNIN}");
    expect(signInCredential("", "my api 2", {})).toBe("${MY_API_2_SIGNIN}");
    expect(signInCredential("", "", {})).toBe("${APP_SIGNIN}");
    expect(signInCredential("", "1password", {})).toBe("${_1PASSWORD_SIGNIN}");
  });

  it("numbers past a name that holds something else", () => {
    expect(signInCredential("", "GitHub", { GITHUB_SIGNIN: "${secret}" })).toBe("${GITHUB_SIGNIN_2}");
    expect(signInCredential("", "GitHub", { GITHUB_SIGNIN: "x", GITHUB_SIGNIN_2: "${signin}" })).toBe("${GITHUB_SIGNIN_3}");
  });

  it("keeps the variable a credential already names", () => {
    expect(signInCredential("${WORK}", "GitHub", { WORK: "${signin}" })).toBe("${WORK}");
    expect(signInCredential("${WORK}", "GitHub", {})).toBe("${WORK}");
    expect(signInCredential("${TOKEN}", "GitHub", { TOKEN: "${secret}" })).toBe("${GITHUB_SIGNIN}");
    expect(signInCredential("ghp_typed", "GitHub", {})).toBe("${GITHUB_SIGNIN}");
  });
});

describe("signsIn", () => {
  it("is a credential naming a sign-in variable", () => {
    expect(signsIn("${GITHUB}", { GITHUB: "${signin}" })).toBe(true);
    expect(signsIn("${GITHUB}", { GITHUB: "${secret}" })).toBe(false);
    expect(signsIn("${GITHUB}", {})).toBe(false);
  });
});

it("a sign-in is a kind of its own and kept whole", () => {
  expect(variableKind("${signin}")).toBe("signIn");
  expect(variableValueError("Bearer ${signin}")).toBe("${signin} must be the whole value.");
});
