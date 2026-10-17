// Holds one test's output against protoc-gen-ts's. What has to agree is what the
// runtime reads: every message's field descriptors, every enum, every service. The
// manifest is read through the UI's own builder and the TypeScript modules are
// imported, so both shapes are checked the way they are used.
//
//   bun compare.ts <result dir>
//
// The result dir holds expected/ (protoc-gen-ts), manifest/kaja.manifest.json and
// typescript/ (protoc-gen-kaja). It writes editor/ and tsconfig.json beside them, for
// the type check that follows.

import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { buildReflection } from "../../ui/src/protoReflection";
import type { Manifest } from "../../ui/src/sources";

const resultDir = process.argv[2];
const problems: string[] = [];

function files(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true })
    .map((name) => join(dir, String(name)))
    .filter((path) => path.endsWith(".ts") && statSync(path).isFile());
}

interface Types {
  messages: Map<string, any>;
  services: Map<string, any>;
}

async function importTypes(dir: string, keep: (path: string) => boolean): Promise<Types> {
  const types: Types = { messages: new Map(), services: new Map() };
  for (const path of files(dir).filter(keep)) {
    const module = await import(path);
    for (const value of Object.values(module)) {
      const type = value as any;
      if (!type || typeof type !== "object" || typeof type.typeName !== "string") continue;
      if (Array.isArray(type.fields)) types.messages.set(type.typeName, type);
      else if (Array.isArray(type.methods)) types.services.set(type.typeName, type);
    }
  }
  return types;
}

function describeEnum(info: any) {
  const [typeName, object, prefix] = info;
  return { typeName, prefix, entries: Object.entries(object).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)) };
}

function emptyToUndefined(options: any) {
  return options && Object.keys(options).length > 0 ? options : undefined;
}

function describeField(field: any) {
  const out: any = {
    no: field.no,
    name: field.name,
    kind: field.kind,
    localName: field.localName,
    jsonName: field.jsonName,
    oneof: field.oneof,
    opt: field.opt,
    repeat: field.repeat,
    L: field.L,
    options: emptyToUndefined(field.options),
  };
  switch (field.kind) {
    case "scalar":
      out.T = field.T;
      break;
    case "message":
      out.T = field.T().typeName;
      break;
    case "enum":
      out.T = describeEnum(field.T());
      break;
    case "map":
      out.K = field.K;
      out.V =
        field.V.kind === "scalar"
          ? { kind: "scalar", T: field.V.T, L: field.V.L }
          : field.V.kind === "message"
            ? { kind: "message", T: field.V.T().typeName }
            : { kind: "enum", T: describeEnum(field.V.T()) };
      break;
  }
  return out;
}

function describeMessage(type: any) {
  return { fields: type.fields.map(describeField), options: emptyToUndefined(type.options) };
}

function describeService(type: any) {
  return {
    options: emptyToUndefined(type.options),
    methods: type.methods.map((method: any) => ({
      name: method.name,
      localName: method.localName,
      idempotency: method.idempotency,
      serverStreaming: method.serverStreaming,
      clientStreaming: method.clientStreaming,
      options: emptyToUndefined(method.options),
      I: method.I.typeName,
      O: method.O.typeName,
    })),
  };
}

function normalize(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

function compare(what: string, expected: Types, actual: Types) {
  for (const [kind, describe] of [
    ["messages", describeMessage],
    ["services", describeService],
  ] as const) {
    for (const [typeName, expectedType] of expected[kind]) {
      const actualType = actual[kind].get(typeName);
      // protoc-gen-ts writes out a well-known file whole once any of it is used; Kaja
      // generates the types something reaches.
      if (!actualType && typeName.startsWith("google.protobuf.")) continue;
      if (!actualType) {
        problems.push(`${what}: no ${kind === "messages" ? "message" : "service"} ${typeName}`);
        continue;
      }
      const want = normalize(describe(expectedType));
      const got = normalize(describe(actualType));
      if (!Bun.deepEquals(want, got)) {
        problems.push(`${what}: ${typeName} differs\n  expected ${JSON.stringify(want)}\n  actual   ${JSON.stringify(got)}`);
      }
    }
  }
}

const manifestPath = join(resultDir, "manifest", "kaja.manifest.json");
const manifest: Manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const reflection = buildReflection(manifest.modules);
const fromManifest: Types = { messages: reflection.messages, services: reflection.services };
const fromTypescript = await importTypes(join(resultDir, "typescript"), () => true);

// protoc-gen-ts's own client and server files say nothing the runtime reads.
const expectedDir = join(resultDir, "expected");
if (existsSync(expectedDir)) {
  const expected = await importTypes(expectedDir, (path) => !/\.(client|server|grpc-server|grpc-client)\.ts$/.test(path));
  compare("manifest", expected, fromManifest);
  compare("typescript", expected, fromTypescript);
}

// The editor's modules, beside a stand-in for the kaja module they import from.
const editorDir = join(resultDir, "editor");
for (const module of manifest.modules) {
  const path = join(editorDir, module.path);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, module.editorText);
}
mkdirSync(editorDir, { recursive: true });
writeFileSync(
  join(editorDir, "kaja.ts"),
  "export type Input<T> = { [K in keyof T]?: unknown };\nexport interface Call<T> extends PromiseLike<T> {}\nexport interface CallOptions { headers?: { [name: string]: string } }\n",
);
writeFileSync(
  join(resultDir, "tsconfig.json"),
  JSON.stringify({
    compilerOptions: {
      strict: true,
      noEmit: true,
      target: "ESNext",
      module: "ESNext",
      moduleResolution: "bundler",
      moduleDetection: "force",
      skipLibCheck: true,
      isolatedModules: true,
      types: [],
      paths: { kaja: ["./editor/kaja.ts"] },
    },
    include: ["editor/**/*.ts", "typescript/**/*.ts"],
  }),
);

if (problems.length > 0) {
  console.log(problems.join("\n"));
  process.exit(1);
}
