import { getPersistedValue, setPersistedValue } from "./storage";

/**
 * What a file was last run with.
 *
 * The input belongs to the file's last run rather than to the door it came in
 * through: a deeplink, a `kaja.run` cell and the parameter sheet all write it,
 * and Run reads it. So Run repeats the run that just happened — which is the
 * whole of the edit-and-rerun loop a deeplink lands you in — and changing the
 * values is `Run with parameters…`, whose fields open on them rather than
 * blank. It is kept per file rather than per parameter because what is repeated
 * is "the last run of this script", whole.
 *
 * The objection to keeping it is a value from three days ago silently riding
 * along on a run. The answer is that it does not ride silently: a run states
 * its own input (`Run.input`, drawn beside the run number in the pill and the
 * picker), so what Run will carry is on screen before it is pressed.
 *
 * A run that carried nothing records nothing, so a plain Run on a script that
 * reads no parameters can't wipe what a parameterised one left behind. The
 * sheet ships every key it lists, blank or not, which is how clearing its
 * fields and running takes the values back off.
 */
export interface RunInputArchive {
  [fileId: string]: { at: number; input: { [key: string]: string } };
}

const STORAGE_KEY = "lastRunInput";
// Values are a few short strings each, and a file whose input hasn't been
// touched in fifty files' worth of runs is not the one being repeated.
const MAX_FILES = 50;

/** The values a file was last run with, if any are still held. */
export function lastRunInput(fileId: string): { [key: string]: string } | undefined {
  const archive = getPersistedValue<RunInputArchive>(STORAGE_KEY) ?? {};
  return archive[fileId]?.input;
}

/** Record what a run was started with. A run that carried nothing is not one. */
export function rememberRunInput(fileId: string, input: { [key: string]: string }, now = Date.now()): void {
  if (Object.keys(input).length === 0) return;
  setPersistedValue(STORAGE_KEY, rememberIn(getPersistedValue<RunInputArchive>(STORAGE_KEY) ?? {}, fileId, input, now));
}

/**
 * What a plain Run carries: the last run's values, for the parameters the
 * script still reads. A key the script has stopped reading is dropped rather
 * than repeated — it would be stated on the run and mean nothing to it.
 */
export function repeatInput(last: { [key: string]: string } | undefined, keys: string[]): { [key: string]: string } | undefined {
  if (!last) return undefined;
  const held = keys.filter((key) => last[key] !== undefined);
  if (held.length === 0) return undefined;
  return Object.fromEntries(held.map((key) => [key, last[key]]));
}

/**
 * What a run carried, in the deeplink's own grammar: it is read at a glance
 * beside a run number rather than pasted anywhere, so the values are shown as
 * they were typed rather than escaped. A key whose value is blank still says so
 * — an empty string is a value a script reads, and not the same as no key.
 */
export function runInputLabel(input: { [key: string]: string } | undefined): string | undefined {
  const pairs = Object.entries(input ?? {});
  if (pairs.length === 0) return undefined;
  return pairs.map(([key, value]) => `${key}=${value}`).join(" · ");
}

/** Renaming a file keeps its runs, so it keeps what they were run with too. */
export function moveRunInput(fromFileId: string, toFileId: string): void {
  const archive = getPersistedValue<RunInputArchive>(STORAGE_KEY);
  const held = archive?.[fromFileId];
  if (!archive || !held) return;
  const { [fromFileId]: _moved, ...rest } = archive;
  setPersistedValue(STORAGE_KEY, { ...rest, [toFileId]: held });
}

export function rememberIn(archive: RunInputArchive, fileId: string, input: { [key: string]: string }, now: number): RunInputArchive {
  const next: RunInputArchive = { ...archive, [fileId]: { at: now, input } };
  const files = Object.entries(next);
  if (files.length <= MAX_FILES) return next;
  return Object.fromEntries(files.sort(([, a], [, b]) => b.at - a.at).slice(0, MAX_FILES));
}
