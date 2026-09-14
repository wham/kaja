import { Script, scriptName } from "./apps";
import { readScriptFile } from "./scriptFiles";
import { isLinkedScript, linkName } from "./scriptLink";
import { readInputParameters, ScriptInputs, ScriptParameters } from "./scriptInputs";

/**
 * What every script in the workspace takes, so a `kaja.run` in the editor can be
 * checked against the script on the other end.
 *
 * A destination is a name, so the only way to know what it takes is to read the file
 * — and the folder is not the window's to hold. So it is read on demand: the editor
 * names the destinations it is checking (markRuns), the ones nothing has read yet are
 * fetched, and what comes back is a new declaration for the whole folder. A script
 * this has not read has no entry at all, which is what keeps a window that has just
 * started from refusing every parameter in it.
 *
 * A listing is what says which scripts exist, so a file that is gone is forgotten with
 * it and the spelling a click resolves is settled against the same list.
 */

// A burst of reads lands one at a time, and each rewrite of the declaration is work
// for the TypeScript worker. One rewrite per burst instead.
const SETTLE_MS = 50;

let listing: Script[] | undefined;
const parameters = new Map<string, ScriptParameters>();
const reading = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();
let flush: Promise<void> | undefined;

export function subscribeScriptParameters(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The whole folder as the editor is told about it: every script, and what is known. */
export function knownScriptInputs(): ScriptInputs[] {
  return (listing ?? []).map((script) => {
    const name = linkName(scriptName(script));
    return { name, parameters: parameters.get(name) };
  });
}

/**
 * The scripts there are. A file that left the listing is forgotten rather than kept
 * against a name that now reaches nothing, and a renamed one is read again under the
 * name it is filed as now.
 */
export function setScriptListing(scripts: Script[] | undefined): void {
  listing = scripts;
  if (scripts) {
    const names = new Set(scripts.map((script) => linkName(scriptName(script))));
    for (const name of [...parameters.keys()]) {
      if (!names.has(name)) parameters.delete(name);
    }
  }
  // The listing decides which spelling reaches which script, so adding or removing one
  // changes the declaration even where nothing was read.
  settle();
}

/**
 * What a script says now, from the buffer that was just written rather than from a
 * read of what it was. Every write the window makes goes through here, so a parameter
 * added to a script is one its callers can name a beat later.
 */
export function setScriptSource(name: string, code: string): void {
  parameters.set(linkName(name), readInputParameters(code));
  settle();
}

/**
 * The destinations being checked. The ones nothing has read yet are read, and the
 * promise is how something that has to be sure — an agent's check, which reports once
 * and is gone — waits for them rather than reporting on what happened to be in hand.
 */
export function demandScriptParameters(names: string[]): Promise<void> {
  const wanted = new Set<Promise<void>>();
  for (const named of names) {
    const script = (listing ?? []).find((candidate) => isLinkedScript(scriptName(candidate), named));
    if (!script) continue;
    const name = linkName(scriptName(script));
    if (parameters.has(name)) continue;
    const already = reading.get(name);
    if (already) {
      wanted.add(already);
      continue;
    }
    const read = readParameters(script, name);
    reading.set(name, read);
    wanted.add(read);
  }
  // Every read that lands asks for a flush, so waiting for the reads and then for the
  // flush is waiting for a declaration that holds what they said.
  return wanted.size === 0 ? settled() : Promise.all(wanted).then(settled);
}

async function readParameters(script: Script, name: string): Promise<void> {
  try {
    const file = await readScriptFile(script);
    // A file that cannot be read is one nothing can be said about, so it takes
    // anything. Recorded rather than left unknown, or every keystroke would ask again.
    parameters.set(name, file ? readInputParameters(file.content) : { keys: [], open: true });
  } catch {
    parameters.set(name, { keys: [], open: true });
  } finally {
    reading.delete(name);
    settle();
  }
}

function settle(): Promise<void> {
  if (!flush) {
    flush = new Promise((resolve) => {
      setTimeout(() => {
        flush = undefined;
        for (const listener of listeners) listener();
        resolve();
      }, SETTLE_MS);
    });
  }
  return flush;
}

// The flush that is coming, if one is. Nothing pending means what was said has already
// been said.
function settled(): Promise<void> {
  return flush ?? Promise.resolve();
}
