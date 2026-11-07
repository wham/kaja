import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  Completion,
  CompletionContext,
  CompletionResult,
  completionKeymap,
} from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { javascript } from "@codemirror/lang-javascript";
import { bracketMatching, foldGutter, foldKeymap, indentOnInput, indentUnit } from "@codemirror/language";
import { Diagnostic, forceLinting, linter, lintKeymap } from "@codemirror/lint";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { Annotation, Compartment, EditorSelection, EditorState, Extension, StateEffect, StateField } from "@codemirror/state";
import {
  crosshairCursor,
  Decoration,
  DecorationSet,
  drawSelection,
  dropCursor,
  EditorView,
  hoverTooltip,
  KeyBinding,
  keymap,
  lineNumbers,
  rectangularSelection,
  ViewPlugin,
} from "@codemirror/view";
import { useEffect, useRef, useState } from "react";
import { App } from "./apps";
import { FieldSheet } from "./FieldSheet";
import { controlFor, editableRows, removeField, RequestRow, rowAt } from "./requestEdits";
import { codeHighlighting, codeTheme, foldMarker, printCode } from "./codeTheme";
import { formatTypeScript, formatTypeScriptWithCursor } from "./formatter";
import { kajaModuleDeclaration } from "./kajaModule";
import { noSuchScript } from "./scriptLink";
import { runInputDeclaration } from "./scriptInputs";
import { demandScriptParameters, knownScriptInputs, subscribeScriptParameters } from "./scriptParameters";
import { readRunReferences, runNameAt, unresolvedIn } from "./scriptRuns";
import { claimedBindings, isMacPlatform, subscribeShortcuts } from "./shortcuts";
import { reportDiagnostics } from "./syntaxErrors";
import { getBuffer, lineColumnAt, offsetAt, openBuffer, TextBuffer } from "./textBuffer";
import { ScalarValue } from "./typeMemory";
import { askTypeScript, DIAGNOSTIC_ERROR, DIAGNOSTIC_WARNING, subscribeProgram } from "./typescriptService";
import { suggestValues } from "./valueCompletions";

// Scripts get the kaja object through `import { kaja } from "kaja"` — the task runner
// resolves the import at run time (see scriptRunner). Backed by a buffer so TypeScript
// resolves the import to it and go-to-definition lands here. Called again whenever the
// configured variables change (see App.tsx) to refresh the typed `variables` member.
export function registerKajaModule(variableNames: string[]): void {
  openBuffer("/kaja.ts", kajaModuleDeclaration(variableNames));
}

registerKajaModule([]);

// What each script in the folder takes, as a declaration file so the global it declares
// is in scope in the kaja module and in every script.
openBuffer("/kaja-scripts.d.ts", runInputDeclaration([]));
subscribeScriptParameters(() => openBuffer("/kaja-scripts.d.ts", runInputDeclaration(knownScriptInputs())));

// Every editor on the page and the buffer it shows, so a change elsewhere (an app
// compiling, the folder being listed) can ask each of them to check its text again.
const liveViews = new Map<EditorView, string>();

// `forceLinting` only hurries a check that is already scheduled, so a check that has
// finished has to be asked for again: this effect is what the linter refreshes on.
const recheck = StateEffect.define<null>();

function relintAll() {
  for (const view of liveViews.keys()) {
    view.dispatch({ effects: recheck.of(null) });
    forceLinting(view);
  }
}

// A script's text is nothing another script is checked against, so an edit in one
// editor is that editor's own linter's business.
subscribeProgram((changed) => {
  const shown = new Set(liveViews.values());
  if ([...changed].some((path) => !shown.has(path))) relintAll();
});

// Apps the value completions resolve service names against. Kept in sync from
// App.tsx as apps compile.
let valueCompletionApps: App[] = [];

export function setValueCompletionApps(apps: App[]): void {
  valueCompletionApps = apps;
  // What can be picked is read against the apps, so an app landing underlines its calls.
  for (const view of liveViews.keys()) view.dispatch({ effects: recheck.of(null) });
}

/**
 * The scripts a `kaja.run` can reach, as a link spells them. Kept in sync from App.tsx
 * as the folder is listed and written.
 *
 * Undefined until it has been listed, which is the one state worth telling apart: a
 * window that has not read the folder yet would otherwise say every destination in it
 * reaches nothing.
 */
