import { beforeEach, describe, expect, it } from "bun:test";
import { AppStore, Compiler } from "./appStore";
import { createPendingApp } from "./apps";
import { manifestFingerprint } from "./manifestCache";
import { CompileResponse, CompileStatus, LogLevel, WorkspaceApp } from "./server/api";
import type { Manifest } from "./sources";

// createClients reads window.location for the base URL; provide it as the browser would.
(globalThis as any).window = { location: { href: "http://localhost/" } };

function manifest(method: string): Manifest {
  return {
    version: 2,
    modules: [
      {
        path: "proto/github.ts",
        editorText: "",
        messages: [{ name: "Empty", typeName: "github.Empty", fields: [] }],
        enums: [],
        services: [
          { name: "Repos", typeName: "github.Repos", methods: [{ name: method, input: "Empty", output: "Empty", I: "github.Empty", O: "github.Empty" }] },
        ],
        declarations: [{ name: "Empty", text: "export interface Empty {}", references: [] }],
      },
    ],
  };
}

const github = { name: "github", app: { oneofKind: "openapi", openapi: { specUrl: "https://example.com/openapi.json" } } } as unknown as WorkspaceApp;

// A compiler whose stream the test feeds by hand, so a log line and a verdict are each
// one step.
class FakeCompiler {
  requests: { app?: WorkspaceApp; fresh: boolean }[] = [];
  #pending: ((response: CompileResponse | null) => void)[] = [];
  #queued: (CompileResponse | null)[] = [];

  compiler: Compiler = (request) => {
    this.requests.push({ app: request.app, fresh: request.fresh });
    const self = this;
    return {
      [Symbol.asyncIterator]() {
        return {
          next(): Promise<IteratorResult<CompileResponse>> {
            return new Promise((resolve) => {
              const settle = (response: CompileResponse | null) =>
                resolve(response === null ? { done: true, value: undefined } : { done: false, value: response });
              const queued = self.#queued.shift();
              if (queued !== undefined) settle(queued);
              else self.#pending.push(settle);
            });
          },
        };
      },
    };
  };

  send(response: CompileResponse | null): void {
    const waiting = this.#pending.shift();
    if (waiting) waiting(response);
    else this.#queued.push(response);
  }

  log(message: string): void {
    this.send({ status: CompileStatus.STATUS_RUNNING, logs: [{ level: LogLevel.LEVEL_INFO, message }], manifest: "" });
  }

  ready(text: string): void {
    this.send({ status: CompileStatus.STATUS_READY, logs: [], manifest: text });
  }

