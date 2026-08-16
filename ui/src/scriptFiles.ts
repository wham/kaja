import { Script, scriptName } from "./apps";
import { getApiClient } from "./server/connection";
import { isWailsEnvironment } from "./wails";
import {
  CreateScript,
  CreateScriptFolder,
  DeleteScript,
  DeleteScriptFolder,
  ListScriptFolders,
  ListScripts,
  ReadScriptFile,
  RenameScript,
  RenameScriptFolder,
  WriteScriptFile,
} from "./wailsjs/go/main/App";

/**
 * The workspace's `scripts` folder, whichever process is holding the disk. The
 * desktop app opens the files itself; a browser goes through the server, which
 * is what puts a script mounted into a container in the sidebar
 * (`docker run -v .../workspace:/workspace`).
 *
 * Only the reads are on both. Saving, renaming, moving, deleting and making a
 * folder stay Wails-only, on the rule the configuration already follows: a
 * server serving a workspace it does not own doesn't offer the verbs that write
 * it. So a script on the web is a file you can read and run, and
 * `canWriteScripts` is what the rest of the UI asks rather than asking which
 * platform it is on.
 */
export function canWriteScripts(): boolean {
  return isWailsEnvironment();
}

export async function listScriptFiles(): Promise<Script[]> {
  if (isWailsEnvironment()) {
    const list = await ListScripts();
    return (list ?? []).map((script) => ({ path: script.path, name: script.name, folder: script.folder ?? "" }));
  }
  const { response } = await getApiClient().listScripts({});
  return response.scripts.map((script) => ({ path: script.path, name: script.name, folder: script.folder }));
}

/**
 * Every directory under the scripts root. A folder holding nothing has no file
 * to be inferred from, so it has to be listed of its own — and only the desktop
 * can make one, so only the desktop asks.
 */
export async function listScriptFolders(): Promise<string[]> {
  if (!isWailsEnvironment()) return [];
  return (await ListScriptFolders()) ?? [];
}

/**
 * Reads one script. Both sides take the script's name within the folder — the
 * desktop resolves it inside the folder just as the server does, because a path
 * is a name to resolve rather than a handle to follow.
 */
export async function readScriptFile(script: Script): Promise<{ script: Script; content: string } | undefined> {
  if (isWailsEnvironment()) {
    const file = await ReadScriptFile(scriptName(script));
    if (!file) return undefined;
    return { script: { path: file.path, name: file.name, folder: file.folder ?? "" }, content: file.content };
  }
  const { response } = await getApiClient().readScript({ name: scriptName(script) });
  if (!response.script) return undefined;
  return {
    script: { path: response.script.path, name: response.script.name, folder: response.script.folder },
    content: response.script.content,
  };
}

/** Writes a file that already exists. Creating one is the other verb. */
export async function writeScriptFile(script: Script, content: string): Promise<void> {
  await WriteScriptFile(scriptName(script), content);
}

/**
 * Names a draft: a name and a folder become one relative path, which is what
 * the disk takes. The folder is created if it doesn't exist, so filing
 * somewhere new needs no trip to the sidebar first.
 */
export async function createScriptFile(name: string, folder: string, content: string): Promise<Script> {
  const file = await CreateScript(folder ? `${folder}/${name}` : name, content);
  return { path: file.path, name: file.name, folder: file.folder ?? "" };
}

/** Renames a file, and moves it when the new name carries a different folder. */
export async function renameScriptFile(script: Script, name: string, folder: string): Promise<Script> {
  const file = await RenameScript(scriptName(script), folder ? `${folder}/${name}` : name);
  return { path: file.path, name: file.name, folder: file.folder ?? "" };
}

export async function deleteScriptFile(script: Script): Promise<void> {
  await DeleteScript(scriptName(script));
}

export async function createScriptFolder(path: string): Promise<string> {
  return await CreateScriptFolder(path);
}

export async function renameScriptFolder(path: string, name: string): Promise<string> {
  return await RenameScriptFolder(path, name);
}

export async function deleteScriptFolder(path: string): Promise<void> {
  await DeleteScriptFolder(path);
}