let runDestinations: string[] | undefined;

export function setRunDestinations(names: string[] | undefined): void {
  runDestinations = names;
  relintAll();
}

// A buffer that cannot be holding one is not parsed.
const MIGHT_RUN = /\.run\s*\(/;

/**
 * The mark under a destination that reaches nothing — the failure a click on the cell
 * would have raised, said where the name is written instead of where it is pressed. It
 * stops nothing: a script's types are erased rather than checked, so the rest of it
 * runs exactly as it did, which is the same thing Run already does with a type error.
 */
function runDiagnostics(code: string): Diagnostic[] {
  const references = MIGHT_RUN.test(code) ? readRunReferences(code) : [];
  if (!references || references.length === 0) return [];
  // The destinations on screen are the ones worth knowing the parameters of, and this
  // is the one pass that has read them. What comes back rewrites the declaration the
  // editor checks a `kaja.run`'s input against.
  void demandScriptParameters(references.map((reference) => reference.name));
  const unresolved = runDestinations ? unresolvedIn(references, runDestinations) : [];
  return unresolved.map((reference) => ({ from: reference.start, to: reference.end, severity: "error", message: noSuchScript(reference.name) }));
}

// TypeScript's kind names, as the completion list draws them.
const COMPLETION_TYPE: { [kind: string]: string } = {
  method: "method",
  function: "function",
  "local function": "function",
  constructor: "class",
  property: "property",
  getter: "property",
  setter: "property",
  var: "variable",
  let: "variable",
  "local var": "variable",
  parameter: "variable",
  const: "constant",
  class: "class",
  interface: "interface",
  type: "type",
  "type parameter": "type",
  enum: "enum",
  "enum member": "constant",
  module: "namespace",
  "external module name": "namespace",
  keyword: "keyword",
  string: "text",
};

function infoElement(signature: string, documentation: string): HTMLElement {
  const element = document.createElement("div");
  element.className = "flex max-w-[36em] flex-col gap-1.5 whitespace-normal";
  if (signature) {
    const code = document.createElement("pre");
    code.className = "m-0 whitespace-pre-wrap font-mono text-xs";
    code.innerHTML = printCode(signature);
    element.appendChild(code);
  }
  if (documentation) {
    const text = document.createElement("div");
    text.className = "whitespace-pre-wrap font-sans text-xs text-muted-foreground";
    text.textContent = documentation;
    element.appendChild(text);
  }
  return element;
}

function typescriptCompletions(buffer: TextBuffer) {
  return async (context: CompletionContext): Promise<CompletionResult | null> => {
    const word = context.matchBefore(/[\w$]*/);
    const afterDot = context.state.sliceDoc(context.pos - 1, context.pos) === ".";
    if (!context.explicit && !afterDot && (!word || word.from === word.to)) return null;
    const result = await askTypeScript("completions", buffer.path, context.pos);
    if (!result || context.aborted) return null;
    // A parameter typed `T extends string` infers the literal being typed, and TypeScript
    // offers that literal back as if it were a choice.
    const typed = context.matchBefore(/[^"'`]*/)?.text;
    const entries = result.entries.filter((entry) => !(entry.kind === "string" && entry.name === typed));
    if (entries.length === 0) return null;
    return {
      from: result.from,
      validFor: /^[\w$]*$/,
      options: entries.map((entry): Completion => ({
        label: entry.name,
        type: COMPLETION_TYPE[entry.kind] ?? "variable",
        // TypeScript ranks by sort text, which is a number as a string: locals before
        // members before globals.
        boost: Math.max(-99, 10 - (parseInt(entry.sortText, 10) || 10)),
        apply: entry.insertText,
        info: async () => {
          const details = await askTypeScript("completionDetails", buffer.path, context.pos, entry.name, entry.source);
          return details ? infoElement(details.signature, details.documentation) : null;
        },
      })),
    };
  };
}

const KAJA_IMPORT_LINE = 'import { kaja } from "kaja";\n';

function hasKajaImport(text: string): boolean {
  return /from\s+["']kaja["']/.test(text);
}

// The TypeScript service offers no import from another file, so `kaja` is offered as a
// completion that also writes the import. One transaction, so the cursor stays at the
// end of the word it completed while a line is added above it.
function kajaImportCompletion(buffer: TextBuffer) {
  return (context: CompletionContext): CompletionResult | null => {
    if (buffer.path === "/kaja.ts") return null;
    const word = context.matchBefore(/[\w$]+/);
    if (!word || !"kaja".startsWith(word.text) || hasKajaImport(context.state.doc.toString())) return null;
    return {
      from: word.from,
      options: [
        {
          label: "kaja",
          type: "variable",
          detail: 'import from "kaja"',
          info: "The Kaja runtime object (kaja.table, kaja.text, kaja.askStr, kaja.variables, kaja.value).",
          boost: 99,
          apply: (view, _completion, from, to) => {
            view.dispatch({
              changes: [
                { from: 0, insert: KAJA_IMPORT_LINE },
                { from, to, insert: "kaja" },
              ],
              selection: { anchor: from + KAJA_IMPORT_LINE.length + "kaja".length },
              userEvent: "input.complete",
            });
          },
        },
      ],
    };
  };
}

// A destination is a name rather than a handle, so the names are the whole of what the
// editor can offer. The list offered and the list the mark checks against are one list,
// so what completion writes is what resolves.
function runDestinationCompletions(context: CompletionContext): CompletionResult | null {
  const destinations = runDestinations;
  if (!destinations || destinations.length === 0) return null;
  const code = context.state.doc.toString();
  if (!MIGHT_RUN.test(code)) return null;
  const reference = runNameAt(code, context.pos);
  if (!reference) return null;
  return {
    from: reference.start,
    to: reference.end,
    // The listing's own order, which is the order the sidebar is read in.
    options: destinations.map((name, index) => ({ label: name, type: "text", boost: 99 - Math.min(index, 198) })),
    filter: true,
  };
}

function truncate(text: string): string {
  return text.length > 60 ? text.slice(0, 59) + "…" : text;
}

// Escape a value so it survives being dropped between quotes, whichever quote style the
// literal under the cursor uses.
function escapeForStringLiteral(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/'/g, "\\'").replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t");
}

// The values a field takes are offered here rather than written into the generated
// request, so filling a field in stays a deliberate keystroke. An API that declares a
// closed set is where this earns its keep: the one string out of three it accepts is
// otherwise only in its documentation.
function valueCompletions(context: CompletionContext): CompletionResult | null {
  if (valueCompletionApps.length === 0) return null;
  const suggested = suggestValues(context.state.doc.toString(), context.pos, valueCompletionApps);
  if (!suggested) return null;

  const stringRange = suggested.position.stringRange;
  const word = context.matchBefore(/[\w$.-]*/);
  const from = stringRange ? stringRange.start : (word?.from ?? context.pos);
  const to = stringRange ? stringRange.end : context.pos;

  const { typeName, fieldName } = suggested.position;
  const shortTypeName = typeName.slice(typeName.lastIndexOf(".") + 1);

  // The API's own values first: a document is a better answer than a guess read off
  // what happened to be sent before.
  const offered: { value: ScalarValue; detail: string }[] = [
    ...suggested.position.declared.map((value) => ({ value, detail: `${shortTypeName}.${fieldName} · declared by the API` })),
    ...suggested.values.map((remembered) => ({
      value: remembered.value,
      detail: `${remembered.typeName.slice(remembered.typeName.lastIndexOf(".") + 1)}.${remembered.fieldName} · ${remembered.origin === "request" ? "sent to" : "returned by"} ${remembered.method}`,
    })),
  ];
  if (offered.length === 0) return null;

  return {
    from,
    to,
    filter: true,
    options: offered.map(({ value, detail }, index) => {
      const text = String(value);
      return {
        label: truncate(text),
        type: "constant",
        detail,
        apply: stringRange ? escapeForStringLiteral(text) : JSON.stringify(value),
        boost: 99 - Math.min(index, 198),
      };
    }),
  };
}

function typescriptLinter(buffer: TextBuffer) {
  return linter(
    async (view) => {
      const code = view.state.doc.toString();
      const found = await askTypeScript("diagnostics", buffer.path).catch(() => []);
      // The worker answered for the text it had, which is this text only if nothing was
      // typed in between; the linter drops an answer about an older document itself.
      reportDiagnostics(buffer.path, found);
      const length = view.state.doc.length;
      const diagnostics: Diagnostic[] = found
        .filter((diagnostic) => diagnostic.category === DIAGNOSTIC_ERROR || diagnostic.category === DIAGNOSTIC_WARNING)
        .map((diagnostic) => ({
          from: Math.min(diagnostic.start, length),
          to: Math.min(diagnostic.start + diagnostic.length, length),
          severity: diagnostic.category === DIAGNOSTIC_ERROR ? "error" : "warning",
          message: diagnostic.message,
        }));
      return [...diagnostics, ...runDiagnostics(code)];
    },
    {
      delay: 300,
      needsRefresh: (update) => update.transactions.some((transaction) => transaction.effects.some((effect) => effect.is(recheck))),
    },
  );
}

function typescriptHover(buffer: TextBuffer) {
  return hoverTooltip(async (_view, pos) => {
    const info = await askTypeScript("quickInfo", buffer.path, pos);
    if (!info) return null;
    return {
      pos: info.start,
      end: info.end,
      above: true,
      create: () => {
        const dom = infoElement(info.signature, info.documentation);
        dom.classList.add("px-2.5", "py-1.5");
        return { dom };
      },
    };
  });
}

function isDefinitionModifier(event: MouseEvent | KeyboardEvent): boolean {
  return isMacPlatform() ? event.metaKey : event.ctrlKey;
}

const showLink = StateEffect.define<{ from: number; to: number } | null>();
const linkMark = Decoration.mark({ class: "cm-definition-link" });

const definitionLink = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(link, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(showLink)) return effect.value ? Decoration.set([linkMark.range(effect.value.from, effect.value.to)]) : Decoration.none;
    }
    return transaction.docChanged ? Decoration.none : link;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/**
 * Holding the modifier turns a name with a definition into a link, which is how a
 * ⌘-click is found at all. The worker is asked per word, so a name it cannot place
 * stays plain rather than promising a jump that goes nowhere.
 */
function definitionLinks(buffer: TextBuffer): Extension {
  const plugin = ViewPlugin.fromClass(
    class {
      pointer: { x: number; y: number } | undefined;
      shown: { from: number; to: number } | undefined;
      asked = 0;
      held = false;

      constructor(readonly view: EditorView) {
        window.addEventListener("keydown", this.onKey);
        window.addEventListener("keyup", this.onKey);
        window.addEventListener("blur", this.onBlur);
      }

      onKey = (event: KeyboardEvent) => {
        this.held = isDefinitionModifier(event);
        if (this.held && this.pointer) this.probe();
        else this.clear();
      };

      onBlur = () => {
        this.held = false;
        this.clear();
      };

      move(event: MouseEvent) {
        this.pointer = { x: event.clientX, y: event.clientY };
        this.held = isDefinitionModifier(event);
        if (this.held) this.probe();
        else this.clear();
      }

      leave() {
        this.pointer = undefined;
        this.clear();
      }

      probe() {
        const pos = this.pointer && this.view.posAtCoords(this.pointer);
        const word = pos === null || pos === undefined ? null : this.view.state.wordAt(pos);
        if (!word || pos === null || pos === undefined) return this.clear();
        if (this.shown && this.shown.from === word.from && this.shown.to === word.to) return;
        const asking = ++this.asked;
        void askTypeScript("definition", buffer.path, pos).then((definitions) => {
          if (asking !== this.asked || !this.held) return;
          this.show(definitions.length > 0 ? { from: word.from, to: word.to } : undefined);
        });
      }

      show(range: { from: number; to: number } | undefined) {
        this.shown = range;
        this.view.dispatch({ effects: showLink.of(range ?? null) });
      }

      clear() {
        this.asked++;
        if (this.shown) this.show(undefined);
      }

      destroy() {
        window.removeEventListener("keydown", this.onKey);
        window.removeEventListener("keyup", this.onKey);
        window.removeEventListener("blur", this.onBlur);
      }
    },
    {
      eventHandlers: {
        mousemove(event) {
          this.move(event);
        },
        mouseleave() {
          this.leave();
        },
      },
    },
  );
  return [definitionLink, plugin];
}

/**
 * Every chord the window states is left out of the editor's keymap, because the editor
 * matches first and then stops the event — ⌘⏎ would insert a line below rather than run
 * the script. A binding the window claims later is taken out of every editor then.
 */
function normalizeKaja(binding: string): string {
  const parts = binding.split("+");
  const key = parts.pop() ?? "";
  const modifiers = parts.map((part) => (part === "Mod" ? (isMacPlatform() ? "meta" : "ctrl") : part.toLowerCase()));
  return [...modifiers.sort(), key.toLowerCase()].join("+");
}

function normalizeCodeMirror(binding: string): string {
  const parts = binding.split(/-(?!$)/);
  const key = parts.pop() ?? "";
  const modifiers = parts.map((part) => {
    const name = part.toLowerCase();
    if (name === "mod") return isMacPlatform() ? "meta" : "ctrl";
    if (name === "cmd") return "meta";
    if (name === "c") return "ctrl";
    if (name === "a") return "alt";
    if (name === "s") return "shift";
    if (name === "m") return "meta";
    return name;
  });
  return [...modifiers.sort(), key.toLowerCase()].join("+");
}

function unclaimed(bindings: readonly KeyBinding[]): KeyBinding[] {
  const claimed = new Set(claimedBindings().map(normalizeKaja));
  return bindings.filter((binding) => {
    const key = (isMacPlatform() ? binding.mac : undefined) ?? binding.key;
    return !key || !claimed.has(normalizeCodeMirror(key));
  });
}

// A tap moving further than this is a scroll, and one held longer is a selection.
const TAP_SLOP = 8;
const TAP_MS = 500;

const pickableMark = Decoration.mark({ class: "cm-pickable" });
const pickingMark = Decoration.mark({ class: "cm-picking" });
const showPicking = StateEffect.define<{ from: number; to: number } | null>();

function pickableRanges(state: EditorState): DecorationSet {
  if (valueCompletionApps.length === 0) return Decoration.none;
  const rows = editableRows(state.doc.toString(), valueCompletionApps);
  return Decoration.set(
    rows.map((row) => pickableMark.range(row.value.start, row.value.end)),
    true,
  );
}

const pickable = StateField.define<DecorationSet>({
  create: pickableRanges,
  update(ranges, transaction) {
    if (transaction.docChanged || transaction.effects.some((effect) => effect.is(recheck))) return pickableRanges(transaction.state);
    return ranges;
  },
  provide: (field) => EditorView.decorations.from(field),
});

const picking = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(mark, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(showPicking)) return effect.value ? Decoration.set([pickingMark.range(effect.value.from, effect.value.to)]) : Decoration.none;
    }
    return transaction.docChanged ? Decoration.none : mark;
  },
  provide: (field) => EditorView.decorations.from(field),
});

