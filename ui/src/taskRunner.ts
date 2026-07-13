import ts from "typescript";
import { AskCancelledError, Kaja } from "./kaja";
import { Client, App, serviceId } from "./apps";
import { printStatements } from "./appLoader";

// Scripts are TypeScript but new Function only accepts JavaScript, so transpile
// first. Parse errors are thrown with line numbers pointing into the user's
// source. moduleDetection: Force keeps top-level await parseable even in a
// script with no imports.
function transpile(code: string): string {
  const output = ts.transpileModule(code, {
    compilerOptions: {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      moduleDetection: ts.ModuleDetectionKind.Force,
    },
    reportDiagnostics: true,
  });
  const errors = (output.diagnostics ?? []).filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
  if (errors.length > 0) {
    throw new Error(errors.map(formatDiagnostic).join("\n"));
  }
  return output.outputText;
}

function formatDiagnostic(diagnostic: ts.Diagnostic): string {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
  if (diagnostic.file && diagnostic.start !== undefined) {
    const { line } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
    return `Line ${line + 1}: ${message}`;
  }
  return message;
}

// prepareTask resolves a script's imports against the loaded apps and splits
// out the runnable body, returning the args every binding maps to plus the code.
function prepareTask(code: string, kaja: Kaja, apps: App[]): { args: { [key: string]: Client | Object }; runCode: string } {
  const file = ts.createSourceFile("task.js", transpile(code), ts.ScriptTarget.Latest);
  const args: { [key: string]: Client | Object } = {};
  const runStatements: ts.Statement[] = [];

  file.statements.forEach((statement) => {
    // moduleDetection: Force can make the transpiler emit a bare `export {};`,
    // which new Function would reject.
    if (ts.isExportDeclaration(statement)) {
      return;
    }
    if (ts.isImportDeclaration(statement)) {
      // slice(1, -1) - remove quotes
      const path = statement.moduleSpecifier.getText(file).slice(1, -1);
      // Monaco backs the kaja module with a model at ts:/kaja.ts, so its
      // auto-import and go-to-definition can emit the relative "./kaja" form.
      if (path === "kaja" || path === "./kaja") {
        const importClause = statement.importClause;
        if (importClause && importClause.namedBindings && ts.isNamedImports(importClause.namedBindings)) {
          importClause.namedBindings.elements.forEach((importSpecifier) => {
            const alias = importSpecifier.name.text;
            const name = importSpecifier.propertyName ? importSpecifier.propertyName.text : alias;
            if (name === "kaja") {
              args[alias] = kaja;
            }
          });
        }
        return;
      }
      const app = apps.find((app) => path.startsWith(app.configuration.name + "/"));
      if (!app) {
        return;
      }
      const source = app.sources.find((source) => source.importPath === path);
      if (!source) {
        return;
      }

      const importClause = statement.importClause;
      if (importClause && importClause.namedBindings && ts.isNamedImports(importClause.namedBindings)) {
        importClause.namedBindings.elements.forEach((importSpecifier) => {
          const alias = importSpecifier.name.text;
          const name = importSpecifier.propertyName ? importSpecifier.propertyName.text : alias;
          // Find service by name and source path to handle duplicate service names
          const service = app.services.find((s) => s.name === name && s.sourcePath === source.importPath);
          if (service) {
            const client = app.clients[serviceId(service)];
            if (client) {
              client.kaja = kaja;
              args[alias] = client.methods;
            }
          } else if (source.enums[name]) {
            args[alias] = source.enums[name].object;
          }
        });
      }
    } else {
      runStatements.push(statement);
    }
  });

  return { args, runCode: printStatements(runStatements) };
}

export function runTask(code: string, kaja: Kaja, apps: App[], onError: (error: unknown) => void) {
  let result: any;
  try {
    const { args, runCode } = prepareTask(code, kaja, apps);

    // Wrap the user's code in an async function so async keyword can be used
    const func = new Function(
      ...Object.keys(args),
      `
      return (async function() {
        ${runCode}
      })();
    `,
    );

    result = func(...Object.values(args));
  } catch (err) {
    onError(err);
    return;
  }
  if (result && typeof result.then === "function") {
    result.catch((err: unknown) => {
      // A cancelled prompt simply stops the script; surface everything else.
      if (err instanceof AskCancelledError) return;
      onError(err);
    });
  }
}

export interface CapturedRun {
  console: string[];
  result?: unknown;
  error?: string;
}

// runTaskCaptured runs a script and collects its console output, return value,
// and any error instead of letting them escape. Used by the MCP server so an
// agent can see what a script did.
export async function runTaskCaptured(code: string, kaja: Kaja, apps: App[]): Promise<CapturedRun> {
  const lines: string[] = [];
  const record = (level: string, parts: unknown[]) => {
    lines.push(parts.map(stringifyConsoleArg).join(" "));
    // Mirror to the real console so it still shows in dev tools.
    (console as any)[level]?.(...parts);
  };
  const captureConsole = {
    log: (...parts: unknown[]) => record("log", parts),
    info: (...parts: unknown[]) => record("info", parts),
    warn: (...parts: unknown[]) => record("warn", parts),
    error: (...parts: unknown[]) => record("error", parts),
    debug: (...parts: unknown[]) => record("debug", parts),
  };

  try {
    const { args, runCode } = prepareTask(code, kaja, apps);
    const func = new Function(
      ...Object.keys(args),
      "console",
      `
      return (async function() {
        ${runCode}
      })();
    `,
    );

    const result = await func(...Object.values(args), captureConsole);
    return { console: lines, result };
  } catch (err) {
    if (err instanceof AskCancelledError) {
      return { console: lines, error: "Script cancelled by user." };
    }
    return { console: lines, error: err instanceof Error ? err.message : String(err) };
  }
}

function stringifyConsoleArg(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
  } catch {
    return String(value);
  }
}
