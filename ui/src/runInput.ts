import { getPersistedValue, setPersistedValue } from "./storage";

/**
 * What a file was last run with.
 *
 * `Run with parameters…` starts blank every time — a value from three days ago
 * silently riding along on a run is worse than typing it again — so the last
 * run is offered rather than applied: one link in the sheet, filling the fields
 * it can. That is also why this is kept per file rather than per parameter: the
 * offer is "the last run of this script", whole.
 *
 * A run that carried nothing records nothing, so a plain Run can't wipe what a
 * parameterised one left behind.
 */
export interface RunInputArchive {
  [fileId: string]: { at: number; input: { [key: string]: string } };
}

const STORAGE_KEY = "lastRunInput";
// Values are a few short strings each, and a file whose input hasn't been
// touched in fifty files' worth of runs is not the one being offered back.
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