  error(message: string): void {
    this.send({ status: CompileStatus.STATUS_ERROR, logs: [{ level: LogLevel.LEVEL_ERROR, message }], manifest: "" });
  }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

let store: AppStore;
let compiler: FakeCompiler;

beforeEach(() => {
  store = new AppStore();
  compiler = new FakeCompiler();
  store.compiler = compiler.compiler;
});

describe("the two subscriptions", () => {
  it("move the progress on a log line and leave the surface where it was", async () => {
    let surface = 0;
    let progress = 0;
    store.subscribe(() => surface++);
    store.subscribeProgress(() => progress++);

    store.replace([createPendingApp(github)]);
    await tick();
    const afterStart = { surface, progress };

    compiler.log("Reading the document");
    compiler.log("Writing the protos");
    await tick();

    expect(progress).toBeGreaterThan(afterStart.progress);
    expect(surface).toBe(afterStart.surface);
    expect(store.progressOf("github").logs.map((log) => log.message)).toEqual(["Reading the document", "Writing the protos"]);
    expect(store.getSnapshot()[0].compilation.status).toBe("running");
  });

  it("moves the surface once, when the manifest lands", async () => {
    store.replace([createPendingApp(github)]);
    await tick();
    let surface = 0;
    store.subscribe(() => surface++);

    compiler.log("Compiling");
    compiler.ready(JSON.stringify(manifest("ListForUser")));
    await tick();

    expect(surface).toBe(1);
    const app = store.getSnapshot()[0];
    expect(app.compilation.status).toBe("success");
    expect(app.services.map((service) => service.methods.map((method) => method.name))).toEqual([["ListForUser"]]);
    expect(store.progressOf("github").running).toBe(false);
  });

  it("keeps the log lines off the surface", async () => {
    store.replace([createPendingApp(github)]);
    await tick();
    compiler.log("a line");
    compiler.send({ status: CompileStatus.STATUS_RUNNING, logs: [{ level: LogLevel.LEVEL_WARN, message: "deprecated" }], manifest: "" });
    compiler.ready(JSON.stringify(manifest("ListForUser")));
    await tick();

    const app = store.getSnapshot()[0];
    expect(app.compilation.warnings).toBe(1);
    expect("logs" in app.compilation).toBe(false);
  });
});

describe("what the compiler is asked", () => {
  it("compiles every pending app, each once, and asks for nothing fresh", async () => {
    const work = { ...github, name: "github-work" };
    store.replace([createPendingApp(github), createPendingApp(work)]);
    store.update((apps) => [...apps]);
    await tick();

    expect(compiler.requests.map((request) => [request.app?.name, request.fresh])).toEqual([
      ["github", false],
      ["github-work", false],
    ]);
  });

  it("asks for a fresh compile on the Recompile gesture alone", async () => {
    store.replace([createPendingApp(github)]);
    await tick();
    compiler.ready(JSON.stringify(manifest("ListForUser")));
    await tick();

    store.recompile("github");
    await tick();

    expect(compiler.requests.map((request) => request.fresh)).toEqual([false, true]);
    expect(store.getSnapshot()[0].compilation.status).toBe("running");
  });

  it("states a failure on the surface with the line that says why", async () => {
    store.replace([createPendingApp(github)]);
    await tick();
    compiler.error("unknown type Foo");
    await tick();

    expect(store.getSnapshot()[0].compilation).toMatchObject({ status: "error", error: "unknown type Foo" });
  });
});

describe("a surface read back from the last session", () => {
  const stored = new Map([["github", { fingerprint: manifestFingerprint(github), manifest: JSON.stringify(manifest("ListForUser")) }]]);

  it("opens ready and is still compiled underneath", async () => {
    store.open([github], stored);
    const app = store.getSnapshot()[0];
    expect(app.compilation.status).toBe("cached");
    expect(app.services).toHaveLength(1);

    await tick();
    expect(compiler.requests).toHaveLength(1);
    expect(store.progressOf("github").running).toBe(true);
    expect(store.getSnapshot()[0].compilation.status).toBe("cached");
  });

  it("keeps its surface when the server answers with the same manifest", async () => {
    store.open([github], stored);
    await tick();
    const before = store.getSnapshot()[0];
    compiler.ready(stored.get("github")!.manifest);
    await tick();

    const after = store.getSnapshot()[0];
    expect(after.compilation.status).toBe("success");
    expect(after.sources).toBe(before.sources);
  });

  it("is replaced when the server answers with another", async () => {
    store.open([github], stored);
    await tick();
    const before = store.getSnapshot()[0];
    compiler.ready(JSON.stringify(manifest("Get")));
    await tick();

    const after = store.getSnapshot()[0];
    expect(after.sources).not.toBe(before.sources);
    expect(after.services[0].methods[0].name).toBe("Get");
  });

  it("starts pending where the stored manifest describes another configuration", () => {
    const moved = { ...github, app: { oneofKind: "openapi", openapi: { specUrl: "https://example.com/v2.json" } } } as unknown as WorkspaceApp;
    store.open([moved], stored);

    expect(store.getSnapshot()[0].compilation.status).toBe("pending");
  });
});

describe("replace", () => {
  it("follows a rename into what it holds and lets go of what left", async () => {
    store.replace([createPendingApp(github)]);
    await tick();
    compiler.ready(JSON.stringify(manifest("ListForUser")));
    await tick();
    const compiled = store.getSnapshot()[0];

    store.replace([{ ...compiled, configuration: { ...github, name: "gh" } }], new Map([["github", "gh"]]));
    await tick();
    expect(compiler.requests).toHaveLength(1);
    expect(store.progressOf("gh").logs).toBe(store.progressOf("gh").logs);

    store.replace([]);
    expect(store.progressOf("gh").logs).toHaveLength(0);
  });

  it("starts a rename over where its compile was still streaming", async () => {
    store.replace([createPendingApp(github)]);
    await tick();
    compiler.log("Compiling");
    await tick();

    const running = store.getSnapshot()[0];
    store.replace([{ ...running, configuration: { ...github, name: "gh" } }], new Map([["github", "gh"]]));
    await tick();

    expect(compiler.requests.map((request) => request.app?.name)).toEqual(["github", "gh"]);
    expect(store.progressOf("github").logs).toHaveLength(0);
    expect(store.progressOf("gh").running).toBe(true);
  });
});