const pickerTheme = EditorView.theme({
  ".cm-pickable": {
    textDecorationLine: "underline",
    textDecorationStyle: "dotted",
    textDecorationColor: "color-mix(in oklab, currentColor 55%, transparent)",
    textUnderlineOffset: "3px",
  },
  ".cm-picking": { backgroundColor: "rgb(251 191 36 / 0.3)", borderRadius: "3px" },
});

/**
 * On a phone, a value in a request is changed with a control of its kind rather than by
 * typing into the code: a tap on one opens a picker instead of the keyboard. Only while
 * the editor has no focus, so a tap made while typing still places the caret, and only
 * a tap, so a drag still scrolls and a press held still selects.
 */
function pickers(onPick: (row: RequestRow) => void): Extension {
  const taps = ViewPlugin.fromClass(
    class {
      touch: { x: number; y: number; time: number } | undefined;

      constructor(readonly view: EditorView) {
        view.contentDOM.addEventListener("touchstart", this.start, { passive: true });
        view.contentDOM.addEventListener("touchend", this.end);
      }

      start = (event: TouchEvent) => {
        const touch = event.touches[0];
        this.touch = event.touches.length === 1 && !this.view.hasFocus ? { x: touch.clientX, y: touch.clientY, time: event.timeStamp } : undefined;
      };

      end = (event: TouchEvent) => {
        const started = this.touch;
        this.touch = undefined;
        const touch = event.changedTouches[0];
        if (!started || !touch || event.timeStamp - started.time > TAP_MS) return;
        if (Math.abs(touch.clientX - started.x) > TAP_SLOP || Math.abs(touch.clientY - started.y) > TAP_SLOP) return;
        const pos = this.view.posAtCoords({ x: touch.clientX, y: touch.clientY });
        if (pos === null) return;
        const code = this.view.state.doc.toString();
        const row = rowAt(code, valueCompletionApps, pos);
        if (!row || !controlFor(row, code)) return;
        // Cancelled, the tap neither focuses the editor nor raises the keyboard.
        event.preventDefault();
        onPick(row);
      };

      destroy() {
        this.view.contentDOM.removeEventListener("touchstart", this.start);
        this.view.contentDOM.removeEventListener("touchend", this.end);
      }
    },
  );
  return [pickable, picking, pickerTheme, taps];
}

