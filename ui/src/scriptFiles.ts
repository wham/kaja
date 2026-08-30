import { Script, scriptName } from "./apps";
import { getApiClient } from "./server/connection";
import { Runtime, Script as WireScript } from "./server/api";

/**
 * The workspace's `scripts` folder, whichever process is holding the disk. Both
 * builds reach it the same way: the desktop's window fetches these calls over
 * the mux its webview already speaks, a browser fetches them over the wire, and
 * whichever process opened the workspace is the one that reads and writes it.
 *
 * The reads are always offered. The writes are refused where this kaja does not
 * own the workspace it serves — the rule the configuration already follows — so
 * a script on a deployed kaja is a file you can read and run.
 */

/**
 * Whether this kaja may write the workspace it opened. It is the one question
 * the process answers at startup and the configuration already reports: the
 * scripts folder and kaja.json are both in that workspace, so a kaja that may
 * not write one may not write the other.
 */
export function canWriteScripts(runtime: Runtime): boolean {
  return runtime.canUpdateConfiguration;
}

function toScript(script: WireScript): Script {
  return { path: script.path, name: script.name, folder: script.folder };
}

export async function listScriptFiles(): Promise<Script[]> {
  const { response } = await getApiClient().listScripts({});
  return response.scripts.map(toScript);
}

/**
 * Every directory under the scripts root. A folder holding nothing has no file
 * to be inferred from, so it has to be listed of its own.
 */
export async function listScriptFolders(): Promise<string[]> {
  const { response } = await getApiClient().listScriptFolders({});
  return response.folders;
}

/**
 * Reads one script by its name within the folder — a path is a name to resolve
 * rather than a handle to follow.
 */
export async function readScriptFile(script: Script): Promise<{ script: Script; content: string } | undefined> {
  const { response } = await getApiClient().readScript({ name: scriptName(script) });
  if (!response.script) return undefined;
  return { script: toScript(response.script), content: response.script.content };
}

/** Writes a file that already exists. Creating one is the other verb. */
export async function writeScriptFile(script: Script, content: string): Promise<void> {
  await getApiClient().writeScript({ name: scriptName(script), content });
}

/**
 * Names a draft: a name and a folder become one relative path, which is what
 * the disk takes. The folder is created if it doesn't exist, so filing
 * somewhere new needs no trip to the sidebar first.
 */
export async function createScriptFile(name: string, folder: string, content: string): Promise<Script> {
  const { response } = await getApiClient().createScript({ name: folder ? `${folder}/${name}` : name, content });
  return toScript(response.script!);
}

/** Renames a file, and moves it when the new name carries a different folder. */
export async function renameScriptFile(script: Script, name: string, folder: string): Promise<Script> {
  const { response } = await getApiClient().renameScript({ name: scriptName(script), newName: folder ? `${folder}/${name}` : name });
  return toScript(response.script!);
}

export async function deleteScriptFile(script: Script): Promise<void> {
  await getApiClient().deleteScript({ name: scriptName(script) });
}

export async function createScriptFolder(path: string): Promise<string> {
  const { response } = await getApiClient().createScriptFolder({ name: path });
  return response.folder;
}

export async function renameScriptFolder(path: string, name: string): Promise<string> {
  const { response } = await getApiClient().renameScriptFolder({ name: path, newName: name });
  return response.folder;
}

export async function deleteScriptFolder(path: string): Promise<void> {
  await getApiClient().deleteScriptFolder({ name: path });
}
