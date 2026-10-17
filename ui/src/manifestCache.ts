import { appParameters, appType } from "./appTypes";
import { WorkspaceApp } from "./server/api";
import { manifestStore } from "./storage";

/**
 * The manifest an app last compiled to, kept between sessions so the next window
 * opens on the surface it had rather than on a spinner. It is only ever a head start:
 * the app is compiled again underneath it, and what the server answers replaces it
 * where the two differ.
 *
 * A store of its own rather than a key in `ui-state`, which is read whole into memory
 * when the window opens and kept there: a manifest is the largest thing the window
 * stores and is wanted once, per app, at startup, so it is read per app and never
 * cached.
 */

export interface StoredManifest {
  // What the app was when the manifest was compiled, so a configuration that moved
  // since starts over rather than opening on a surface it no longer has.
  fingerprint: string;
  manifest: string;
}

// The type and the parameters are what the surface is compiled from; the name and the
// headers are not, so a renamed app keeps its head start and a token changing costs
// nothing. Keys are sorted because equality is the whole point.
export function manifestFingerprint(app: WorkspaceApp): string {
  const parameters = appParameters(app);
  return JSON.stringify([
    appType(app),
    Object.keys(parameters)
      .sort()
      .map((key) => [key, parameters[key]]),
  ]);
}

export function matchesStored(app: WorkspaceApp, stored: StoredManifest | undefined): stored is StoredManifest {
  return stored !== undefined && stored.fingerprint === manifestFingerprint(app) && stored.manifest !== "";
}

/**
 * The manifests held for these apps, and nothing for anyone else: an entry for an app
 * the workspace no longer names is deleted on the way past. A database that isn't
 * there answers with nothing, which is a cold start.
 */
export function readStoredManifests(names: string[]): Promise<Map<string, StoredManifest>> {
  const store = manifestStore("readwrite");
  const held = new Map<string, StoredManifest>();
  if (!store) return Promise.resolve(held);
  const wanted = new Set(names);
  return new Promise((resolve) => {
    const request = store.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve(held);
        return;
      }
      const name = cursor.key as string;
      if (wanted.has(name)) held.set(name, cursor.value as StoredManifest);
      else cursor.delete();
      cursor.continue();
    };
    request.onerror = () => resolve(held);
  });
}

export function storeManifest(app: WorkspaceApp, manifest: string): void {
  const store = manifestStore("readwrite");
  if (!store) return;
  try {
    const stored: StoredManifest = { fingerprint: manifestFingerprint(app), manifest };
    store.put(stored, app.name);
  } catch (error) {
    console.error("Failed to store the compiled app:", error);
  }
}

export function forgetManifests(names: string[]): void {
  if (names.length === 0) return;
  const store = manifestStore("readwrite");
  if (!store) return;
  for (const name of names) store.delete(name);
}

// A rename keeps the head start: the fingerprint is the type and the parameters, which
// is what a rename leaves alone.
export function moveManifest(from: string, to: string): void {
  const store = manifestStore("readwrite");
  if (!store) return;
  const request = store.get(from);
  request.onsuccess = () => {
    const held = request.result as StoredManifest | undefined;
    if (!held) return;
    store.put(held, to);
    store.delete(from);
  };
}
