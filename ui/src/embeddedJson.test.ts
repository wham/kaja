import { MessageType, ScalarType } from "@protobuf-ts/runtime";
import { expect, test } from "bun:test";
import { printEmbedded, readEmbedded } from "./embeddedJson";
import { printJson } from "./payloadText";

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

const result = { content: [{ type: "text", text: '{"issues":[{"number":220}]}' }], isError: false };

// What an MCP tool that declares no output schema answers with: offered, not read.
test("draws the string as it was sent and marks where it is", () => {
  const printed = printEmbedded(result, new Set());

  expect(printed.text).toBe(printJson(result));
  expect(printed.marks).toEqual([{ key: "/content/0/text", open: false, from: expect.any(Number), to: expect.any(Number) }]);
  const [mark] = printed.marks;
  expect(printed.text.slice(mark.from, mark.to)).toBe(JSON.stringify(result.content[0].text));
});

test("opens a string it is asked to, indented where the string was", () => {
  const printed = printEmbedded(result, new Set(["/content/0/text"]));

  expect(printed.text).toBe(printJson({ content: [{ type: "text", text: { issues: [{ number: 220 }] } }], isError: false }));
  const [mark] = printed.marks;
  expect(mark.open).toBe(true);
  expect(printed.text.slice(mark.from, mark.to)).toBe(printJson({ issues: [{ number: 220 }] }).replaceAll("\n", "\n      "));
});

test("opens one string and leaves its neighbour as it was sent", () => {
  const printed = printEmbedded({ a: '{"x":1}', b: '{"y":2}' }, new Set(["/b"]));

  expect(printed.marks.map((mark) => [mark.key, mark.open])).toEqual([
    ["/a", false],
    ["/b", true],
  ]);
  expect(printed.text).toBe('{\n  "a": "{\\"x\\":1}",\n  "b": {\n    "y": 2\n  }\n}');
});

test("marks nothing where nothing is a document", () => {
  const plain = { content: [{ type: "text", text: "Nothing to report." }], count: 7n };

  expect(printEmbedded(plain, new Set())).toEqual({ text: printJson(plain), marks: [] });
});

// One guess is the whole of what is offered.
test("does not read a document inside a document", () => {
  const printed = printEmbedded({ text: '{"inner":"{\\"deeper\\":1}"}' }, new Set(["/text"]));

  expect(printed.marks.map((mark) => mark.key)).toEqual(["/text"]);
  expect(printed.text).toContain('"inner": "{\\"deeper\\":1}"');
});

test("keys a path by its prefix and escapes a slash in a field name", () => {
  expect(printEmbedded({ "a/b": '{"x":1}' }, new Set(), "response/2").marks[0].key).toBe("response/2/a~1b");
});

// A response is a generated message rather than an object literal, which is the
// whole of what the pane is handed: a walk that stopped at the prototype found
// nothing to read in any call ever made.
test("reads the document a generated message carries", () => {
  const content = new MessageType<{ type: string; text: string }>("Content", [
    { no: 1, name: "type", kind: "scalar", T: ScalarType.STRING },
    { no: 2, name: "text", kind: "scalar", T: ScalarType.STRING },
  ]);
  const message = new MessageType<{ content: unknown[] }>("CallToolResult", [{ no: 1, name: "content", kind: "message", repeat: 1, T: () => content }]).create({
    content: [content.create({ type: "text", text: '{"tag_name":"0.15.0"}' })],
  });

  expect(printEmbedded(message, new Set(["/content/0/text"])).text).toContain('"tag_name": "0.15.0"');
});
