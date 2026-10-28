import { describe, expect, test } from "bun:test";
import { deriveGenericName, isReadableUrl, nameFromHost, uniqueAppName } from "./appForms";

describe("isReadableUrl", () => {
  test("takes an absolute HTTP URL", () => {
    expect(isReadableUrl("https://mcp.example.com/mcp")).toBe(true);
    expect(isReadableUrl("http://localhost:11434/v1/chat/completions")).toBe(true);
  });

  test("refuses anything that isn't one", () => {
    expect(isReadableUrl("")).toBe(false);
    expect(isReadableUrl("api.openai.com")).toBe(false);
    expect(isReadableUrl("file:///etc/passwd")).toBe(false);
  });

  test("takes a value that reads a variable on trust", () => {
    expect(isReadableUrl("${MCP_URL}")).toBe(true);
    expect(isReadableUrl("https://${HOST}/mcp")).toBe(true);
  });
});

describe("nameFromHost", () => {
  const noise = new Set(["api", "mcp"]);

  test("names a host by the first label that isn't noise", () => {
    expect(nameFromHost("quirks.kaja.tools", noise)).toBe("quirks");
    expect(nameFromHost("api.example.com", noise)).toBe("example");
    expect(nameFromHost("www.api.example.com", noise)).toBe("example");
  });

  test("keeps a two-label host as written", () => {
    expect(nameFromHost("grpcb.in", noise)).toBe("grpcb.in");
  });

  test("says nothing for a host that names the machine", () => {
    expect(nameFromHost("localhost", noise)).toBe("");
    expect(nameFromHost("app.localhost", noise)).toBe("");
    expect(nameFromHost("10.0.0.4", noise)).toBe("");
    expect(nameFromHost("[::1]", noise)).toBe("");
    expect(nameFromHost("", noise)).toBe("");
  });
});

describe("uniqueAppName", () => {
  test("leaves a free name alone", () => {
    expect(uniqueAppName("Petstore", ["github"])).toBe("Petstore");
  });

  test("numbers a taken one without introducing a space", () => {
    expect(uniqueAppName("Petstore", ["Petstore"])).toBe("Petstore2");
    expect(uniqueAppName("Petstore", ["Petstore", "Petstore2"])).toBe("Petstore3");
  });

  test("has nothing to do when there is no name yet", () => {
    expect(uniqueAppName("", ["Petstore"])).toBe("");
  });
});

describe("deriveGenericName", () => {
  test("names a folder by its own name", () => {
    expect(deriveGenericName("folder", { path: "/Users/me/notes/" })).toBe("notes");
    expect(deriveGenericName("folder", { path: "C:\\work\\logs" })).toBe("logs");
    expect(deriveGenericName("folder", {})).toBe("");
  });

  test("names a server by its host", () => {
    expect(deriveGenericName("twirp", { url: "https://api.haberdasher.example.com/twirp" })).toBe("haberdasher");
    expect(deriveGenericName("twirp", { url: "http://localhost:8080" })).toBe("");
  });
});
