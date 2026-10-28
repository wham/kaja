/** One thing an agent found out about a field of an app it asked a person to finish adding. */
export interface AgentHint {
  text: string;
  /** Whether the person still has something to do in the field, rather than being told why it holds what it holds. */
  needsUser: boolean;
}

/** What an agent said about the app it asked a person to finish adding. */
export interface AgentNotes {
  /** Who it is from, as the agent names itself. */
  agent: string;
  /** Keyed by the app's fields as kaja.json spells them, like the parameters. */
  hints: { [field: string]: AgentHint };
}

// parseHints reads the `hints` an add-app link carries. A hint written as a bare string
// is an aside, which is what every hint was before an agent could say a field was the
// person's; anything else that isn't text is left out, a hint being only ever an aside.
export function parseHints(encoded: string | null): { [field: string]: AgentHint } {
  if (!encoded) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(encoded);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const hints: { [field: string]: AgentHint } = {};
  for (const [field, value] of Object.entries(parsed)) {
    if (typeof value === "string") {
      if (value.trim()) hints[field] = { text: value.trim(), needsUser: false };
    } else if (value && typeof value === "object" && typeof (value as { text?: unknown }).text === "string") {
      const text = (value as { text: string }).text.trim();
      if (text) hints[field] = { text, needsUser: (value as { needs_user?: unknown }).needs_user === true };
    }
  }
  return hints;
}

// A `<tenant>` left in a value is the agent marking the part that is the person's.
const PLACEHOLDER = /<[^<>\s]+>/;

// hintPending is whether a hint is still waiting on the person: it asked for something
// and the field is empty or still holds the placeholder the agent left in it.
export function hintPending(hint: AgentHint, value: string | undefined): boolean {
  return hint.needsUser && (!(value ?? "").trim() || PLACEHOLDER.test(value ?? ""));
}
