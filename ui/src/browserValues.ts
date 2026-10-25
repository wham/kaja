import type { RpcError, RpcInterceptor, RpcMetadata, RpcOptions } from "@protobuf-ts/runtime-rpc";
import { isWailsEnvironment } from "./wails";

/**
 * The values kaja.json only names, kept by the browser that holds them. A served kaja
 * has no keychain, so the browser is the store: every call carries the values it holds
 * for the open workspace, the process resolves against them for that call alone, and
 * whatever the call wrote - a value typed into the Variables tab, a sign-in, a token
 * renewed on the way - comes back in a trailer to be kept here. The desktop sends
 * nothing, its values being the keychain's.
 */
export const VALUES_HEADER = "X-Kaja-Values";
export const VALUES_TRAILER = "kaja-values";

const STORAGE_PREFIX = "kaja:values:";
// The workspace this origin last served, so the call that asks which workspace it is
// already carries that one's values.
const WORKSPACE_KEY = "kaja:valuesWorkspace";

interface Written {
  workspace?: string;
  values?: { [name: string]: string | null };
}

let workspace = remembered();
const listeners = new Set<() => void>();
let started = false;

/** Whether this window keeps values itself, rather than the process behind it. */
export function keepsValues(): boolean {
  if (isWailsEnvironment()) return false;
  try {
    return typeof window !== "undefined" && window.localStorage !== null;
  } catch {
    return false;
  }
}

/** Where a stored value is kept, as a source is named in a list. */
export function storedLabel(): string {
  return keepsValues() ? "Browser" : "Keychain";
}

/** Where a stored value is kept, as the end of a sentence. */
export function storedWhere(): string {
  return keepsValues() ? "in this browser" : "on this device";
}

/** The workspace the values are for, which every call names its values by. */
export function setValuesWorkspace(id: string): void {
  if (id === workspace || !keepsValues()) return;
  adopt(id);
  notify();
}

function adopt(id: string): void {
  workspace = id;
  try {
    window.localStorage.setItem(WORKSPACE_KEY, id);
  } catch {
    // Remembered for as long as this window is open.
  }
}

function remembered(): string {
  try {
    return (keepsValues() && window.localStorage.getItem(WORKSPACE_KEY)) || "";
  } catch {
    return "";
  }
}

export function storedValues(): { [name: string]: string } {
  return workspace ? read(workspace) : {};
}

export function onBrowserValuesChanged(listener: () => void): () => void {
  start();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function start(): void {
  if (started || !keepsValues()) return;
  started = true;
  // Another tab keeping a value is this window's value too.
  window.addEventListener("storage", (event) => {
    if (event.key?.startsWith(STORAGE_PREFIX) && event.key.slice(STORAGE_PREFIX.length) === workspace) notify();
  });
}

function notify(): void {
  for (const listener of listeners) listener();
}

function read(id: string): { [name: string]: string } {
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + id);
    const parsed = raw ? JSON.parse(raw) : undefined;
    return parsed && typeof parsed === "object" ? (parsed as { [name: string]: string }) : {};
  } catch {
    return {};
  }
}

function write(id: string, values: { [name: string]: string }): void {
  try {
    if (Object.keys(values).length === 0) window.localStorage.removeItem(STORAGE_PREFIX + id);
    else window.localStorage.setItem(STORAGE_PREFIX + id, JSON.stringify(values));
  } catch (error) {
    console.error("Failed to keep a value in this browser", error);
  }
}

/** The header a call carries, or undefined where this window keeps no values. */
export function valuesHeader(): string | undefined {
  if (!keepsValues()) return undefined;
  const payload: Written = workspace ? { workspace, values: read(workspace) } : {};
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Keeps what a call wrote, as the trailer it ended with says. */
export function absorbValues(trailer: unknown): void {
  if (trailer === undefined || trailer === null || !keepsValues()) return;
  let written: Written;
  try {
    // Percent-encoded, as every trailer kaja writes is.
    written = JSON.parse(decodeURIComponent(String(Array.isArray(trailer) ? trailer[0] : trailer))) as Written;
  } catch {
    return;
  }
  const id = written.workspace ?? "";
  if (!id || !written.values) return;
  const values = read(id);
  for (const [name, value] of Object.entries(written.values)) {
    if (value === null) delete values[name];
    else values[name] = value;
  }
  write(id, values);
  // The workspace had no id until the write gave it one, and the next call has to
  // name the values by it before the workspace that says so arrives.
  if (!workspace) adopt(id);
  notify();
}

function withValues(options: RpcOptions): RpcOptions {
  const header = valuesHeader();
  if (header === undefined) return options;
  return { ...options, meta: { ...options.meta, [VALUES_HEADER]: header } };
}

// A failed call ends with its trailers on the error, and a token renewed before the
// API refused the call is still the token to keep.
function absorbFrom(trailers: PromiseLike<RpcMetadata>): void {
  trailers.then(
    (meta) => absorbValues(meta[VALUES_TRAILER]),
    (error: RpcError | undefined) => absorbValues(error?.meta?.[VALUES_TRAILER]),
  );
}

/** Carries the values on every call and keeps what each call wrote. */
export const browserValuesInterceptor: RpcInterceptor = {
  interceptUnary(next, method, input, options) {
    const call = next(method, input, withValues(options));
    absorbFrom(call.trailers);
    return call;
  },
  interceptServerStreaming(next, method, input, options) {
    const call = next(method, input, withValues(options));
    absorbFrom(call.trailers);
    return call;
  },
};
