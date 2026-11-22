import { EditorState, Extension, Range, StateEffectType, StateField } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import type { App } from "./apps";
import { isCall, parseScript, walk } from "./scriptSyntax";
import { resolveMethod } from "./valueCompletions";

export interface MethodRequest {
  verb: string;
  path: string;
  // Read off the verb, which is the only thing that states whether a call changes something.
  write: boolean;
}

const READS = new Set(["GET", "HEAD", "OPTIONS", "TRACE"]);

export function parseMethodRequest(http: string | undefined): MethodRequest | undefined {
  const [verb, ...rest] = (http ?? "").trim().split(/\s+/);
  if (!verb) return undefined;
  const upper = verb.toUpperCase();
  return { verb: upper, path: rest.join(" "), write: !READS.has(upper) };
}

/** A path split around its `{parameters}`, the parts a request fills in. */
export function pathParts(path: string): { text: string; parameter: boolean }[] {
  return path
    .split(/(\{[^}]*\})/)
    .filter((text) => text !== "")
    .map((text) => ({ text, parameter: text.startsWith("{") }));
}

export interface RequestHint {
  // Where the method's name ends, which is where the hint is drawn.
  at: number;
  line: MethodRequest;
}

export function readRequestHints(code: string, apps: App[]): RequestHint[] | undefined {
  const file = parseScript(code);
  if (!file) return undefined;
  const hints: RequestHint[] = [];
  walk(file.program, (node) => {
    if (!isCall(node)) return;
    const line = parseMethodRequest(option(resolveMethod(file, node, apps)?.method.options));
    if (line) hints.push({ at: node.callee.end!, line });
  });
  return hints.sort((a, b) => a.at - b.at);
}

function option(options: { [key: string]: unknown } | undefined): string | undefined {
  const value = options?.["kaja.http_request"];
  return typeof value === "string" ? value : undefined;
}

class HintWidget extends WidgetType {
  constructor(readonly line: MethodRequest) {
    super();
  }

  eq(other: HintWidget) {
    return other.line.verb === this.line.verb && other.line.path === this.line.path;
  }

  toDOM(): HTMLElement {
    const hint = document.createElement("span");
    hint.className = "cm-request-line";
    hint.setAttribute("aria-hidden", "true");
    const verb = document.createElement("span");
    verb.className = this.line.write ? "cm-request-verb cm-request-write" : "cm-request-verb";
    verb.textContent = this.line.verb;
    hint.append(verb);
    for (const part of pathParts(this.line.path)) {
      const span = document.createElement("span");
      if (part.parameter) span.className = "cm-request-parameter";
      span.textContent = part.text;
      hint.append(span);
    }
    return hint;
  }

  ignoreEvent() {
    return true;
  }
}

function decorate(state: EditorState, apps: App[]): DecorationSet | undefined {
  const hints = readRequestHints(state.doc.toString(), apps);
  if (!hints) return undefined;
  const ranges: Range<Decoration>[] = hints.map((hint) => Decoration.widget({ widget: new HintWidget(hint.line), side: 1 }).range(hint.at));
  return Decoration.set(ranges);
}

const hintsTheme = EditorView.theme({
  ".cm-request-line": {
    margin: "0 2px 0 4px",
    padding: "1px 5px",
    borderRadius: "4px",
    backgroundColor: "var(--muted)",
    color: "var(--muted-foreground)",
    fontSize: "0.82em",
    whiteSpace: "nowrap",
    userSelect: "none",
  },
  ".cm-request-verb": { marginRight: "4px", fontWeight: "500" },
  ".cm-request-write, .cm-request-parameter": { color: "var(--foreground)" },
  ".cm-request-write": { fontWeight: "600" },
});

export function requestHints(hooks: { apps: () => App[]; recheck: StateEffectType<null> }): Extension {
  const field = StateField.define<DecorationSet>({
    create: (state) => decorate(state, hooks.apps()) ?? Decoration.none,
    update(current, transaction) {
      if (!transaction.docChanged && !transaction.effects.some((effect) => effect.is(hooks.recheck))) return current;
      // A file mid-keystroke doesn't parse, so it keeps the hints it had until it does.
      return decorate(transaction.state, hooks.apps()) ?? current.map(transaction.changes);
    },
    provide: (own) => EditorView.decorations.from(own),
  });
  return [field, hintsTheme];
}
