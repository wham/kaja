import { describe, expect, test } from "bun:test";
import { hintPending, parseHints } from "./agentHints";

describe("parseHints", () => {
  test("reads a hint the person has to act on apart from one that explains", () => {
    const encoded = JSON.stringify({ base_url: { text: "Your tenant.", needs_user: true }, username: { text: "The API key." } });
    expect(parseHints(encoded)).toEqual({ base_url: { text: "Your tenant.", needsUser: true }, username: { text: "The API key.", needsUser: false } });
  });

  test("reads a bare string as an aside", () => {
    expect(parseHints(JSON.stringify({ token: " From the dashboard. " }))).toEqual({ token: { text: "From the dashboard.", needsUser: false } });
  });

  test("leaves out what has nothing to say", () => {
    expect(parseHints(JSON.stringify({ a: "", b: 7, c: { needs_user: true }, d: { text: "  " } }))).toEqual({});
    expect(parseHints("[1]")).toEqual({});
    expect(parseHints("not json")).toEqual({});
    expect(parseHints(null)).toEqual({});
  });
});

describe("hintPending", () => {
  const asks = { text: "Your tenant.", needsUser: true };

  test("waits while the field is empty", () => {
    expect(hintPending(asks, undefined)).toBe(true);
    expect(hintPending(asks, " ")).toBe(true);
  });

  test("waits while the agent's placeholder is still in the value", () => {
    expect(hintPending(asks, "https://<tenant>.example.com/api")).toBe(true);
    expect(hintPending(asks, "https://acme.example.com/api")).toBe(false);
  });

  test("never waits on an aside", () => {
    expect(hintPending({ text: "Set already.", needsUser: false }, "")).toBe(false);
  });
});
