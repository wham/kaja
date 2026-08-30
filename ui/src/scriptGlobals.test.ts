import { describe, expect, it } from "bun:test";
import { Kaja } from "./kaja";
import { REFUSED_GLOBALS, refuse, scriptCrypto, scriptGlobals } from "./scriptGlobals";

function makeKaja(): Kaja {
  return new Kaja({
    onMethodCallUpdate: () => {},
    onAsk: async () => "",
    onApprove: async () => "approved" as const,
    onBlockUpdate: () => {},
    onLog: () => {},
  });
}

function bound(taken: string[] = []): { [name: string]: unknown } {
  const globals = scriptGlobals(makeKaja(), console, (name) => taken.includes(name));
  return Object.fromEntries(globals.names.map((name, index) => [name, globals.values[index]]));
}

describe("the globals a script is handed", () => {
  it("binds the run's console and fetch under their own standard names", () => {
    const globals = bound();

    expect(globals.console).toBe(console);
    expect(typeof globals.fetch).toBe("function");
  });

  // An import or a const named `fetch` is a name the author chose.
  it("leaves out a name the script's own bindings took", () => {
    expect("fetch" in bound(["fetch"])).toBe(false);
    expect("console" in bound(["console"])).toBe(false);
    expect("prompt" in bound(["prompt"])).toBe(false);
    expect("fetch" in bound(["console"])).toBe(true);
  });

  it("binds a refusal for every global in the table", () => {
    const globals = bound();

    for (const name of Object.keys(REFUSED_GLOBALS)) {
      expect(globals[name]).toBeDefined();
    }
  });

  // The kaja module's header prints the sentences as the list of refused globals, so a
  // sentence that did not open with its own name would print as a line naming nothing.
  it("opens every sentence with the name it stands in for", () => {
    for (const [name, sentence] of Object.entries(REFUSED_GLOBALS)) {
      expect(sentence.startsWith(name)).toBe(true);
    }
  });
});

describe("a refused global", () => {
  const held = refuse("prompt does nothing in Kaja.") as any;

  it("throws its sentence however it is reached", () => {
    expect(() => held()).toThrow("prompt does nothing in Kaja.");
    expect(() => new held()).toThrow("prompt does nothing in Kaja.");
    expect(() => held.value).toThrow("prompt does nothing in Kaja.");
    expect(() => {
      held.value = 1;
    }).toThrow("prompt does nothing in Kaja.");
  });
});

describe("the crypto a script sees", () => {
  // The desktop's page and a kaja served over plain http are not secure contexts, so
  // the global carries neither randomUUID nor subtle there.
  function insecureCrypto(): Crypto {
    return { getRandomValues: (array: Uint8Array) => globalThis.crypto.getRandomValues(array) } as Crypto;
  }

  it("mints a uuid where the page's own crypto has none", () => {
    const id = scriptCrypto(insecureCrypto()).randomUUID();

    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("passes everything else through to the real one", () => {
    const bytes = scriptCrypto(insecureCrypto()).getRandomValues(new Uint8Array(8));

    expect(bytes).toHaveLength(8);
  });

  it("stands in for a subtle that is not there with a sentence saying why", () => {
    const subtle = scriptCrypto(insecureCrypto()).subtle as any;

    expect(() => subtle.digest()).toThrow("secure-context");
  });

  it("leaves a real subtle alone", () => {
    expect(scriptCrypto(globalThis.crypto).subtle).toBe(globalThis.crypto.subtle);
  });
});
