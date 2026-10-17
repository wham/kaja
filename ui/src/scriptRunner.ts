import type { ImportDeclaration } from "@babel/types";
import { ApprovalRejectedError, AskCancelledError, Kaja } from "./kaja";
import { Client, App, serviceId } from "./apps";
import { appFor, resolve as resolveImport } from "./appImports";
import { blank, Range, typeRanges } from "./eraseTypes";
import { scriptConsole } from "./scriptConsole";
import { scriptGlobals } from "./scriptGlobals";
import { parseScript } from "./scriptSyntax";
import { deviceConsole } from "./uiLog";

// Only named imports bind, because the bindings are looked up by name. A default or
// namespace clause would otherwise drop through and surface as "X is not defined"
// pointing at the use rather than at the import that never bound anything.
function requireNamedImport(statement: ImportDeclaration, path: string, example: string): void {
  const form = statement.specifiers.some((specifier) => specifier.type === "ImportDefaultSpecifier")
    ? "a default import"
    : statement.specifiers.some((specifier) => specifier.type === "ImportNamespaceSpecifier")
      ? "a namespace import"
      : undefined;
  if (!form) return;
  throw new Error(`Cannot resolve import "${path}": ${form} does not resolve. Use a named import: import { ${example} } from "${path}".`);
}

// prepareTask resolves a script's imports against the loaded apps and splits out the
// runnable body, returning the args every binding maps to plus the code.
function prepareTask(code: string, kaja: Kaja, apps: App[]): { args: { [key: string]: Client | Object }; runCode: string } {
  // What is wrong with a script that doesn't parse is the editor's to say, and an
  // agent's run carries the same diagnostics.
  const file = parseScript(code);
  if (!file) throw new Error("The script doesn't parse.");
  const args: { [key: string]: Client | Object } = {};
  // The imports are bound here rather than run, and an export has nowhere to go from
  // inside new Function, so both are erased along with the types.
  const erased: Range[] = typeRanges(file, code);

  for (const statement of file.program.body) {
    if (statement.type === "ExportAllDeclaration" || (statement.type === "ExportNamedDeclaration" && !statement.declaration)) {
      erased.push([statement.start!, statement.end!]);
      continue;
    }
    if (statement.type === "ExportNamedDeclaration") {
      erased.push([statement.start!, statement.declaration!.start!]);
      continue;
    }
    if (statement.type !== "ImportDeclaration") continue;
    erased.push([statement.start!, statement.end!]);
    if (statement.importKind === "type") continue;

    const path = statement.source.value;
    const named = statement.specifiers.flatMap((specifier) =>
      specifier.type === "ImportSpecifier" && specifier.importKind !== "type"
        ? [{ alias: specifier.local.name, name: specifier.imported.type === "Identifier" ? specifier.imported.name : specifier.imported.value }]
        : [],
    );
    // Monaco backs the kaja module with a model at ts:/kaja.ts, so its auto-import and
    // go-to-definition can emit the relative "./kaja" form.
    if (path === "kaja" || path === "./kaja") {
      requireNamedImport(statement, path, "kaja");
      for (const { alias, name } of named) {
        if (name === "kaja") args[alias] = kaja;
      }
      continue;
    }
    const app = appFor(apps, path);
    if (!app) {
      // A silent drop here surfaces later as an opaque "X is not defined" when the body
      // uses the binding; name the unresolved app instead.
      throw new Error(`Cannot resolve import "${path}": app "${path.split("/")[0]}" was not found (it may have been deleted).`);
    }

    requireNamedImport(statement, path, app.services[0]?.name ?? "Service");

    for (const { alias, name } of named) {
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
      if ("absent" in resolution) continue;
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
    }
  }

  return { args, runCode: blank(code, erased) };
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
    const runtime = scriptGlobals(kaja, scriptConsole(kaja._internal.onLog, deviceConsole), (name) => name in args);
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
    const runtime = scriptGlobals(kaja, captureConsole, (name) => name in args);
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
