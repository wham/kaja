import libs from "kaja:typescript-libs";
import ts from "typescript-js";
import type { WorkerReply, WorkerRequest } from "./typescriptProtocol";

const files = new Map<string, { text: string; version: number }>();
const libFiles = new Map(Object.entries(libs).map(([name, text]) => ["/" + name, ts.ScriptSnapshot.fromString(text)]));

const options: ts.CompilerOptions = {
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.ESNext,
  // The task runner reads every script as a module (scriptSyntax), so without it a
  // script with no import is a global script to the editor alone: top-level await is
  // an error in it, and its top-level names collide with every other such script.
  moduleDetection: ts.ModuleDetectionKind.Force,
  allowNonTsExtensions: true,
};

function lookup(candidates: string[]): ts.ResolvedModuleFull | undefined {
  for (const candidate of candidates) {
    if (files.has(candidate)) {
      return { resolvedFileName: candidate, extension: candidate.endsWith(".d.ts") ? ts.Extension.Dts : ts.Extension.Ts, isExternalLibraryImport: false };
    }
  }
  return undefined;
}

function join(dir: string, relative: string): string {
  const parts = dir.split("/").filter(Boolean);
  for (const part of relative.split("/")) {
    if (part === "..") parts.pop();
    else if (part !== "." && part !== "") parts.push(part);
  }
  return "/" + parts.join("/");
}

// Every module is a buffer the window wrote here, so resolution is a lookup rather
// than a walk of node_modules: a bare name is an app's barrel or the kaja module, and a
// relative one is a file beside the module importing it.
function resolve(name: string, containingFile: string): ts.ResolvedModuleFull | undefined {
  if (name.startsWith(".")) {
    const base = join(containingFile.slice(0, containingFile.lastIndexOf("/")), name).replace(/\.js$/, "");
    return lookup([base, base + ".ts", base + ".d.ts", base + "/index.ts"]);
  }
  return lookup(["/" + name + ".ts", "/" + name + ".d.ts"]);
}

const host: ts.LanguageServiceHost = {
  getCompilationSettings: () => options,
  getScriptFileNames: () => [...files.keys()],
  getScriptVersion: (path) => String(files.get(path)?.version ?? 0),
  getScriptSnapshot: (path) => {
    const file = files.get(path);
    if (file) return ts.ScriptSnapshot.fromString(file.text);
    return libFiles.get(path);
  },
  getCurrentDirectory: () => "/",
  getDefaultLibFileName: () => "/lib.esnext.full.d.ts",
  fileExists: (path) => files.has(path) || libFiles.has(path),
  readFile: (path) => files.get(path)?.text ?? (libFiles.get(path) ? libs[path.slice(1)] : undefined),
  resolveModuleNameLiterals: (literals, containingFile) => literals.map((literal) => ({ resolvedModule: resolve(literal.text, containingFile) })),
};

const service = ts.createLanguageService(host, ts.createDocumentRegistry());

function flatten(message: string | ts.DiagnosticMessageChain): string {
  if (typeof message === "string") return message;
  return [message.messageText, ...(message.next ?? []).map(flatten)].join(" ");
}

function documentation(parts: ts.SymbolDisplayPart[] | undefined, tags: ts.JSDocTagInfo[] | undefined): string {
  const text = ts.displayPartsToString(parts);
  const tagText = (tags ?? []).map((tag) => `@${tag.name}${tag.text ? " " + ts.displayPartsToString(tag.text) : ""}`);
  return [text, ...tagText].filter(Boolean).join("\n\n");
}

const methods = {
  diagnostics(path: string) {
    if (!files.has(path)) return [];
    const syntactic = service.getSyntacticDiagnostics(path);
    // What the checker says past a syntax error is noise.
    const all = syntactic.length > 0 ? syntactic : service.getSemanticDiagnostics(path);
    return all.map((diagnostic) => ({
      start: diagnostic.start ?? 0,
      length: diagnostic.length ?? 0,
      message: flatten(diagnostic.messageText),
      category: diagnostic.category,
      code: diagnostic.code,
    }));
  },

  completions(path: string, position: number) {
    if (!files.has(path)) return undefined;
    const info = service.getCompletionsAtPosition(path, position, { includeCompletionsWithInsertText: true });
    if (!info) return undefined;
    const text = files.get(path)!.text;
    let from = position;
    while (from > 0 && /[\w$]/.test(text[from - 1])) from--;
    return {
      from,
      entries: info.entries.map((entry) => ({
        name: entry.name,
        kind: entry.kind,
        sortText: entry.sortText,
        insertText: entry.insertText,
        replacement: entry.replacementSpan && { from: entry.replacementSpan.start, to: entry.replacementSpan.start + entry.replacementSpan.length },
        source: entry.source,
      })),
    };
  },

  completionDetails(path: string, position: number, name: string, source: string | undefined) {
    if (!files.has(path)) return undefined;
    const details = service.getCompletionEntryDetails(path, position, name, undefined, source, undefined, undefined);
    if (!details) return undefined;
    return { signature: ts.displayPartsToString(details.displayParts), documentation: documentation(details.documentation, details.tags) };
  },

  quickInfo(path: string, position: number) {
    if (!files.has(path)) return undefined;
    const info = service.getQuickInfoAtPosition(path, position);
    if (!info) return undefined;
    return {
      start: info.textSpan.start,
      end: info.textSpan.start + info.textSpan.length,
      signature: ts.displayPartsToString(info.displayParts),
      documentation: documentation(info.documentation, info.tags),
    };
  },

  definition(path: string, position: number) {
    if (!files.has(path)) return [];
    return (service.getDefinitionAtPosition(path, position) ?? [])
      .filter((definition) => files.has(definition.fileName))
      .map((definition) => ({ path: definition.fileName, start: definition.textSpan.start }));
  },
};

export type TypeScriptMethods = typeof methods;

// The worker's global, which the DOM library the UI is checked against calls a Window.
const scope = self as unknown as { onmessage: (event: MessageEvent<WorkerRequest>) => void; postMessage: (message: WorkerReply) => void };

scope.onmessage = (event) => {
  const message = event.data;
  if (message.type === "update") {
    files.set(message.path, { text: message.text, version: (files.get(message.path)?.version ?? 0) + 1 });
    return;
  }
  if (message.type === "remove") {
    files.delete(message.path);
    return;
  }
  let reply: WorkerReply;
  try {
    const method = methods[message.method] as (...args: unknown[]) => unknown;
    reply = { id: message.id, result: method(...message.args) };
  } catch (error) {
    reply = { id: message.id, error: error instanceof Error ? error.message : String(error) };
  }
  scope.postMessage(reply);
};
