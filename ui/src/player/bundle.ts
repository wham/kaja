import { ConfigurationApp } from "../server/api";

/**
 * The manifest as the exporter writes it (server/pkg/bundle/manifest.go). It is
 * the one thing both sides of an exported app agree on, so it is declared here
 * and nowhere else in the player.
 */
export interface BundleManifest {
  formatVersion: number;
  kajaVersion?: string;
  name: string;
  title?: string;
  source?: string;
  apps: BundleApp[];
  imports: BundleImport[];
  variables?: BundleVariable[];
  runOnLoad: boolean;
}

export interface BundleApp {
  name: string;
  type: string;
  configuration: Record<string, unknown>;
  protoDir?: string;
  frozen: boolean;
}

export interface BundleImport {
  alias: string;
  name: string;
  app?: string;
  module: string;
  clientModule?: string;
}

export interface BundleVariable {
  name: string;
  source: "file" | "secret" | "environment";
  value?: string;
  env?: string;
  used?: boolean;
}

/**
 * What the runner adds to the manifest at startup: where each app ended up
 * being invocable. An in-process app's target is a `kaja-app://<id>` the manager
 * allocates when it opens the app, so it cannot be in the bundle — it is a fact
 * about this run of it.
 */
export interface RunnerApp {
  name: string;
  target: string;
  protocol: string;
  /** The app failed to open, and every call to it will say so. */
  error?: string;
}

export interface RunnerState {
  manifest: BundleManifest;
  apps: RunnerApp[];
  /**
   * A variable the exported app was told to read from the environment and found
   * nothing in. The player states them rather than letting every call fail with
   * an unexplained 401.
   */
  missingVariables: string[];
  /**
   * Variable values the script reads as `kaja.variables.<name>`. The runner
   * sends them only when it is bound to the loopback address: everywhere else
   * the browser is somebody else's, which is the same rule the web server
   * follows.
   */
  variables: Record<string, string>;
}

export interface LoadedBundle {
  state: RunnerState;
  /** The transpiled script — statements, not a module. */
  script: string;
  /** The generated client code for every app, as one ES module. */
  stub: Record<string, any>;
}

/** The app configuration a bundle carries, as the client reads it. */
export function appConfiguration(app: BundleApp): ConfigurationApp {
  return ConfigurationApp.fromJson(app.configuration as any, { ignoreUnknownFields: true });
}

export async function loadBundle(): Promise<LoadedBundle> {
  const [state, script, stubCode] = await Promise.all([
    fetchJson<RunnerState>("bundle/state.json"),
    fetchText("bundle/script.js"),
    fetchText("bundle/stub.js"),
  ]);

  // The stub is an ES module built at export time. It is imported rather than
  // evaluated so its own imports resolve — @protobuf-ts is left external by the
  // build and mapped to the player by the import map, which is the same
  // arrangement kaja itself uses.
  const url = URL.createObjectURL(new Blob([stubCode], { type: "application/javascript" }));
  try {
    const stub = await import(/* @vite-ignore */ url);
    return { state, script, stub };
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`${path}: ${response.status} ${response.statusText}`);
  return (await response.json()) as T;
}

async function fetchText(path: string): Promise<string> {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`${path}: ${response.status} ${response.statusText}`);
  return await response.text();
}
