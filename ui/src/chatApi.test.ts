import { describe, expect, it } from "bun:test";
import {
  API_ANTHROPIC,
  API_OPENAI,
  AUTH_APIKEY,
  AUTH_BEARER,
  AUTH_NONE,
  CHOICE_ANTHROPIC,
  CHOICE_COMPATIBLE,
  CHOICE_OPENAI,
  DEFAULT_API_KEY_NAME,
  apiKeyName,
  authNote,
  deriveAppName,
  getApiChoice,
  isUsableEndpoint,
  matchApiChoice,
  uniqueAppName,
} from "./chatApi";

describe("the API a chat app speaks", () => {
  it("gives each API its own endpoint and the credential its dashboard hands you", () => {
    const openai = getApiChoice(CHOICE_OPENAI);
    expect(openai.api).toBe(API_OPENAI);
    expect(openai.endpoint).toBe("https://api.openai.com/v1/chat/completions");
    expect(openai.auth).toBe(AUTH_BEARER);

    const claude = getApiChoice(CHOICE_ANTHROPIC);
    expect(claude.api).toBe(API_ANTHROPIC);
    expect(claude.endpoint).toBe("https://api.anthropic.com/v1/messages");
    expect(claude.auth).toBe(AUTH_APIKEY);
  });

  it("reads an app back onto the row that would have written it", () => {
    expect(matchApiChoice(API_ANTHROPIC, "https://api.anthropic.com/v1/messages")).toBe(CHOICE_ANTHROPIC);
    // An app from before there was a choice names no API and no endpoint.
    expect(matchApiChoice("", "")).toBe(CHOICE_OPENAI);
    expect(matchApiChoice(API_OPENAI, "https://api.openai.com/v1/chat/completions")).toBe(CHOICE_OPENAI);
    // The API is what settles it, whatever path a gateway serves it at.
    expect(matchApiChoice(API_ANTHROPIC, "https://llm.acme.dev/anthropic")).toBe(CHOICE_ANTHROPIC);
    // An OpenAI app pointed anywhere else keeps its URL rather than being reset.
    expect(matchApiChoice(API_OPENAI, "http://localhost:11434/v1/chat/completions")).toBe(CHOICE_COMPATIBLE);
  });
});

describe("the credential", () => {
  it("says what will be sent, as the header it becomes", () => {
    expect(authNote(AUTH_BEARER, "")).toEqual({ text: "Authorization: Bearer ‹key›", mono: true });
    expect(authNote(AUTH_APIKEY, "")).toEqual({ text: `${DEFAULT_API_KEY_NAME}: ‹key›`, mono: true });
    expect(authNote(AUTH_APIKEY, "  api-key ")).toEqual({ text: "api-key: ‹key›", mono: true });
    expect(authNote(AUTH_NONE, "").text).toBe("");
  });

  it("falls back to x-api-key when the app names no header", () => {
    expect(apiKeyName("")).toBe(DEFAULT_API_KEY_NAME);
    expect(apiKeyName("   ")).toBe(DEFAULT_API_KEY_NAME);
    expect(apiKeyName("Anthropic-Key")).toBe("Anthropic-Key");
  });
});

describe("the endpoint", () => {
  it("asks only for an absolute HTTP URL", () => {
    expect(isUsableEndpoint("https://api.openai.com/v1/chat/completions")).toBe(true);
    expect(isUsableEndpoint("http://localhost:11434/v1/chat/completions")).toBe(true);
    expect(isUsableEndpoint("")).toBe(false);
    expect(isUsableEndpoint("api.openai.com")).toBe(false);
    expect(isUsableEndpoint("file:///etc/passwd")).toBe(false);
  });

  it("takes a URL a variable stands in for on trust", () => {
    expect(isUsableEndpoint("${LLM_ENDPOINT}")).toBe(true);
    expect(isUsableEndpoint("https://${HOST}/v1/chat/completions")).toBe(true);
  });
});

describe("the derived name", () => {
  it("is the API's own where it has one", () => {
    expect(deriveAppName(CHOICE_OPENAI, "https://api.openai.com/v1/chat/completions")).toBe("OpenAI");
    expect(deriveAppName(CHOICE_ANTHROPIC, "https://api.anthropic.com/v1/messages")).toBe("Claude");
  });

  it("reads the host for an endpoint that names nothing else", () => {
    expect(deriveAppName(CHOICE_COMPATIBLE, "https://llm.acme.dev/v1/chat/completions")).toBe("Llm");
    expect(deriveAppName(CHOICE_COMPATIBLE, "https://api.groq.com/openai/v1/chat/completions")).toBe("Groq");
    expect(deriveAppName(CHOICE_COMPATIBLE, "https://openrouter.ai/api/v1/chat/completions")).toBe("Openrouter.ai");
  });

  it("says nothing for a host that names the machine rather than the service", () => {
    expect(deriveAppName(CHOICE_COMPATIBLE, "http://localhost:11434/v1/chat/completions")).toBe("");
    expect(deriveAppName(CHOICE_COMPATIBLE, "http://10.0.0.4:8000/v1/chat/completions")).toBe("");
    expect(deriveAppName(CHOICE_COMPATIBLE, "not a url")).toBe("");
  });

  it("numbers a collision rather than landing on one", () => {
    expect(uniqueAppName("Claude", [])).toBe("Claude");
    expect(uniqueAppName("Claude", ["Claude"])).toBe("Claude2");
    expect(uniqueAppName("Claude", ["Claude", "Claude2"])).toBe("Claude3");
  });
});
