import { describe, expect, test } from "bun:test";
import { DESKTOP_LINK_BASE, hasScriptLink, isLinkedScript, linkName, parseScriptLink, scriptLink, scriptLinkParts } from "./scriptLink";

// The desktop's form, stated rather than read off whatever the test runner has
// for a `window`: `scriptLink` defaults to a link to *this* Kaja, which is the
// question these tests are not asking.
const desktopLink = (fileName: string, input?: { [key: string]: string }) => scriptLink(fileName, input, DESKTOP_LINK_BASE);
const desktopParts = (fileName: string, input?: { [key: string]: string }) => scriptLinkParts(fileName, input, DESKTOP_LINK_BASE);

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

  test("refuses an http link that carries nothing after its #", () => {
    // The path is the page's, not Kaja's: only the fragment is a deeplink.
    expect(parseScriptLink("https://example.com/run/nightly").ok).toBe(false);
    expect(parseScriptLink("https://kaja.example.com/").ok).toBe(false);
    expect(parseScriptLink("https://kaja.example.com/#somewhere-else").ok).toBe(false);
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
    expect(desktopLink("nightly.ts")).toBe("kaja://run/nightly");
  });

  test("encodes the name and the input", () => {
    expect(desktopLink("a night out.ts", { url: "https://example.com/a?b=1" })).toBe("kaja://run/a%20night%20out?url=https%3A%2F%2Fexample.com%2Fa%3Fb%3D1");
  });

  test("round-trips what it built", () => {
    const input = { url: "https://example.com/x y", "odd key": "a&b=c" };
    expect(parsed(desktopLink("thread.ts", input))).toEqual({ script: "thread", input });
  });

  // What the sheet is for: a key with nothing behind it is where a launcher's
  // own token goes, so the link has to carry it.
  test("keeps a key whose value is blank", () => {
    expect(desktopLink("thread.ts", { url: "", note: "" })).toBe("kaja://run/thread?url=&note=");
  });
});

describe("scriptLinkParts", () => {
  test("is the link it splits", () => {
    const input = { url: "https://example.com/a?b=1", note: "" };
    expect(
      desktopParts("reports/weekly usage.ts", input)
        .map((part) => part.text)
        .join(""),
    ).toBe(desktopLink("reports/weekly usage.ts", input));
  });

  test("separates what Kaja's address says from what the script says", () => {
    expect(desktopParts("thread.ts", { url: "abc", note: "" })).toEqual([
      { kind: "base", text: DESKTOP_LINK_BASE },
      { kind: "script", text: "thread" },
      { kind: "key", text: "?url=" },
      { kind: "value", text: "abc" },
      { kind: "key", text: "&note=" },
    ]);
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

// A folder is part of a script's name, so it is part of the link — two files
// can share a base name, and the link has to say which one it means.
describe("a script in a folder", () => {
  test("keeps the folder in the link, with each segment encoded on its own", () => {
    expect(desktopLink("reports/weekly usage.ts")).toBe("kaja://run/reports/weekly%20usage");
    expect(parseScriptLink("kaja://run/reports/weekly%20usage")).toEqual({ ok: true, link: { script: "reports/weekly usage", input: {} } });
  });

  test("matches the whole name, and a bare name from a link written before folders existed", () => {
    expect(isLinkedScript("reports/churn.ts", "reports/churn")).toBe(true);
    expect(isLinkedScript("reports/churn.ts", "churn")).toBe(true);
    expect(isLinkedScript("billing/churn.ts", "reports/churn")).toBe(false);
  });
});

// The web's own form. A page can't register a scheme, so the link is the page
// again with the deeplink in its fragment — the same grammar after the `#`.
describe("the web's link", () => {
  const base = "https://kaja.example.com/#run/";

  test("says the same thing after a #", () => {
    const input = { url: "https://example.com/p1", note: "later" };
    expect(scriptLink("slack-thread.ts", input, base)).toBe("https://kaja.example.com/#run/slack-thread?url=https%3A%2F%2Fexample.com%2Fp1&note=later");
    expect(parsed(scriptLink("slack-thread.ts", input, base))).toEqual({ script: "slack-thread", input });
  });

  test("round-trips a script in a folder, and one whose name had to be encoded", () => {
    expect(parsed(scriptLink("reports/weekly usage.ts", {}, base)).script).toBe("reports/weekly usage");
  });

  test("reads a link served from a base path, which is what keeps it out of the server", () => {
    expect(parsed("https://example.com/tools/kaja/#run/nightly?tag=q3")).toEqual({ script: "nightly", input: { tag: "q3" } });
  });

  test("leaves the page's own query alone", () => {
    // Everything before the `#` belongs to whoever is serving Kaja; the
    // script's parameters are the ones inside the fragment.
    expect(parsed("https://kaja.example.com/?theme=dark#run/nightly?tag=q3").input).toEqual({ tag: "q3" });
  });

  test("reads the verb whatever case it was written in", () => {
    expect(parsed("https://kaja.example.com/#RUN/nightly").script).toBe("nightly");
  });

  test("refuses a fragment that names no script", () => {
    expect(parseScriptLink("https://kaja.example.com/#run").ok).toBe(false);
    expect(parseScriptLink("https://kaja.example.com/#run/").ok).toBe(false);
  });
});

// A page is handed every fragment it is ever opened with, so it has to be able
// to say "not mine" about somebody else's anchor without reporting an error.
describe("hasScriptLink", () => {
  test("knows a deeplink from any other fragment", () => {
    expect(hasScriptLink("https://kaja.example.com/#run/nightly?tag=q3")).toBe(true);
    expect(hasScriptLink("https://kaja.example.com/#run")).toBe(true);
    expect(hasScriptLink("https://kaja.example.com/#RUN/nightly")).toBe(true);
    expect(hasScriptLink("https://kaja.example.com/")).toBe(false);
    expect(hasScriptLink("https://kaja.example.com/#section-2")).toBe(false);
    expect(hasScriptLink("https://kaja.example.com/#running-late")).toBe(false);
    expect(hasScriptLink("not a url")).toBe(false);
  });
});
