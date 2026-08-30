import ts from "typescript";
import { ApprovalRejectedError, AskCancelledError, Kaja } from "./kaja";
import { Client, App, serviceId } from "./apps";
import { appFor, resolve as resolveImport } from "./appImports";
import { printStatements } from "./appLoader";
import { scriptConsole } from "./scriptConsole";
import { deviceConsole } from "./uiLog";

// Scripts are TypeScript but new Function only accepts JavaScript, so transpile
// first. Parse errors are thrown with line numbers pointing into the user's source.
// moduleDetection: Force keeps top-level await parseable even with no imports.
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

// Only named imports bind, because the bindings are looked up by name. A default or
// namespace clause would otherwise drop through and surface as "X is not defined"
// pointing at the use rather than at the import that never bound anything.
function requireNamedImport(importClause: ts.ImportClause | undefined, path: string, example: string): void {
  if (!importClause) return;
  const form = importClause.name
    ? "a default import"
    : importClause.namedBindings && ts.isNamespaceImport(importClause.namedBindings)
      ? "a namespace import"
      : undefined;
  if (!form) return;
  throw new Error(`Cannot resolve import "${path}": ${form} does not resolve. Use a named import: import { ${example} } from "${path}".`);
}

/**
 * What a script's body is handed beyond its imports: the run's console, and the run's
 * fetch. Both are parameters of the wrapper rather than globals, which is the whole of
 * how a script's own lines and calls are told from Kaja's — inside the body the name
 * resolves to the run's, and everywhere else to the real one, including in app code
 * this script calls into.
 *
 * A binding of the script's own wins: an import named `fetch` is a name the author
 * chose, and shadowing it here would be kaja taking a word it does not own.
 */
function runtimeBindings(kaja: Kaja, args: { [key: string]: Client | Object }, console: Console): { names: string[]; values: unknown[] } {
  const bindings: Array<[string, unknown]> = [["console", console]];
  if (!("fetch" in args)) bindings.push(["fetch", (input: RequestInfo | URL, init?: RequestInit) => kaja.fetch(input, init)]);
  return { names: bindings.map(([name]) => name), values: bindings.map(([, value]) => value) };
}

