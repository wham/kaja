import { bindMembers } from "./bindMembers";
import { Kaja, runFetch } from "./kaja";
import { uuidV4 } from "./uuid";

/**
 * What a script body sees of the globals.
 *
 * A script is TypeScript running in a browser, so the answer is mostly "the globals,
 * as they are" — the whole point of `fetch` and `console` being the standard names is
 * that nobody has to learn a second spelling of either. What is bound here is the three
 * groups where that answer is not the whole of it.
 *
 * 1. **Bound to the run.** `console` and `fetch` are the standard APIs over this run's
 *    log — the script's lines and the script's requests land in the console of the
 *    file it was run from. They are parameters of the wrapper rather than assignments
 *    onto the real globals, which is the whole of how a script's lines and calls are
 *    told from Kaja's own: inside the body the name resolves to the run's, and
 *    everywhere else — app code the script calls into, Kaja's own — to the real one.
 * 2. **Filled in.** `crypto.randomUUID` is a secure-context API, and neither the
 *    desktop's `wails://` page nor a kaja served over plain http is one, so the global
 *    does not define it. It is the same function `kaja.uuidV4` is.
 * 3. **Refused.** A global that cannot work where a script runs is bound to something
 *    that throws a sentence naming what to reach for instead, rather than left to fail
 *    at a distance — as `prompt` returning null to nobody, or as a `crypto.subtle` that
 *    is undefined for a reason nothing on screen states.
 *
 * This is a signpost, not a sandbox. `globalThis`, `Function("return this")()` and a
 * dozen other doors reach the real page, and none of them is closed: a script is code
 * the person whose Kaja this is chose to run, and the value here is in what a script
 * that reached for the wrong thing is *told*, not in what it is prevented from doing.
 *
 * A binding of the script's own always wins. An import or a `const` named `fetch` is a
 * name the author chose, and shadowing it here would be kaja taking a word it does not
 * own.
 */

/**
 * The globals a script may not reach, each mapped to the sentence thrown in its place.
 *
 * Read twice: bound here, and printed into the `kaja` module's header
 * (`kajaModule.ts`), which is what Monaco checks a script against and what an agent
 * gets from `describe_type "kaja"`. A list an agent reads and a list the runtime
 * enforces have to be one list, or the one an agent reads is the one that rots.
 */
export const REFUSED_GLOBALS: { readonly [name: string]: string } = {
  alert: "alert does nothing in Kaja, and nobody may be watching the window. Draw with kaja.text, or ask with kaja.askStr.",
  confirm: "confirm does nothing in Kaja. kaja.approve(Service.Method({…})) holds a call until someone says yes; kaja.askSelect asks anything else.",
  prompt: "prompt does nothing in Kaja. Ask with kaja.askStr, kaja.askInt or kaja.askSelect, which draw the question on the run's canvas.",
  XMLHttpRequest: "XMLHttpRequest is not available in Kaja, and a request made with it would go unrecorded. Use fetch, which is a call in the run's log.",
  WebSocket: "WebSocket is not supported by Kaja: a run is a script that ends, and there is nowhere to draw a connection that outlives it.",
  EventSource: "EventSource is not supported by Kaja: a run is a script that ends, and there is nowhere to draw a stream that outlives it.",
  localStorage:
    "localStorage is Kaja's, not the script's, and the desktop's page has none. A run keeps nothing of its own; write what has to outlive it through an app.",
  sessionStorage:
    "sessionStorage is Kaja's, not the script's, and the desktop's page has none. A run keeps nothing of its own; write what has to outlive it through an app.",
  indexedDB: "indexedDB is where Kaja keeps its own drafts and runs. A run keeps nothing of its own; write what has to outlive it through an app.",
  document: "document is Kaja's own window, not a page the script may write to. A script draws with kaja.text, kaja.code and kaja.table.",
  window: "window is Kaja's own, not a page the script may write to. A script draws with kaja.text, kaja.code and kaja.table.",
  require:
    'require is not defined in a script, and there is no module system to reach a package through. An import names an app, like import { Shows } from "theatre". Everything else is the standard library.',
  process: "process is Node's, and a script runs in a browser. The workspace's variables are kaja.variables.<name>, resolved for you.",
};

/** The sentence stood in for `crypto.subtle` where the page is not a secure context. */
const NO_SUBTLE = "crypto.subtle is a secure-context API, and the page a script runs in is not one. Hash and sign through an app, or an API you fetch.";

export interface ScriptGlobals {
  names: string[];
  values: unknown[];
}

/**
 * The globals to bind as parameters of a script's wrapper, given the run's console and
 * a way to ask whether the script's own imports already took a name.
 */
export function scriptGlobals(kaja: Kaja, console: Console, taken: (name: string) => boolean): ScriptGlobals {
  const bindings: Array<[string, unknown]> = [
    ["console", console],
    ["fetch", (input: RequestInfo | URL, init?: RequestInit) => runFetch(kaja, input, init)],
    ["crypto", scriptCrypto(globalThis.crypto)],
  ];
  for (const [name, sentence] of Object.entries(REFUSED_GLOBALS)) {
    bindings.push([name, refuse(sentence)]);
  }
  const bound = bindings.filter(([name]) => !taken(name));
  return { names: bound.map(([name]) => name), values: bound.map(([, value]) => value) };
}

/**
 * The real `crypto` with `randomUUID` always defined — the same function `kaja.uuidV4`
 * is, which falls back to `getRandomValues` where the global does not carry it.
 *
 * Cloned rather than patched: the page's own `crypto` is Kaja's too, and a script must
 * not be able to change what a compilation or a call mints its ids with.
 */
export function scriptCrypto(real: Crypto): Crypto {
  const clone = bindMembers(real) as unknown as { [key: string]: unknown };
  clone.randomUUID = () => uuidV4();
  if (clone.subtle === undefined) clone.subtle = refuse(NO_SUBTLE);
  return clone as unknown as Crypto;
}

/**
 * What a refused global is bound to: anything done with it throws the sentence.
 *
 * A proxy rather than a function, because the reach that has to be answered is a
 * property (`process.env`, `document.body`), a call (`require("axios")`) and a
 * construction (`new XMLHttpRequest()`) alike, and a value that only throws when
 * called would let the first two through to a message about `undefined`.
 */
export function refuse(sentence: string): unknown {
  const throwing = () => {
    throw new Error(sentence);
  };
  return new Proxy(function () {} as object, {
    get: throwing,
    set: throwing,
    has: throwing,
    apply: throwing,
    construct: throwing,
    getPrototypeOf: throwing,
  });
}
