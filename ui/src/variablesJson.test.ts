import { describe, expect, test } from "bun:test";
import { describeJsonError, describeJsonMarker, parseVariablesJson } from "./variablesJson";

describe("parseVariablesJson", () => {
  test("reads a flat map of strings", () => {
    expect(parseVariablesJson('{\n  "HOST": "example.com",\n  "TOKEN": "${secret}"\n}')).toEqual({
      variables: { HOST: "example.com", TOKEN: "${secret}" },
    });
  });

  test("reads an empty object", () => {
    expect(parseVariablesJson("{}")).toEqual({ variables: {} });
  });

  test("names the line the text stops parsing on", () => {
    const { error, variables } = parseVariablesJson('{\n  "HOST": "example.com",\n  "TOKEN":\n');
    expect(variables).toBeUndefined();
    expect(error).toStartWith("Line ");
  });

  test("rejects anything that isn't an object", () => {
    expect(parseVariablesJson("[]").error).toBe("The variables block is an object of names and values");
    expect(parseVariablesJson("null").error).toBe("The variables block is an object of names and values");
    expect(parseVariablesJson('"HOST"').error).toBe("The variables block is an object of names and values");
  });

  test("rejects a value that isn't a string", () => {
    expect(parseVariablesJson('{ "PORT": 8080 }').error).toBe("PORT must be a string");
  });
});

describe("describeJsonError", () => {
  test("counts the line back from the reported position", () => {
    const text = '{\n  "HOST": "example.com"\n  "TOKEN": "x"\n}';
    const message = describeJsonError(text, new SyntaxError("Expected ',' or '}' after property value in JSON at position 26"));
    expect(message).toBe("Line 3 — expected ',' or '}' after property value");
  });

  test("prefers a line the engine states itself", () => {
    const message = describeJsonError("{}", new SyntaxError("Expected property name or '}' in JSON at position 42 (line 4 column 3)"));
    expect(message).toBe("Line 4 — expected property name or '}'");
  });

  test("puts an unterminated document on its last line", () => {
    expect(describeJsonError('{\n  "HOST":\n', new SyntaxError("Unexpected end of JSON input"))).toBe("Line 3 — unexpected end of input");
  });

  test("reads WebKit's phrasing too", () => {
    expect(describeJsonError('{\n  "HOST":\n', new SyntaxError("JSON Parse error: Unexpected EOF"))).toBe("Line 3 — unexpected end of input");
    expect(describeJsonError("{]", new SyntaxError("JSON Parse error: Expected '}'"))).toBe("Expected '}'");
  });

  test("falls back to the engine's own words", () => {
    expect(describeJsonError("{}", new SyntaxError("Something went wrong"))).toBe("Something went wrong");
  });
});

describe("describeJsonMarker", () => {
  test("states the editor's diagnostic against its line", () => {
    expect(describeJsonMarker(4, "Expected comma or closing brace")).toBe("Line 4 — expected comma or closing brace");
  });

  test("drops a trailing full stop, since the bar adds its own sentence", () => {
    expect(describeJsonMarker(2, "String expected.")).toBe("Line 2 — string expected");
  });
});
