import { EditorState, Extension, Range, StateField } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import { runtimeNames } from "./scriptBindings";
import { memberAccess, parseScript, walk } from "./scriptSyntax";

export const VERB_MARKS: Record<string, string> = {
  table: "📊",
  pages: "📄",
  text: "💬",
  code: "🧾",
  askStr: "✏️",
  askInt: "🔢",
  askSelect: "🔘",
  askSelectMany: "✅",
  approve: "🛑",
  perfTest: "⏱️",
  run: "🔗",
  rateLimit: "🚦",
  value: "🧩",
  uuidV4: "🎲",
  input: "📥",
  variables: "🔑",
};

export interface VerbChip {
  from: number;
  to: number;
  verb: string;
}

export interface VerbReading {
  chips: VerbChip[];
  // The line `import { kaja } from "kaja"` is on, its break included.
  runtimeImport?: { from: number; to: number };
}

export function readVerbs(code: string): VerbReading | undefined {
  const file = parseScript(code);
  if (!file) return undefined;
  const runtime = runtimeNames(file);
  const receivers = runtime.size > 0 ? runtime : new Set(["kaja"]);
  const chips: VerbChip[] = [];
  walk(file.program, (node) => {
    const access = memberAccess(node);
    if (!access || access.object.type !== "Identifier" || !receivers.has(access.object.name)) return;
    if (!Object.hasOwn(VERB_MARKS, access.name)) return;
    chips.push({ from: node.start!, to: node.end!, verb: access.name });
  });

  let runtimeImport: VerbReading["runtimeImport"];
  for (const statement of file.program.body) {
    if (statement.type !== "ImportDeclaration" || statement.source.value !== "kaja") continue;
    const [only, ...rest] = statement.specifiers;
    if (rest.length > 0 || only?.type !== "ImportSpecifier" || only.local.name !== "kaja" || statement.importKind === "type") continue;
    const lineStart = code.lastIndexOf("\n", statement.start! - 1) + 1;
    const lineEnd = code.indexOf("\n", statement.end!);
    // Only a line holding nothing else, so a statement written beside it stays in view.
    if (code.slice(lineStart, statement.start!).trim() || code.slice(statement.end!, lineEnd < 0 ? code.length : lineEnd).trim()) continue;
    runtimeImport = { from: lineStart, to: lineEnd < 0 ? code.length : lineEnd + 1 };
  }
  return { chips, runtimeImport };
}

class VerbWidget extends WidgetType {
  constructor(readonly verb: string) {
    super();
  }

  eq(other: VerbWidget) {
    return other.verb === this.verb;
  }

  toDOM(): HTMLElement {
    const chip = document.createElement("span");
    chip.className = "cm-verb";
    const mark = document.createElement("span");
    mark.className = "cm-verb-mark";
    mark.textContent = VERB_MARKS[this.verb];
    chip.append(mark, this.verb);
    return chip;
  }
}

function decorate(state: EditorState): DecorationSet | undefined {
  const reading = readVerbs(state.doc.toString());
  if (!reading) return undefined;
  const ranges: Range<Decoration>[] = reading.chips.map((chip) => Decoration.replace({ widget: new VerbWidget(chip.verb) }).range(chip.from, chip.to));
  if (reading.runtimeImport) ranges.push(Decoration.replace({}).range(reading.runtimeImport.from, reading.runtimeImport.to));
  return Decoration.set(ranges, true);
}

const chipsField = StateField.define<DecorationSet>({
  create: (state) => decorate(state) ?? Decoration.none,
  update(current, transaction) {
    if (!transaction.docChanged) return current;
    // A file mid-keystroke doesn't parse, so it keeps the chips it had until it does.
    return decorate(transaction.state) ?? current.map(transaction.changes);
  },
  provide: (field) => [EditorView.decorations.from(field), EditorView.atomicRanges.of((view) => view.state.field(field))],
});

const chipsTheme = EditorView.theme({
  ".cm-verb": {
    display: "inline-flex",
    alignItems: "center",
    gap: "3px",
    padding: "0 5px",
    borderRadius: "6px",
    backgroundColor: "var(--muted)",
    color: "var(--muted-foreground)",
    fontFamily: "ui-sans-serif, system-ui, sans-serif",
    fontSize: "0.92em",
    lineHeight: "1.4",
    verticalAlign: "baseline",
  },
  ".cm-verb-mark": { fontSize: "1.05em" },
});

export function verbChips(): Extension {
  return [chipsField, chipsTheme];
}