const keys = new Compartment();
const gutter = new Compartment();
const editable = new Compartment();
const picker = new Compartment();

export interface EditorViewState {
  anchor: number;
  head: number;
  scrollTop: number;
}

export interface EditorHandle {
  getValue(): string;
  saveViewState(): EditorViewState;
  // Puts the caret at an offset and scrolls to it.
  reveal(offset: number): void;
}

export interface onGoToDefinition {
  (buffer: TextBuffer, startLineNumber: number, startColumn: number): void;
}

interface EditorProps {
  buffer: TextBuffer;
  readOnly?: boolean;
  /**
   * Whether to run the buffer through prettier as it is shown. Only a generated module
   * is: it is printed by the TypeScript printer, lives in memory and is nobody's file. A
   * script's buffer is never touched, because a script is a file on disk and this
   * editor auto-saves — reformatting it here would rewrite somebody's file for the
   * crime of being opened, in prettier's defaults rather than in the settings the file
   * was written under.
   */
  format?: boolean;
  onMount?: (handle: EditorHandle) => void;
  // A change somebody made in this editor, rather than one written into its buffer.
  onUserEdit?: () => void;
  onContentHeight?: (height: number) => void;
  onGoToDefinition: onGoToDefinition;
  startLineNumber?: number;
  startColumn?: number;
  viewState?: EditorViewState;
  // A phone's column has no room for a gutter: no line numbers, no folding.
  phone?: boolean;
}

