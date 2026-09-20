import { MessageType, ScalarType } from "@protobuf-ts/runtime";
import { expect, test } from "bun:test";
import { readEmbedded, spliceEmbedded } from "./embeddedJson";

test("reads an object and an array out of a string", () => {
  expect(readEmbedded('{"issues":[{"number":220}]}')).toEqual({ issues: [{ number: 220 }] });
  expect(readEmbedded(" [1, 2] ")).toEqual([1, 2]);
});

// The gate is what keeps the reading from inventing values. Each of these parses.
test("leaves a string that is not a document alone", () => {
  expect(readEmbedded("123")).toBeUndefined();
  expect(readEmbedded("true")).toBeUndefined();
  expect(readEmbedded("null")).toBeUndefined();
  expect(readEmbedded('"quoted"')).toBeUndefined();
  expect(readEmbedded("")).toBeUndefined();
});

test("leaves prose and half a document alone", () => {
  expect(readEmbedded("The tool ran and found nothing.")).toBeUndefined();
  expect(readEmbedded('{"issues": [')).toBeUndefined();
});

// What an MCP tool that declares no output schema answers with.
test("reads the document a content block carries", () => {
  const result = { content: [{ type: "text", text: '{"issues":[{"number":220}]}' }], isError: false };

  expect(spliceEmbedded(result)).toEqual({
    value: { content: [{ type: "text", text: { issues: [{ number: 220 }] } }], isError: false },
    found: true,
  });
});

test("says when there was nothing to read, and hands the payload back as it was", () => {
  const result = { content: [{ type: "text", text: "Nothing to report." }], isError: false };
  const read = spliceEmbedded(result);

  expect(read.found).toBe(false);
  expect(read.value).toBe(result);
});

// One guess is the whole of what is offered.
test("does not read a document inside a document", () => {
  expect(spliceEmbedded({ text: '{"inner":"{\\"deeper\\":1}"}' }).value).toEqual({ text: { inner: '{"deeper":1}' } });
});

test("hands back what it did not read", () => {
  const bytes = new Uint8Array([1, 2, 3]);
  const read = spliceEmbedded({ bytes, count: 7n, missing: null, text: '{"a":1}' });

  expect((read.value as any).bytes).toBe(bytes);
  expect((read.value as any).count).toBe(7n);
  expect((read.value as any).missing).toBeNull();
  expect((read.value as any).text).toEqual({ a: 1 });
});

test("reads a payload that is nothing but a string", () => {
  expect(spliceEmbedded('{"a":1}')).toEqual({ value: { a: 1 }, found: true });
});

// A response is a generated message rather than an object literal, which is the
// whole of what the pane is handed: a walk that stopped at the prototype found
// nothing to read in any call ever made.
test("reads the document a generated message carries", () => {
  const content = new MessageType<{ type: string; text: string }>("Content", [
    { no: 1, name: "type", kind: "scalar", T: ScalarType.STRING },
    { no: 2, name: "text", kind: "scalar", T: ScalarType.STRING },
  ]);
  const result = new MessageType<{ content: unknown[] }>("CallToolResult", [
    { no: 1, name: "content", kind: "message", repeat: 1, T: () => content },
  ]).create({ content: [content.create({ type: "text", text: '{"tag_name":"0.15.0"}' })] });

  const read = spliceEmbedded(result);

  expect(read.found).toBe(true);
  expect(read.value).toEqual({ content: [{ type: "text", text: { tag_name: "0.15.0" } }] });
});
