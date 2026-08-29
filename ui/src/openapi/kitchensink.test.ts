import { describe, it, expect } from "bun:test";
import ts from "typescript";
import kitchensink from "./testdata/kitchensink.json";
import { Document, operations } from "./document";
import { declarations } from "./types";

// The same document server/pkg/apps/openapi is held to, read the other way round.
// It exercises the schema features an API actually uses, and the point of reading
// it here is that what comes out is TypeScript the editor will accept — so the
// test compiles it rather than matching it against a golden file.
const document = kitchensink as Document;

function compile(source: string): ts.Diagnostic[] {
  const file = ts.createSourceFile("emitted.ts", source, ts.ScriptTarget.ESNext, true);
  const host: ts.CompilerHost = {
    getSourceFile: (name) => (name === "emitted.ts" ? file : undefined),
    writeFile: () => {},
    getDefaultLibFileName: () => "lib.d.ts",
    getCurrentDirectory: () => "",
    getCanonicalFileName: (name) => name,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => "\n",
    fileExists: (name) => name === "emitted.ts",
    readFile: () => undefined,
  };
  const program = ts.createProgram(["emitted.ts"], { strict: true, noEmit: true, noLib: true, target: ts.ScriptTarget.ESNext }, host);
  return [...program.getSyntacticDiagnostics(file), ...program.getSemanticDiagnostics(file)];
}

describe("the kitchen sink, read in the browser", () => {
  const declared = declarations(document);
  const source = declared.map((declaration) => declaration.text).join("\n\n");

  it("emits TypeScript the compiler accepts", () => {
    const errors = compile(source).map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, " "));
    expect(errors).toEqual([]);
  });

  it("declares every schema the document does", () => {
    expect(declared.length).toBe(Object.keys(document.components?.schemas ?? {}).length);
  });

  it("finds every operation", () => {
    const found = operations(document).map((operation) => `${operation.verb} ${operation.path}`);
    expect(found.length).toBeGreaterThan(0);
    expect(found).toContain("GET /signals");
  });

  // Each of these is a shape the proto path had to flatten, and the reason the
  // reading moved: a script was being checked against protobuf's idea of the API.
  it("keeps a union a union instead of merging its variants", () => {
    expect(source).toContain("export type Gauge = GaugeFlat | GaugeTiered;");
  });

  it("keeps a body that is an array, with no envelope around it", () => {
    expect(source).toContain("export type IngestSignalsBody = Signal | Signal[];");
  });

  it("keeps a discriminant as the literal the document declared", () => {
    expect(source).toContain('kind: "flat";');
  });

  it("keeps a nullable scalar nullable", () => {
    expect(source).toContain("at?: string | null;");
  });

  it("keeps an enum's values, which proto3 could only put in a comment", () => {
    expect(source).toContain('export type IntervalEnum = "MINUTE" | "HOUR" | "DAY";');
  });

  it("keeps a free-form object as one rather than as a builder", () => {
    expect(source).toContain("data?: unknown;");
    expect(source).toContain("labels?: { [key: string]: string };");
  });

  it("says which fields the API insists on", () => {
    expect(source).toContain("id: string;");
    expect(source).toContain("reading?: number;");
  });
});
