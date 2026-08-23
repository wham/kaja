import { Script } from "./apps";

/**
 * The Files group, built from a flat listing plus the folders on disk.
 *
 * A folder is a real directory, so it is in the tree whether or not anything is
 * filed in it — an empty one persists, sorts with the rest, and shows nothing
 * when expanded. Folders sort first, alphabetically, files after, and neither
 * carries a count: a number next to `billing` answers a question nobody asked,
 * and it collides with the two counts that are load-bearing, the ones on the
 * group headers.
 */

export interface FolderNode {
  kind: "folder";
  // The folder's path relative to the scripts root, which is also its id.
  path: string;
  name: string;
  depth: number;
  children: TreeNode[];
}

export interface FileNode {
  kind: "file";
  script: Script;
  depth: number;
}

export type TreeNode = FolderNode | FileNode;

const byName = (a: string, b: string) => a.toLowerCase().localeCompare(b.toLowerCase()) || a.localeCompare(b);

/**
 * Builds the tree. `folders` is every directory under the scripts root, which
 * the listing itself can't say — a folder holding nothing has no file to be
 * inferred from — but a folder a script names is added anyway, so the tree is
 * complete even where the folder listing is stale or absent (the web has none).
 */
export function buildScriptTree(scripts: Script[], folders: string[] = []): TreeNode[] {
  const paths = new Set<string>();
  for (const folder of folders) addFolderPath(paths, folder);
  for (const script of scripts) addFolderPath(paths, script.folder);

  const childFolders = new Map<string, string[]>();
  for (const path of paths) {
    const parent = parentFolder(path);
    childFolders.set(parent, [...(childFolders.get(parent) ?? []), path]);
  }

  const childFiles = new Map<string, Script[]>();
  for (const script of scripts) {
    childFiles.set(script.folder, [...(childFiles.get(script.folder) ?? []), script]);
  }

  const build = (folder: string, depth: number): TreeNode[] => {
    const nodes: TreeNode[] = (childFolders.get(folder) ?? [])
      .sort((a, b) => byName(folderName(a), folderName(b)))
      .map((path) => ({ kind: "folder", path, name: folderName(path), depth, children: build(path, depth + 1) }) satisfies FolderNode);

    for (const script of (childFiles.get(folder) ?? []).sort((a, b) => byName(a.name, b.name))) {
      nodes.push({ kind: "file", script, depth });
    }
    return nodes;
  };

  return build("", 0);
}

/** Every folder in the tree, deepest path and all, sorted — what a folder picker offers. */
export function folderPaths(nodes: TreeNode[]): string[] {
  const paths: string[] = [];
  const walk = (list: TreeNode[]) => {
    for (const node of list) {
      if (node.kind !== "folder") continue;
      paths.push(node.path);
      walk(node.children);
    }
  };
  walk(nodes);
  return paths;
}

/**
 * The rows to draw, in order: a folder's children only while it is open. Folds
 * are the caller's, keyed by folder path.
 */
export function visibleRows(nodes: TreeNode[], openFolders: ReadonlySet<string>): TreeNode[] {
  const rows: TreeNode[] = [];
  const walk = (list: TreeNode[]) => {
    for (const node of list) {
      rows.push(node);
      if (node.kind === "folder" && openFolders.has(node.path)) walk(node.children);
    }
  };
  walk(nodes);
  return rows;
}

/**
 * A file's name split from its type. The sidebar is one list of names in one
 * font — mono was doing the work of saying "this one is on disk" and the group
 * label says that now — so the extension is drawn dim rather than dropped: it is
 * the same three characters on every row, and a file still looks like a file
 * without shouting. A name with no extension (or one that is nothing but an
 * extension) is all name.
 */
export function scriptNameParts(name: string): { base: string; extension: string } {
  const at = name.lastIndexOf(".");
  return at <= 0 ? { base: name, extension: "" } : { base: name.slice(0, at), extension: name.slice(at) };
}

/**
 * Whether a folder path is that folder or somewhere under it. Renaming a folder
 * and deleting one both act on everything filed there, and both read the flat
 * listing rather than the tree, so the prefix rule is written once. A path is
 * compared segment by segment: `billing-2024` is not inside `billing`.
 */
export function isWithinFolder(folder: string, path: string): boolean {
  if (!folder) return true;
  return path === folder || path.startsWith(folder + "/");
}

/** The files a folder holds, its subfolders included — what deleting it takes with it. */
export function scriptsWithin(scripts: Script[], folder: string): Script[] {
  return scripts.filter((script) => isWithinFolder(folder, script.folder));
}

export function folderName(path: string): string {
  const at = path.lastIndexOf("/");
  return at === -1 ? path : path.slice(at + 1);
}

export function parentFolder(path: string): string {
  const at = path.lastIndexOf("/");
  return at === -1 ? "" : path.slice(0, at);
}

// Every folder on the way down is a folder: "reports/weekly" implies "reports",
// which is what keeps a tree whole when only the deepest one is listed.
function addFolderPath(paths: Set<string>, folder: string): void {
  if (!folder) return;
  const parts = folder.split("/").filter(Boolean);
  let built = "";
  for (const part of parts) {
    built = built ? `${built}/${part}` : part;
    paths.add(built);
  }
}

/**
 * A folder name is a name, not a path, and it has to be one a filesystem will
 * take. The message is what the inline row shows; undefined means it is fine.
 */
export function folderNameError(name: string, siblings: string[]): string | undefined {
  const trimmed = name.trim();
  if (!trimmed) return "A folder needs a name";
  if (trimmed.includes("/") || trimmed.startsWith(".")) return "A folder name is a plain name";
  if (siblings.some((sibling) => sibling.toLowerCase() === trimmed.toLowerCase())) return `There is already a folder called “${trimmed}”`;
  return undefined;
}
