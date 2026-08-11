import { Script } from "./apps";
import { getApiClient } from "./server/connection";
import { isWailsEnvironment } from "./wails";
import { ListScripts, ReadScriptFile } from "./wailsjs/go/main/App";

/**
 * Reading the workspace's `scripts` folder, whichever process is holding the
 * disk. The desktop app opens the file itself; a browser goes through the
 * server, which is what puts a script mounted into a container in the sidebar
 * (`docker run -v .../workspace:/workspace`).
 *
 * Only the reads are here. Saving, renaming and deleting stay Wails-only, on the
 * rule the configuration already follows: a server serving a workspace it does
 * not own doesn't offer the verbs that write it. So a script on the web is a
 * file you can read and run, and `canWriteScripts` is what the rest of the UI
 * asks rather than asking which platform it is on.
 */
export function canWriteScripts(): boolean {
  return isWailsEnvironment();
}

export async function listScriptFiles(): Promise<Script[]> {
  if (isWailsEnvironment()) {
    const list = await ListScripts();
    return (list ?? []).map((script) => ({ path: script.path, name: script.name }));
  }
  const { response } = await getApiClient().listScripts({});
  return response.scripts.map((script) => ({ path: script.path, name: script.name }));
}

/**
 * Reads one script. The desktop reads it by path, which is what it listed; the
 * server takes the bare name and resolves it inside the scripts folder itself,
 * because a path arriving from a browser is not a handle it may follow.
 */
export async function readScriptFile(script: Script): Promise<{ script: Script; content: string } | undefined> {
  if (isWailsEnvironment()) {
    const file = await ReadScriptFile(script.path);
    if (!file) return undefined;
    return { script: { path: file.path, name: file.name }, content: file.content };
  }
  const { response } = await getApiClient().readScript({ name: script.name });
  if (!response.script) return undefined;
  return { script: { path: response.script.path, name: response.script.name }, content: response.script.content };
}