// Applied by the editor when its buffer was written by someone else, so the change is
// not written back into the buffer it came from.
const fromBuffer = Annotation.define<boolean>();

// The smallest edit that turns one text into the other, so an edit written from outside
// (a rename followed, a file re-read from disk) is one undo step that leaves the cursor
// where it was unless the text under it moved.
function minimalChange(before: string, after: string): { from: number; to: number; insert: string } {
  let start = 0;
  const shorter = Math.min(before.length, after.length);
  while (start < shorter && before.charCodeAt(start) === after.charCodeAt(start)) start++;
  let end = 0;
  while (end < shorter - start && before.charCodeAt(before.length - 1 - end) === after.charCodeAt(after.length - 1 - end)) end++;
  return { from: start, to: before.length - end, insert: after.slice(start, after.length - end) };
}

const phoneMargins = EditorView.theme({ ".cm-content": { padding: "12px 16px calc(12px + env(safe-area-inset-bottom))" } });

function gutterExtensions(phone: boolean): Extension {
  return phone ? phoneMargins : [lineNumbers(), foldGutter({ markerDOM: foldMarker })];
}

// Read-only text still takes the focus, so it can be searched and walked with the keys,
// except on a phone, where a focused field is a keyboard over the code.
function editableExtensions(readOnly: boolean, phone: boolean): Extension {
  return [EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly || !phone)];
}

