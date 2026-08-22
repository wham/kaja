import { Client, createAppRef, Method, Service, transportFromProtocol } from "../apps";
import { createClient } from "../client";
import { ApprovalRejectedError, AskCancelledError, Kaja } from "../kaja";
import { deviceConsole } from "../uiLog";
import { scriptConsole } from "../scriptConsole";
import { appConfiguration, BundleImport, LoadedBundle } from "./bundle";

/**
 * What a name in the script's import list turned out to be: a service's client,
 * which is bound to each run, or an enum, which is a value and belongs to none.
 */
type Binding = { alias: string; client: Client } | { alias: string; value: unknown };

/**
 * An exported script is bound rather than parsed.
 *
 * Kaja resolves a script's imports on every run by walking its TypeScript. The
 * export did that once, so what arrives here is a list of names and where each
 * lives in the stub — and the player carries no compiler at all, which is most
 * of why it is a twentieth of the size of the app it came from.
 *
 * What a name *is* is still read from the stub rather than from the manifest: a
 * generated service is a ServiceType and carries its own methods, and an enum is
 * a plain object. Asking the code is what keeps a manifest from being able to
 * disagree with the module it describes.
 *
 * The clients are built once, here, and bound per run below — the same rule the
 * app follows, and for the same reason: a client is the app's, and only the
 * methods hanging off it are a run's.
 */
export function resolveBindings(loaded: LoadedBundle): Binding[] {
  const bindings: Binding[] = [];

  for (const entry of loaded.state.manifest.imports) {
    if (entry.module === "kaja") continue;

    const exported = readExport(loaded, entry);
    if (exported === undefined) continue;

    if (isServiceType(exported)) {
      const app = loaded.state.manifest.apps.find((app) => app.name === entry.app);
      const runner = loaded.state.apps.find((app) => app.name === entry.app);
      if (!app) continue;
      const appRef = createAppRef(appConfiguration(app), runner?.target ?? "", transportFromProtocol(runner?.protocol ?? "grpc"));
      bindings.push({ alias: entry.alias, client: createClient(serviceOf(exported, entry), loaded.stub, appRef) });
    } else {
      bindings.push({ alias: entry.alias, value: exported });
    }
  }

  return bindings;
}

/**
 * The arguments one run's script body is called with. A client's methods are
 * bound to this run's `Kaja` rather than assigned onto the client, so two runs
 * can never take each other's out from under it.
 */
function argumentsFor(loaded: LoadedBundle, bindings: Binding[], kaja: Kaja): { [name: string]: unknown } {
  const args: { [name: string]: unknown } = {};
  for (const entry of loaded.state.manifest.imports) {
    if (entry.module === "kaja") args[entry.alias] = kaja;
  }
  for (const binding of bindings) {
    args[binding.alias] = "client" in binding ? binding.client.methodsFor(kaja) : binding.value;
  }
  return args;
}

function readExport(loaded: LoadedBundle, entry: BundleImport): any {
  const module = loaded.stub[entry.module];
  if (!module) {
    throw new Error(`This app was exported without the module "${entry.module}" — export it again.`);
  }
  return module[entry.name];
}

/**
 * A generated service object states its own methods and its fully qualified
 * name, which is everything a client needs and the only place either is written
 * down.
 */
function isServiceType(value: any): boolean {
  return !!value && typeof value === "object" && Array.isArray(value.methods) && typeof value.typeName === "string";
}

function serviceOf(serviceType: any, entry: BundleImport): Service {
  const typeName: string = serviceType.typeName;
  const lastDot = typeName.lastIndexOf(".");
  const methods: Method[] = serviceType.methods.map((method: any) => ({
    name: method.name,
    serverStreaming: method.serverStreaming,
    clientStreaming: method.clientStreaming,
  }));

  return {
    name: entry.name,
    packageName: lastDot > 0 ? typeName.substring(0, lastDot) : "",
    sourcePath: entry.module,
    clientStubModuleId: entry.clientModule ?? "",
    methods,
  };
}

/**
 * Run the script. It is the same shape kaja's own runner uses — the body in an
 * async function, `console` a parameter of it so the run's log lines are the
 * script's own — minus the transpile and the import walk, which happened at
 * export. The approvals and the signal are this run's because the `Kaja` is.
 */
export function runBundledScript(
  loaded: LoadedBundle,
  bindings: Binding[],
  kaja: Kaja,
  onError: (error: unknown) => void,
  signal?: AbortSignal,
): Promise<void> {
  kaja._internal.abortSignal = signal;

  let result: unknown;
  try {
    const args = argumentsFor(loaded, bindings, kaja);
    const func = new Function(
      ...Object.keys(args),
      "console",
      `
      return (async function() {
        ${loaded.script}
      })();
    `,
    );
    result = func(...Object.values(args), scriptConsole(kaja._internal.onLog, deviceConsole));
  } catch (error) {
    onError(error);
    return Promise.resolve();
  }

  return Promise.resolve(result).then(
    () => {},
    (error: unknown) => {
      if (error instanceof AskCancelledError || error instanceof ApprovalRejectedError || signal?.aborted) return;
      onError(error);
    },
  );
}
