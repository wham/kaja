import { describe, expect, test } from "bun:test";
import { OpenApiDocument, OpenApiSecurityScheme, OpenApiServer } from "./server/api";
import {
  NO_CREDENTIALS,
  credentialNote,
  defaultSecurityScheme,
  defaultVariableValues,
  isUsableBaseUrl,
  matchServerUrl,
  resolveServerUrl,
  schemeIdentity,
  schemeLabel,
} from "./openApiDocument";

function server(url: string, variables: Partial<OpenApiServer["variables"][number]>[] = []): OpenApiServer {
  return {
    url,
    description: "",
    variables: variables.map((variable) => ({ name: "", defaultValue: "", enumValues: [], description: "", ...variable })),
  };
}

function scheme(fields: Partial<OpenApiSecurityScheme>): OpenApiSecurityScheme {
  return {
    key: "auth",
    type: "http",
    scheme: "",
    bearerFormat: "",
    in: "",
    parameterName: "",
    openIdConnectUrl: "",
    description: "",
    operationCount: 0,
    requiresOthers: false,
    ...fields,
  };
}

function document(schemes: OpenApiSecurityScheme[]): OpenApiDocument {
  return {
    title: "",
    version: "",
    openapiVersion: "3.0.0",
    operationCount: 0,
    tagCount: 0,
    servers: [],
    securitySchemes: schemes,
    guessedBaseUrl: "",
    perOperationSecurity: false,
  };
}

describe("resolveServerUrl", () => {
  test("fills placeholders with the chosen values", () => {
    const templated = server("https://{region}.acme.com/{version}", [
      { name: "region", defaultValue: "eu-west" },
      { name: "version", defaultValue: "v2" },
    ]);
    expect(resolveServerUrl(templated, { region: "us-east", version: "v3" })).toBe("https://us-east.acme.com/v3");
  });

  test("falls back to the document's defaults", () => {
    const templated = server("https://{region}.acme.com", [{ name: "region", defaultValue: "eu-west" }]);
    expect(resolveServerUrl(templated, {})).toBe("https://eu-west.acme.com");
  });
});

describe("defaultVariableValues", () => {
  test("prefers the declared default, then the first allowed value", () => {
    const templated = server("https://{a}.{b}.com", [
      { name: "a", defaultValue: "one", enumValues: ["one", "two"] },
      { name: "b", enumValues: ["first", "second"] },
    ]);
    expect(defaultVariableValues(templated)).toEqual({ a: "one", b: "first" });
  });
});

describe("matchServerUrl", () => {
  test("matches a plain server, ignoring a trailing slash", () => {
    expect(matchServerUrl(server("https://api.acme.com/v2"), "https://api.acme.com/v2/")).toEqual({});
  });

  test("does not match a different server", () => {
    expect(matchServerUrl(server("https://api.acme.com/v2"), "https://staging.acme.com/v2")).toBeNull();
  });

  // Recovering the values is what lets an app being edited show the server it was
  // created against, rather than the document's first one.
  test("recovers the values a templated server was resolved with", () => {
    const templated = server("https://{region}.acme.com/{version}", [{ name: "region" }, { name: "version" }]);
    expect(matchServerUrl(templated, "https://ap-south.acme.com/v3")).toEqual({ region: "ap-south", version: "v3" });
  });

  test("does not match a URL from another host", () => {
    const templated = server("https://{region}.acme.com", [{ name: "region" }]);
    expect(matchServerUrl(templated, "http://localhost:8080")).toBeNull();
  });

  test("has no match for an empty base URL", () => {
    expect(matchServerUrl(server("https://api.acme.com"), "")).toBeNull();
  });
});

describe("isUsableBaseUrl", () => {
  test.each([
    ["https://api.acme.com/v2", true],
    ["http://localhost:8080", true],
    ["api.acme.com", false],
    ["ftp://api.acme.com", false],
    ["", false],
    // An unresolved placeholder would be sent as part of the host.
    ["https://{region}.acme.com", false],
  ])("%s is %p", (url, usable) => {
    expect(isUsableBaseUrl(url as string)).toBe(usable);
  });
});

describe("defaultSecurityScheme", () => {
  test("preselects the first scheme, which the server sorted by coverage", () => {
    expect(defaultSecurityScheme(document([scheme({ key: "api_key", type: "apiKey" }), scheme({ key: "oauth", type: "oauth2" })]))).toBe("api_key");
  });

  test("pins nothing when the document declares no schemes", () => {
    expect(defaultSecurityScheme(document([]))).toBe("");
  });

  test("sends no credentials when every scheme is unsupported", () => {
    expect(defaultSecurityScheme(document([scheme({ key: "mtls", type: "mutualTLS" })]))).toBe(NO_CREDENTIALS);
  });
});

describe("schemeLabel", () => {
  test.each([
    [scheme({ type: "apiKey" }), "API key"],
    [scheme({ type: "http", scheme: "basic" }), "HTTP Basic"],
    [scheme({ type: "http", scheme: "Bearer" }), "Bearer token"],
    [scheme({ type: "http" }), "Bearer token"],
    [scheme({ type: "http", scheme: "digest" }), "HTTP Digest"],
    [scheme({ type: "oauth2" }), "OAuth 2.0"],
    [scheme({ type: "openIdConnect" }), "OpenID Connect"],
  ])("labels %o as %s", (input, label) => {
    expect(schemeLabel(input as OpenApiSecurityScheme)).toBe(label);
  });
});

describe("schemeIdentity", () => {
  test("names an API key where the document places it", () => {
    expect(schemeIdentity(scheme({ key: "api_key", type: "apiKey", in: "header", parameterName: "X-API-KEY" }))).toBe("api_key · header X-API-KEY");
    expect(schemeIdentity(scheme({ key: "api_key", type: "apiKey", in: "query", parameterName: "api_key" }))).toBe("api_key · query ?api_key=");
  });

  test("echoes the bearer format when the document gives one", () => {
    expect(schemeIdentity(scheme({ key: "bearerAuth", type: "http", scheme: "bearer", bearerFormat: "JWT" }))).toBe("bearerAuth · JWT");
  });
});

describe("credentialNote", () => {
  test("shows the wire format for an API key", () => {
    expect(credentialNote(scheme({ type: "apiKey", in: "cookie", parameterName: "session" }))).toEqual({ text: "Cookie: session=‹key›", mono: true });
  });

  // Kaja sends the credential after the scheme name but doesn't do the handshake,
  // so the note says so rather than implying digest auth works.
  test("is honest about an HTTP scheme kaja doesn't implement", () => {
    expect(credentialNote(scheme({ type: "http", scheme: "Digest" })).text).toContain("challenge handshake");
  });
});