export function Editor({
  buffer,
  onMount,
  onUserEdit,
  onContentHeight,
  onGoToDefinition,
  readOnly = false,
  format = false,
  startLineNumber = 0,
  startColumn = 0,
  viewState,
  phone = false,
}: EditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  // Read through refs, so the editor is created once per buffer rather than per render.
  const callbacks = useRef({ onUserEdit, onContentHeight, onGoToDefinition });
  callbacks.current = { onUserEdit, onContentHeight, onGoToDefinition };
  // The value a picker is open on, with the text it was read from: an edit that landed
  // since (an agent writing, a reload) leaves it pointing at nothing.
  const [picked, setPicked] = useState<{ row: RequestRow; code: string } | undefined>();
  const pick = useRef((row: RequestRow) => {
    const view = viewRef.current;
    if (!view) return;
    setPicked({ row, code: view.state.doc.toString() });
    view.dispatch({ effects: showPicking.of({ from: row.value.start, to: row.value.end }) });
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const goToDefinition = async (view: EditorView, pos: number) => {
      const [definition] = await askTypeScript("definition", buffer.path, pos);
      if (!definition) return;
      if (definition.path === buffer.path) {
        view.dispatch({ selection: { anchor: definition.start }, effects: EditorView.scrollIntoView(definition.start, { y: "center" }) });
        view.focus();
        return;
      }
      const target = getBuffer(definition.path);
      if (!target) return;
      const { line, column } = lineColumnAt(target.getValue(), definition.start);
      callbacks.current.onGoToDefinition(target, line, column);
    };

    const formatDocument = (view: EditorView) => {
      const before = view.state.doc.toString();
      formatTypeScript(before).then((formatted) => {
        if (view.state.doc.toString() !== before) return;
        view.dispatch({ changes: minimalChange(before, formatted), userEvent: "input.format" });
      });
      return true;
    };

    const ownKeys = (): KeyBinding[] =>
      unclaimed([
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...searchKeymap,
        ...historyKeymap,
        ...foldKeymap,
        ...completionKeymap,
        ...lintKeymap,
        indentWithTab,
        {
          key: "F12",
          run: (view) => {
            void goToDefinition(view, view.state.selection.main.head);
            return true;
          },
        },
        { key: "Shift-Alt-f", run: formatDocument },
      ]);

    const state = EditorState.create({
      doc: buffer.getValue(),
      extensions: [
        gutter.of(gutterExtensions(phone)),
        picker.of(phone && !readOnly ? pickers((row) => pick.current(row)) : []),
        editable.of(editableExtensions(readOnly, phone)),
        keys.of(keymap.of(ownKeys())),
        history(),
        // The native selection on a phone, which is what its handles, its callout and
        // its paste act on; a drawn one is what makes multiple cursors possible.
        phone ? [] : [drawSelection(), rectangularSelection(), crosshairCursor()],
        dropCursor(),
        indentOnInput(),
        indentUnit.of("  "),
        EditorState.tabSize.of(2),
        bracketMatching(),
        closeBrackets(),
        highlightSelectionMatches(),
        search({ top: true }),
        // The pane is deliberately short so the response gets the room. Vertical
        // scrolling is the cost of that; horizontal scrolling would be worse, so a line
        // too long to fit wraps instead.
        EditorView.lineWrapping,
        javascript({ typescript: true }),
        codeTheme,
        codeHighlighting,
        autocompletion({
          override: [typescriptCompletions(buffer), kajaImportCompletion(buffer), runDestinationCompletions, valueCompletions],
          icons: false,
        }),
        typescriptLinter(buffer),
        typescriptHover(buffer),
        definitionLinks(buffer),
        EditorView.domEventHandlers({
          mousedown: (event, view) => {
            if (!isDefinitionModifier(event) || event.button !== 0) return false;
            const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
            if (pos === null) return false;
            event.preventDefault();
            void goToDefinition(view, pos);
            return true;
          },
        }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !update.transactions.some((transaction) => transaction.annotation(fromBuffer))) {
            buffer.setValue(update.state.doc.toString(), update.view);
            if (
              update.transactions.some(
                (transaction) =>
                  transaction.isUserEvent("input") ||
                  transaction.isUserEvent("delete") ||
                  transaction.isUserEvent("undo") ||
                  transaction.isUserEvent("redo") ||
                  transaction.isUserEvent("move"),
              )
            ) {
              callbacks.current.onUserEdit?.();
            }
          }
          if (update.geometryChanged || update.heightChanged) callbacks.current.onContentHeight?.(update.view.contentHeight);
        }),
      ],
    });

    const view = new EditorView({ state, parent: container });
    viewRef.current = view;
    liveViews.set(view, buffer.path);

    const unsubscribeBuffer = buffer.onDidChange((origin) => {
      if (origin === view) return;
      const before = view.state.doc.toString();
      const after = buffer.getValue();
      if (before === after) return;
      view.dispatch({ changes: minimalChange(before, after), annotations: fromBuffer.of(true) });
    });

    const unsubscribeShortcuts = subscribeShortcuts(() => view.dispatch({ effects: keys.reconfigure(keymap.of(ownKeys())) }));

    let disposed = false;
    const reveal = (offset: number) => {
      view.dispatch({ selection: { anchor: offset }, effects: EditorView.scrollIntoView(offset, { y: "center" }) });
    };
    const goingTo = !viewState && startLineNumber > 0;

    if (format) {
      const text = buffer.getValue();
      const cursor = goingTo ? offsetAt(text, startLineNumber, startColumn) : 0;
      formatTypeScriptWithCursor(text, cursor).then((result) => {
        if (disposed) return;
        buffer.setValue(result.code);
        if (goingTo) reveal(Math.min(result.cursorOffset, view.state.doc.length));
      });
    } else if (viewState) {
      const length = view.state.doc.length;
      view.dispatch({ selection: EditorSelection.single(Math.min(viewState.anchor, length), Math.min(viewState.head, length)) });
      // The scroll position is the layout's, which the first measure has to settle.
      requestAnimationFrame(() => {
        if (!disposed) view.scrollDOM.scrollTop = viewState.scrollTop;
      });
    } else if (goingTo) {
      reveal(offsetAt(buffer.getValue(), startLineNumber, startColumn));
    }

    onMount?.({
      getValue: () => view.state.doc.toString(),
      saveViewState: () => ({ anchor: view.state.selection.main.anchor, head: view.state.selection.main.head, scrollTop: view.scrollDOM.scrollTop }),
      reveal: (offset) => reveal(Math.min(offset, view.state.doc.length)),
    });
    callbacks.current.onContentHeight?.(view.contentHeight);

    return () => {
      disposed = true;
      unsubscribeBuffer();
      unsubscribeShortcuts();
      liveViews.delete(view);
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buffer]);

  // A view mounts before the process has said whether it may write the workspace: a
  // window restores its views synchronously and the answer arrives with the workspace.
  // Without this the file that was open when the window last closed stays read-only for
  // the session.
  useEffect(() => {
    viewRef.current?.dispatch({ effects: editable.reconfigure(editableExtensions(readOnly, phone)) });
  }, [readOnly, phone]);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: gutter.reconfigure(gutterExtensions(phone)) });
  }, [phone]);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: picker.reconfigure(phone && !readOnly ? pickers((row) => pick.current(row)) : []) });
  }, [phone, readOnly]);

  const current = picked && viewRef.current?.state.doc.toString() === picked.code ? picked : undefined;

  const closePicker = () => {
    setPicked(undefined);
    viewRef.current?.dispatch({ effects: showPicking.of(null) });
  };

  const edit = (from: number, to: number, insert: string) => {
    viewRef.current?.dispatch({ changes: { from, to, insert }, userEvent: "input.pick" });
  };

  return (
    <>
      <div ref={containerRef} className="h-full w-full bg-background text-xs" />
      {phone && (
        <FieldSheet
          row={current?.row}
          control={current && controlFor(current.row, current.code)}
          onWrite={(text) => current && edit(current.row.value.start, current.row.value.end, text)}
          onRemove={
            current
              ? () => {
                  const change = minimalChange(current.code, removeField(current.code, current.row));
                  edit(change.from, change.to, change.insert);
                }
              : undefined
          }
          onEditAsText={
            current
              ? () => {
                  const view = viewRef.current;
                  const { value } = current.row;
                  closePicker();
                  if (!view) return;
                  // Inside the quotes, so what is typed replaces the text and not the literal.
                  const quoted = value.kind === "string";
                  view.focus();
                  view.dispatch({ selection: { anchor: value.start + (quoted ? 1 : 0), head: value.end - (quoted ? 1 : 0) } });
                }
              : undefined
          }
          onClose={closePicker}
        />
      )}
    </>
  );
}
