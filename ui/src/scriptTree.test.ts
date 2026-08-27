import { describe, expect, it } from "bun:test";
import { Script } from "./apps";
import {
  buildScriptTree,
  folderNameError,
  folderPaths,
  isWithinFolder,
  resolveScriptRename,
  scriptNameParts,
  scriptRenameError,
  scriptsWithin,
  TreeNode,
  visibleRows,
} from "./scriptTree";

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

describe("isWithinFolder", () => {
  it("takes the folder itself and everything under it, and nothing that merely starts the same", () => {
    expect(isWithinFolder("billing", "billing")).toBe(true);
    expect(isWithinFolder("billing", "billing/2024")).toBe(true);
    expect(isWithinFolder("billing", "billing-2024")).toBe(false);
    expect(isWithinFolder("billing", "reports")).toBe(false);
    expect(isWithinFolder("billing", "")).toBe(false);
    // The root holds everything, files at the top level included.
    expect(isWithinFolder("", "reports")).toBe(true);
  });
});

describe("scriptsWithin", () => {
  it("is what deleting a folder takes with it", () => {
    const scripts = [script("billing", "invoices.ts"), script("billing/2024", "january.ts"), script("billing-2024", "old.ts"), script("", "root.ts")];

    expect(scriptsWithin(scripts, "billing").map((s) => s.name)).toEqual(["invoices.ts", "january.ts"]);
    expect(scriptsWithin(scripts, "billing/2024").map((s) => s.name)).toEqual(["january.ts"]);
    expect(scriptsWithin(scripts, "reports")).toEqual([]);
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

describe("resolveScriptRename", () => {
  it("keeps a plain name in the folder it was typed in, extension or not", () => {
    expect(resolveScriptRename("billing", "invoices.ts")).toEqual({ folder: "billing", name: "invoices.ts" });
    expect(resolveScriptRename("billing", "invoices")).toEqual({ folder: "billing", name: "invoices.ts" });
    expect(resolveScriptRename("", "  churn  ")).toEqual({ folder: "", name: "churn.ts" });
  });

  it("files it deeper on a slash and walks back out on ..", () => {
    expect(resolveScriptRename("billing", "2024/january.ts")).toEqual({ folder: "billing/2024", name: "january.ts" });
    expect(resolveScriptRename("billing/2024", "../january.ts")).toEqual({ folder: "billing", name: "january.ts" });
    expect(resolveScriptRename("billing/2024", "../../january.ts")).toEqual({ folder: "", name: "january.ts" });
    expect(resolveScriptRename("billing", "./january.ts")).toEqual({ folder: "billing", name: "january.ts" });
  });

  it("names nothing when it is empty, absolute, hidden, or past the root", () => {
    expect(resolveScriptRename("billing", "   ")).toBeUndefined();
    expect(resolveScriptRename("billing", "/etc/passwd.ts")).toBeUndefined();
    expect(resolveScriptRename("billing", "../../january.ts")).toBeUndefined();
    expect(resolveScriptRename("billing", "reports/")).toBeUndefined();
    expect(resolveScriptRename("billing", "..")).toBeUndefined();
    expect(resolveScriptRename("billing", ".hidden.ts")).toBeUndefined();
  });
});

describe("scriptRenameError", () => {
  const taken = [
    { folder: "billing", name: "invoices.ts" },
    { folder: "", name: "churn.ts" },
  ];

  it("refuses an empty name, a path that names nothing, and a file already filed there", () => {
    expect(scriptRenameError("receipts", "billing", taken)).toBeUndefined();
    expect(scriptRenameError("  ", "billing", taken)).toBe("A file needs a name");
    expect(scriptRenameError("/tmp/x.ts", "billing", taken)).toBeDefined();
    expect(scriptRenameError("INVOICES", "billing", taken)).toBeDefined();
    // The clash follows the path: the same name is free one folder up.
    expect(scriptRenameError("invoices", "", taken)).toBeUndefined();
    expect(scriptRenameError("../churn.ts", "billing", taken)).toBeDefined();
  });
});

function label(node: TreeNode): string {
  return node.kind === "folder" ? node.path : node.script.name;
}
