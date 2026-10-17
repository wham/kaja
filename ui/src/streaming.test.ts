import { describe, expect, it, test } from "bun:test";
import { generateMethodEditorCode, loadApp } from "./appLoader";
import type { Manifest } from "./sources";
import { streamingKind, unsupportedReason } from "./streaming";

// createClients reads window.location for the base URL; provide it as the browser would.
(globalThis as any).window = { location: { href: "http://localhost/" } };

test("streamingKind reads the direction off the flags", () => {
  expect(streamingKind({})).toBeUndefined();
  expect(streamingKind({ serverStreaming: true })).toBe("server");
  expect(streamingKind({ clientStreaming: true })).toBe("client");
  expect(streamingKind({ serverStreaming: true, clientStreaming: true })).toBe("bidirectional");
});

test("only a stream from the client is refused, and the reason names its kind", () => {
  expect(unsupportedReason({})).toBeUndefined();
  expect(unsupportedReason({ serverStreaming: true })).toBeUndefined();
  expect(unsupportedReason({ clientStreaming: true })).toBe("Client streaming is not supported by Kaja yet.");
  expect(unsupportedReason({ serverStreaming: true, clientStreaming: true })).toBe("Bidirectional streaming is not supported by Kaja yet.");
});

// A gRPC app is the only one whose calls are forwarded, so it is the only one a
// stream can come back through. Everywhere else the limit is the app's own, which is
// why it is said without a "yet" and covers the kind Kaja does support.
test("an app that cannot stream at all says so, for every kind", () => {
  expect(unsupportedReason({}, "twirp")).toBeUndefined();
  expect(unsupportedReason({ serverStreaming: true }, "twirp")).toBe("Twirp has no streaming.");
  expect(unsupportedReason({ clientStreaming: true }, "twirp")).toBe("Twirp has no streaming.");
  expect(unsupportedReason({ serverStreaming: true, clientStreaming: true }, "twirp")).toBe("Twirp has no streaming.");
  expect(unsupportedReason({ serverStreaming: true }, "grpc")).toBeUndefined();
  expect(unsupportedReason({ clientStreaming: true }, "grpc")).toBe("Client streaming is not supported by Kaja yet.");
});

// A service with one method of each kind Kaja can meet.
const empty = (name: string) => ({ name, typeName: `demo.${name}`, fields: [] });

const manifest: Manifest = {
  version: 2,
  modules: [
    {
      path: "proto/numbers.ts",
      editorText: "",
      messages: ["SumRequest", "SumResponse", "TickRequest", "Tick", "UploadRequest", "UploadResponse"].map(empty),
      enums: [],
      services: [
        {
          name: "Numbers",
          typeName: "demo.Numbers",
          methods: [
            { name: "Sum", input: "SumRequest", output: "SumResponse", I: "demo.SumRequest", O: "demo.SumResponse" },
            { name: "Tick", input: "TickRequest", output: "Tick", I: "demo.TickRequest", O: "demo.Tick", serverStreaming: true },
            { name: "Upload", input: "UploadRequest", output: "UploadResponse", I: "demo.UploadRequest", O: "demo.UploadResponse", clientStreaming: true },
          ],
        },
      ],
      declarations: [],
    },
  ],
};

async function numbersApp() {
  return loadApp(manifest, { name: "demo", app: { oneofKind: "grpc" } } as any);
}

describe("a method that streams from the client", () => {
  it("keeps the call in the generated code, under the sentence saying whose decision it is", async () => {
    const app = await numbersApp();
    const service = app.services.find((s) => s.name === "Numbers")!;
    const upload = service.methods.find((m) => m.name === "Upload")!;

    const code = generateMethodEditorCode(app, service, upload);
    expect(code).toContain("// Client streaming is not supported by Kaja yet.");
    expect(code).toContain("Numbers.Upload(");
    // The comment sits over the call, not at the top of the file above the import.
    expect(code.indexOf("// Client streaming")).toBeGreaterThan(code.indexOf("import"));
  });

  it("leaves a callable method's code alone", async () => {
    const app = await numbersApp();
    const service = app.services.find((s) => s.name === "Numbers")!;

    for (const name of ["Sum", "Tick"]) {
      const code = generateMethodEditorCode(
        app,
        service,
        service.methods.find((m) => m.name === name)!,
      );
      expect(code).not.toContain("not supported by Kaja");
      expect(code).toContain(`Numbers.${name}(`);
    }
  });
});

describe("a method that streams from the server", () => {
  it("is typed by the message it hands back rather than as unknown", async () => {
    const app = await numbersApp();
    const service = app.services.find((s) => s.name === "Numbers")!;

    expect(service.methods.find((m) => m.name === "Tick")!.output).toBe("Tick");
  });
});
