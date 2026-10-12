import { useSyncExternalStore } from "react";
import { isWailsEnvironment, desktop } from "./wails";

/**
 * The person's settings: what follows them from one workspace to the next, where the
 * `Workspace` is what one folder's kaja.json says. A setting here wins over the
 * workspace's, which is only where somebody who has set nothing starts.
 *
 * On the desktop they are the installation's settings.json, reached through a binding,
 * and the MCP half stays with the process that opens the listener. In a browser they
 * are `localStorage`, which an origin's tabs share and which says when it changes, so
 * a key recorded or a switch flipped in one window reaches the others as they are.
 */
export interface Settings {
  shortcuts: { [action: string]: string };
  mcp: {
    // Unset until this browser has flipped the switch, so the workspace's word stands.
    enabled?: boolean;
    token?: string;
  };
}

const STORAGE_KEY = "kaja:settings";
const LEGACY_AGENT_KEY = "kaja:agentSession";

let settings: Settings = { shortcuts: {}, mcp: {} };
const listeners = new Set<() => void>();
let started = false;

function notify(): void {
  for (const listener of listeners) listener();
}

function readStored(): Settings {
  const read = (key: string): unknown => {
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : undefined;
    } catch {
      return undefined;
    }
  };
  const stored = read(STORAGE_KEY) as Partial<Settings> | undefined;
  if (stored) {
    return { shortcuts: { ...stored.shortcuts }, mcp: { ...stored.mcp } };
  }
  // The token is an address agents were configured with, so it is carried over.
  const legacy = read(LEGACY_AGENT_KEY) as { token?: unknown } | undefined;
  return { shortcuts: {}, mcp: typeof legacy?.token === "string" ? { token: legacy.token } : {} };
}

function writeStored(next: Settings): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    window.localStorage.removeItem(LEGACY_AGENT_KEY);
  } catch {
    // A browser refusing storage keeps them for as long as this window is open.
  }
}

function onStorage(event: StorageEvent): void {
  if (event.key !== null && event.key !== STORAGE_KEY) return;
  settings = readStored();
  notify();
}

/** Reads the settings once. Safe to call more than once. */
export function startSettings(): void {
  if (started) return;
  started = true;
  if (isWailsEnvironment()) {
    void desktop()
      .then((app) => app.Shortcuts())
      .then((shortcuts) => {
        settings = { ...settings, shortcuts: definedOnly(shortcuts) };
        notify();
      })
      .catch((err) => console.error(`Failed to read the settings: ${err instanceof Error ? err.message : String(err)}`));
    return;
  }
  settings = readStored();
  window.addEventListener("storage", onStorage);
}

export function getSettings(): Settings {
  return settings;
}

export function subscribeSettings(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useSettings(): Settings {
  return useSyncExternalStore(subscribeSettings, getSettings, getSettings);
}

function update(change: (current: Settings) => Settings): void {
  settings = change(settings);
  if (!isWailsEnvironment()) writeStored(settings);
  notify();
}

export async function saveShortcuts(shortcuts: { [action: string]: string }): Promise<void> {
  if (isWailsEnvironment()) {
    await (await desktop()).SetShortcuts(shortcuts);
  }
  update((current) => ({ ...current, shortcuts: { ...shortcuts } }));
}

/** The browser's switch. The desktop's is the process's. */
export function saveMcpEnabled(enabled: boolean): void {
  update((current) => ({ ...current, mcp: { ...current.mcp, enabled } }));
}

/** The browser's token. The desktop's is the process's. */
export function saveMcpToken(token: string): void {
  update((current) => ({ ...current, mcp: { ...current.mcp, token } }));
}

/**
 * The overrides the window answers to: the workspace's, with the person's laid over
 * them by action.
 */
export function effectiveShortcuts(workspace: { [action: string]: string } | undefined, person: { [action: string]: string }): { [action: string]: string } {
  return { ...workspace, ...person };
}

function definedOnly(map: { [key: string]: string | undefined }): { [key: string]: string } {
  const result: { [key: string]: string } = {};
  for (const [key, value] of Object.entries(map)) {
    if (value !== undefined) result[key] = value;
  }
  return result;
}
