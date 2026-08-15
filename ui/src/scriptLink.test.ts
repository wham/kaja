import { describe, expect, test } from "bun:test";
import { isLinkedScript, linkName, parseScriptLink, scriptLink } from "./scriptLink";

function parsed(text: string) {
  const result = parseScriptLink(text);
  if (!result.ok) throw new Error(result.error);
  return result.link;
}

describe("parseScriptLink", () => {
  test("reads the script off the path and the input off the query", () => {
    expect(parsed("kaja://run/slack-thread?url=https%3A%2F%2Fexample.com%2Fp1&note=later")).toEqual({
      script: "slack-thread",
      input: { url: "https://example.com/p1", note: "later" },
    });
  });

  test("takes a link with no input", () => {
    expect(parsed("kaja://run/nightly")).toEqual({ script: "nightly", input: {} });
  });

  test("takes the script written with its extension", () => {
    expect(parsed("kaja://run/nightly.ts").script).toBe("nightly");
  });

  test("takes a script name that had to be encoded", () => {
    expect(parsed("kaja://run/a%20night%20out").script).toBe("a night out");
  });

  test("keeps a value that looks like a parameter of its own", () => {
    // The query is the script's namespace, so nothing in it is reserved.
    expect(parsed("kaja://run/echo?script=other&run=1").input).toEqual({ script: "other", run: "1" });
  });

  test("keeps an empty value, which is a value", () => {
    expect(parsed("kaja://run/echo?url=").input).toEqual({ url: "" });
  });

  test("reads the verb whatever case it was written in", () => {
    expect(parsed("kaja://RUN/nightly").script).toBe("nightly");
  });

  test("refuses another scheme", () => {
    const result = parseScriptLink("https://example.com/run/nightly");
    expect(result.ok).toBe(false);
  });

  test("refuses a verb Kaja doesn't have", () => {
    const result = parseScriptLink("kaja://open/nightly");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("kaja://open");
  });

  test("refuses a link that names no script", () => {
    expect(parseScriptLink("kaja://run").ok).toBe(false);
    expect(parseScriptLink("kaja://run/").ok).toBe(false);
    expect(parseScriptLink("kaja://run/?url=x").ok).toBe(false);
  });

  test("refuses text that is not a link at all", () => {
    expect(parseScriptLink("nightly").ok).toBe(false);
    expect(parseScriptLink("").ok).toBe(false);
  });

  test("reads a segment it cannot decode as what it says", () => {
    expect(parsed("kaja://run/100%").script).toBe("100%");
  });
});

describe("scriptLink", () => {
  test("names the script without its extension", () => {
    expect(scriptLink("nightly.ts")).toBe("kaja://run/nightly");
  });

  test("encodes the name and the input", () => {
    expect(scriptLink("a night out.ts", { url: "https://example.com/a?b=1" })).toBe("kaja://run/a%20night%20out?url=https%3A%2F%2Fexample.com%2Fa%3Fb%3D1");
  });

  test("round-trips what it built", () => {
    const input = { url: "https://example.com/x y", "odd key": "a&b=c" };
    expect(parsed(scriptLink("thread.ts", input))).toEqual({ script: "thread", input });
  });
});

describe("isLinkedScript", () => {
  test("matches a file to the name a link spells it with", () => {
    expect(isLinkedScript("nightly.ts", "nightly")).toBe(true);
    expect(isLinkedScript("nightly.ts", "nightly.ts")).toBe(true);
    expect(isLinkedScript("nightly.ts", "Nightly")).toBe(false);
    expect(isLinkedScript("nightly.ts", "night")).toBe(false);
  });

  test("linkName leaves a name that has no extension alone", () => {
    expect(linkName("nightly")).toBe("nightly");
  });
});