// prepareTask resolves a script's imports against the loaded apps and splits out the
// runnable body, returning the args every binding maps to plus the code.
function prepareTask(code: string, kaja: Kaja, apps: App[]): { args: { [key: string]: Client | Object }; runCode: string } {
  const file = ts.createSourceFile("task.js", transpile(code), ts.ScriptTarget.Latest);
  const args: { [key: string]: Client | Object } = {};
  const runStatements: ts.Statement[] = [];

  file.statements.forEach((statement) => {
    // moduleDetection: Force can make the transpiler emit a bare `export {};`, which new
    // Function would reject.
    if (ts.isExportDeclaration(statement)) {
      return;
    }
    if (ts.isImportDeclaration(statement)) {
      // slice(1, -1) removes the quotes.
      const path = statement.moduleSpecifier.getText(file).slice(1, -1);
      // Monaco backs the kaja module with a model at ts:/kaja.ts, so its auto-import and
      // go-to-definition can emit the relative "./kaja" form.
      if (path === "kaja" || path === "./kaja") {
        requireNamedImport(statement.importClause, path, "kaja");
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
      const app = appFor(apps, path);
      if (!app) {
        // A silent drop here surfaces later as an opaque "X is not defined" when the body
        // uses the binding; name the unresolved app instead.
        throw new Error(`Cannot resolve import "${path}": app "${path.split("/")[0]}" was not found (it may have been deleted).`);
      }

      requireNamedImport(statement.importClause, path, app.services[0]?.name ?? "Service");

      const importClause = statement.importClause;
      if (importClause && importClause.namedBindings && ts.isNamedImports(importClause.namedBindings)) {
        importClause.namedBindings.elements.forEach((importSpecifier) => {
          const alias = importSpecifier.name.text;
          const name = importSpecifier.propertyName ? importSpecifier.propertyName.text : alias;
          // Resolved per name rather than per statement: the app's bare name is answered
          // by whichever of its modules declares the name, so one import line may reach
          // into two of them.
          const resolution = resolveImport(app, path, name);
          if ("unknownPath" in resolution) {
            throw new Error(`Cannot resolve import "${path}" in app "${app.configuration.name}".`);
          }
          if ("ambiguous" in resolution) {
            const paths = resolution.ambiguous.map((s) => `"${s.importPath}"`).join(" and ");
            throw new Error(`Cannot resolve "${name}" from "${path}": app "${app.configuration.name}" declares it in ${paths}. Import it from one of those.`);
          }
          // An interface a script imports for its type has nothing to bind at run time.
          if ("absent" in resolution) return;
          const source = resolution.source;
          // Matched on source path too, to handle duplicate service names.
          const service = app.services.find((s) => s.name === name && s.sourcePath === source.importPath);
          if (service) {
            const client = app.clients[serviceId(service)];
            // Bound to this run's Kaja, not assigned onto the shared client: two scripts running
            // at once import the same client and must not be able to take each other's run out
            // from under it.
            if (client) args[alias] = client.methodsFor(kaja);
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

// runScript resolves once the script settles, so the caller can show it as running.
// A signal lets the caller abort the calls it makes.
export function runScript(code: string, kaja: Kaja, apps: App[], onError: (error: unknown) => void, signal?: AbortSignal): Promise<void> {
  // The Kaja is this run's, so its approvals and its signal are born and die with it.
  // Clearing them here used to be the only guard, and it revoked whatever another run in
  // flight had been granted.
  kaja._internal.abortSignal = signal;

  let result: any;
  try {
    const { args, runCode } = prepareTask(code, kaja, apps);

    // Wrapped in an async function so `await` can be used at the top level.
    const runtime = runtimeBindings(kaja, args, scriptConsole(kaja._internal.onLog, deviceConsole));
    const func = new Function(
      ...Object.keys(args),
      ...runtime.names,
      `
      return (async function() {
        ${runCode}
      })();
    `,
    );

    result = func(...Object.values(args), ...runtime.values);
  } catch (err) {
    onError(err);
    return Promise.resolve();
  }
  return Promise.resolve(result).then(
    () => {},
    (err: unknown) => {
      // A cancelled prompt, a call that wasn't approved, or an aborted run simply stops the
      // script; surface everything else.
      if (err instanceof AskCancelledError || err instanceof ApprovalRejectedError || signal?.aborted) return;
      onError(err);
    },
  );
}

export interface CapturedRun {
  console: string[];
  result?: unknown;
  error?: string;
}

// runScriptCaptured collects a script's console output, return value and any error
// instead of letting them escape. Used by the MCP server.
export async function runScriptCaptured(code: string, kaja: Kaja, apps: App[]): Promise<CapturedRun> {
  const lines: string[] = [];
  // The same console the editor's Run installs, teed into the report: an agent's
  // snippet runs in the agent's draft, so its lines belong in that draft's console as
  // well as in the answer.
  const captureConsole = scriptConsole((level, message) => {
    lines.push(message);
    kaja._internal.onLog(level, message);
  }, deviceConsole);

  try {
    const { args, runCode } = prepareTask(code, kaja, apps);
    const runtime = runtimeBindings(kaja, args, captureConsole);
    const func = new Function(
      ...Object.keys(args),
      ...runtime.names,
      `
      return (async function() {
        ${runCode}
      })();
    `,
    );

    const result = await func(...Object.values(args), ...runtime.values);
    return { console: lines, result };
  } catch (err) {
    if (err instanceof AskCancelledError) {
      return { console: lines, error: "Script cancelled by user." };
    }
    if (err instanceof ApprovalRejectedError) {
      return { console: lines, error: `Script stopped: ${err.message}.` };
    }
    return { console: lines, error: err instanceof Error ? err.message : String(err) };
  }
}
