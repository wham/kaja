import { describe, expect, it } from "bun:test";
import { Script } from "./apps";
import { buildScriptTree, folderNameError, folderPaths, scriptNameParts, TreeNode, visibleRows } from "./scriptTree";

function script(folder: string, name: string): Script {
  return { path: `/w/scripts/${folder ? folder + "/" : ""}${name}`, name, folder };
}

describe("buildScriptTree", () => {
  it("sorts folders first, then files, both alphabetically", () => {
    const tree = buildScriptTree([script("", "zebra.ts"), script("", "alpha.ts"), script("reports", "churn.ts"), script("billing", "invoices.ts")]);

    expect(tree.map((node) => (node.kind === "folder" ? node.path : node.script.name))).toEqual(["billing", "reports", "alpha.ts", "zebra.ts"]);
  });

  it("keeps an empty folder, because it is a directory and not a grouping", () => {
    const tree = buildScriptTree([script("", "a.ts")], ["seed-data"]);

    expect(tree[0]).toMatchObject({ kind: "folder", path: "seed-data", children: [] });
  });

  it("implies every folder on the way down", () => {
    const tree = buildScriptTree([script("reports/weekly", "usage.ts")]);

    expect(tree).toHaveLength(1);
    const reports = tree[0];
    expect(reports).toMatchObject({ kind: "folder", path: "reports", depth: 0 });
    expect(folderPaths(tree)).toEqual(["reports", "reports/weekly"]);
    if (reports.kind !== "folder") throw new Error("expected a folder");
    expect(reports.children[0]).toMatchObject({ kind: "folder", path: "reports/weekly", depth: 1 });
  });
});

describe("visibleRows", () => {
  const tree = buildScriptTree([script("reports/weekly", "usage.ts"), script("", "root.ts")]);

  it("draws a folder's children only while it is open", () => {
    expect(visibleRows(tree, new Set()).map(label)).toEqual(["reports", "root.ts"]);
    expect(visibleRows(tree, new Set(["reports"])).map(label)).toEqual(["reports", "reports/weekly", "root.ts"]);
    expect(visibleRows(tree, new Set(["reports", "reports/weekly"])).map(label)).toEqual(["reports", "reports/weekly", "usage.ts", "root.ts"]);
  });
});

describe("scriptNameParts", () => {
  it("splits the extension off, and leaves a name that has none alone", () => {
    expect(scriptNameParts("churn.ts")).toEqual({ base: "churn", extension: ".ts" });
    expect(scriptNameParts("markdown-log-entry.ts")).toEqual({ base: "markdown-log-entry", extension: ".ts" });
    expect(scriptNameParts("notes.d.ts")).toEqual({ base: "notes.d", extension: ".ts" });
    expect(scriptNameParts("README")).toEqual({ base: "README", extension: "" });
    expect(scriptNameParts(".gitignore")).toEqual({ base: ".gitignore", extension: "" });
  });
});

describe("folderNameError", () => {
  it("refuses a path, a dotfile, an empty name and a duplicate", () => {
    expect(folderNameError("reports", [])).toBeUndefined();
    expect(folderNameError("  ", [])).toBeDefined();
    expect(folderNameError("a/b", [])).toBeDefined();
    expect(folderNameError(".git", [])).toBeDefined();
    expect(folderNameError("Reports", ["reports"])).toBeDefined();
  });
});

function label(node: TreeNode): string {
  return node.kind === "folder" ? node.path : node.script.name;
}
