import { EditorState, Extension, Range, StateEffect, StateEffectType, StateField, Transaction } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, ViewPlugin, WidgetType } from "@codemirror/view";
import { App } from "./apps";
import { Choice, controlFor, RequestValue, requestValues, TextControl, ValueControl } from "./requestValues";

/**
 * A phone edits a script's data in the code: the values its requests send stand out,
 * the code around them steps back, and a tap on one opens it in place, as a field with
 * the keyboard of its kind or as a menu where the API names the choices. What is
 * written is the literal, so the code stays the truth and a draft is saved as usual.
 */

// A tap moving further than this is a scroll, and one held longer is a selection.
const TAP_SLOP = 8;
const TAP_MS = 500;
const MAX_SUGGESTIONS = 8;

interface Editing {
  index: number;
  // A new one for every opening, so a widget is rebuilt rather than reused.
  token: number;
}

interface ValuesState {
  values: RequestValue[];
  editing: Editing | null;
  decorations: DecorationSet;
}

const setEditing = StateEffect.define<Editing | null>();
let tokens = 0;

const valueMark = Decoration.mark({ class: "cm-value" });
const quietLine = Decoration.line({ class: "cm-quiet" });

interface Hooks {
  apps: () => App[];
  recheck: StateEffectType<null>;
}

function decorate(state: EditorState, values: RequestValue[], editing: Editing | null, field: () => StateField<ValuesState>): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  const loud = new Set<number>();
  for (const value of values) {
    loud.add(state.doc.lineAt(value.start).number);
    loud.add(state.doc.lineAt(value.call).number);
  }
  if (values.length > 0) {
    for (let number = 1; number <= state.doc.lines; number++) {
      if (!loud.has(number)) ranges.push(quietLine.range(state.doc.line(number).from));
    }
  }
  values.forEach((value, index) => {
    if (editing?.index === index) {
      ranges.push(
        Decoration.replace({ widget: new ValueWidget(value, index, values.length, editing.token, state.doc.toString(), field()) }).range(
          value.start,
          value.end,
        ),
      );
    } else {
      ranges.push(valueMark.range(value.start, value.end));
    }
  });
  return Decoration.set(ranges, true);
}

function valuesField(hooks: Hooks): StateField<ValuesState> {
  const self = (): StateField<ValuesState> => field;
  const field: StateField<ValuesState> = StateField.define<ValuesState>({
    create: (state) => {
      const values = requestValues(state.doc.toString(), hooks.apps());
      return { values, editing: null, decorations: decorate(state, values, null, self) };
    },
    update(current, transaction: Transaction) {
      let { values, editing } = current;
      const reread = transaction.docChanged || transaction.effects.some((effect) => effect.is(hooks.recheck));
      if (reread) values = requestValues(transaction.state.doc.toString(), hooks.apps());
      // An edit that isn't this editor's own lets go of the value it was open on.
      if (transaction.docChanged) editing = null;
      for (const effect of transaction.effects) if (effect.is(setEditing)) editing = effect.value;
      if (editing && editing.index >= values.length) editing = null;
      if (!reread && editing === current.editing) return current;
      return { values, editing, decorations: decorate(transaction.state, values, editing, self) };
    },
    provide: (own) => EditorView.decorations.from(own, (state) => state.decorations),
  });
  return field;
}

// The value open now, with what was typed into it, written before anything moves it.
const flushes = new WeakMap<EditorView, { token: number; flush: () => void }>();

function flush(view: EditorView) {
  flushes.get(view)?.flush();
}

function open(view: EditorView, field: StateField<ValuesState>, index: number) {
  const editing = { index, token: ++tokens };
  view.dispatch({ effects: setEditing.of(editing) });
  const value = view.state.field(field).values[index];
  if (value) view.dispatch({ effects: EditorView.scrollIntoView(value.start, { y: "nearest", yMargin: 120 }) });
  const input = view.contentDOM.querySelector<HTMLInputElement>(".cm-value-input");
  if (input) {
    // Inside the gesture, which is the only place iOS raises the keyboard from.
    input.focus();
    input.select();
  } else if (document.activeElement instanceof HTMLElement && view.dom.contains(document.activeElement)) {
    document.activeElement.blur();
  }
}

function openAt(view: EditorView, field: StateField<ValuesState>, pos: number): boolean {
  const before = view.state.doc;
  flush(view);
  const mapped = before === view.state.doc ? pos : mapThrough(before.toString(), view.state.doc.toString(), pos);
  const index = view.state.field(field).values.findIndex((value) => value.start <= mapped && mapped <= value.end);
  if (index < 0) return false;
  open(view, field, index);
  return true;
}

// A flush changes one literal, so a position after it moves by the change in length.
function mapThrough(before: string, after: string, pos: number): number {
  let start = 0;
  while (start < before.length && before[start] === after[start]) start++;
  return pos <= start ? pos : pos + after.length - before.length;
}

function write(view: EditorView, field: StateField<ValuesState>, token: number, text: string | undefined, then: "close" | "next" | "prev") {
  const state = view.state.field(field);
  if (state.editing?.token !== token) return;
  flushes.delete(view);
  const { index } = state.editing;
  const value = state.values[index];
  const current = view.state.sliceDoc(value.start, value.end);
  const changes = text !== undefined && text !== current ? { from: value.start, to: value.end, insert: text } : undefined;
  view.dispatch({ changes, effects: setEditing.of(null), userEvent: "input.value" });
  if (then === "close") return;
  const next = index + (then === "next" ? 1 : -1);
  if (next >= 0 && next < view.state.field(field).values.length) open(view, field, next);
}

const cleanups = new WeakMap<HTMLElement, () => void>();

class ValueWidget extends WidgetType {
  constructor(
    readonly value: RequestValue,
    readonly index: number,
    readonly total: number,
    readonly token: number,
    readonly code: string,
    readonly field: StateField<ValuesState>,
  ) {
    super();
  }

  eq(other: ValueWidget) {
    return other.token === this.token;
  }

  ignoreEvent() {
    return true;
  }

  toDOM(view: EditorView): HTMLElement {
    const field = this.field;
    const control = controlFor(this.value, this.code);
    const root = document.createElement("span");
    root.className = "cm-value-edit";
    const source = this.code.slice(this.value.start, this.value.end);
    const panel = document.createElement("div");
    panel.className = "cm-value-panel";

    const finish = (text: string | undefined, then: "close" | "next" | "prev") => write(view, field, this.token, text, then);

    const nav = () => {
      const row = document.createElement("div");
      row.className = "cm-value-nav";
      const label = document.createElement("span");
      label.className = "cm-value-label";
      label.textContent = `${this.value.key} · ${this.index + 1} of ${this.total}`;
      row.append(
        button("‹", "Previous value", this.index > 0, () => finish(typed(), "prev")),
        label,
        button("›", "Next value", this.index < this.total - 1, () => finish(typed(), "next")),
        button("Done", "Done", true, () => finish(typed(), "close"), "cm-value-done"),
      );
      return row;
    };

    let typed: () => string | undefined = () => undefined;

    const showField = (text: TextControl) => {
      root.replaceChildren();
      panel.replaceChildren();
      const input = document.createElement("input");
      input.className = "cm-value-input";
      input.value = text.value;
      input.inputMode = text.kind === "number" ? (text.value.includes(".") ? "decimal" : "numeric") : /^https?:/.test(text.value) ? "url" : "text";
      input.enterKeyHint = this.index < this.total - 1 ? "next" : "done";
      input.autocapitalize = "off";
      input.spellcheck = false;
      input.setAttribute("autocorrect", "off");
      input.setAttribute("autocomplete", "off");
      input.size = Math.max(input.value.length, 2);
      input.addEventListener("input", () => (input.size = Math.max(input.value.length, 2)));
      typed = () => text.write(input.value);
      input.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        finish(typed(), this.index < this.total - 1 ? "next" : "close");
      });
      // Leaving the field is how the keyboard's own Done and a tap elsewhere finish it.
      input.addEventListener("blur", () => finish(typed(), "close"));
      if (text.suggestions.length > 0) {
        const chips = document.createElement("div");
        chips.className = "cm-value-chips";
        for (const suggestion of text.suggestions.slice(0, MAX_SUGGESTIONS)) {
          chips.append(button(suggestion, `Use ${suggestion}`, true, () => finish(text.write(suggestion), "close"), "cm-value-chip"));
        }
        panel.append(chips);
      }
      panel.append(nav());
      root.append(input, panel);
      flushes.set(view, { token: this.token, flush: () => finish(typed(), "close") });
      return input;
    };

    const showChoices = (choices: Choice[], other: TextControl | undefined) => {
      const chosen = document.createElement("span");
      chosen.className = "cm-value-chosen";
      chosen.textContent = source;
      const list = document.createElement("div");
      list.className = "cm-value-choices";
      for (const choice of choices) {
        list.append(button(choice.selected ? `${choice.label}  ✓` : choice.label, choice.label, true, () => finish(choice.text, "close"), "cm-value-choice"));
      }
      if (other) {
        list.append(button("Type a value…", "Type a value", true, () => showField(other)?.focus(), "cm-value-choice cm-value-other"));
      }
      panel.append(list, nav());
      root.append(chosen, panel);
      flushes.set(view, { token: this.token, flush: () => finish(undefined, "close") });
    };

    if (!control) showChoices([], undefined);
    else if (control.kind === "choice") showChoices(control.choices, control.other);
    else showField(control);

    requestAnimationFrame(() => keepInside(view, panel));
    // The keyboard rises after the field is focused and can cover the panel under it.
    const reveal = () => panel.scrollIntoView({ block: "nearest" });
    window.visualViewport?.addEventListener("resize", reveal);
    cleanups.set(root, () => window.visualViewport?.removeEventListener("resize", reveal));
    return root;
  }

  destroy(dom: HTMLElement) {
    cleanups.get(dom)?.();
    dom.querySelector("input")?.blur();
  }
}

function button(text: string, label: string, enabled: boolean, onPress: () => void, className = "cm-value-key"): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.className = className;
  element.textContent = text;
  element.setAttribute("aria-label", label);
  if (!enabled) element.setAttribute("aria-disabled", "true");
  // Cancelled, the press keeps the field focused, so it isn't finished by its blur first.
  element.addEventListener("pointerdown", (event) => event.preventDefault());
  element.addEventListener("mousedown", (event) => event.preventDefault());
  element.addEventListener("click", (event) => {
    event.preventDefault();
    if (enabled) onPress();
  });
  return element;
}

// The panel hangs under the value, so one near the right edge is pulled back in.
function keepInside(view: EditorView, panel: HTMLElement) {
  const bounds = view.scrollDOM.getBoundingClientRect();
  const rect = panel.getBoundingClientRect();
  if (rect.right > bounds.right - 8) panel.style.left = `${Math.min(0, bounds.right - 8 - rect.right)}px`;
  const shifted = panel.getBoundingClientRect();
  if (shifted.left < bounds.left + 8) panel.style.left = `${parseFloat(panel.style.left || "0") + bounds.left + 8 - shifted.left}px`;
}

function chooser(field: StateField<ValuesState>): Extension {
  const taps = ViewPlugin.fromClass(
    class {
      touch: { x: number; y: number; time: number } | undefined;

      constructor(readonly view: EditorView) {
        view.contentDOM.addEventListener("touchstart", this.start, { passive: true });
        view.contentDOM.addEventListener("touchend", this.end);
        document.addEventListener("pointerdown", this.outside, true);
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
        if ((event.target as Element).closest?.(".cm-value-edit")) return;
        const pos = this.view.posAtCoords({ x: touch.clientX, y: touch.clientY });
        if (pos === null) return;
        const values = this.view.state.field(field).values;
        if (!values.some((value) => value.start <= pos && pos <= value.end)) return;
        // Cancelled, the tap neither places the caret nor raises the code's keyboard.
        event.preventDefault();
        openAt(this.view, field, pos);
      };

      // A menu has no field to lose the focus, so a press anywhere else closes it.
      outside = (event: PointerEvent) => {
        const open = this.view.contentDOM.querySelector(".cm-value-edit");
        if (!open || open.contains(event.target as Node) || open.querySelector("input")) return;
        flush(this.view);
      };

      destroy() {
        this.view.contentDOM.removeEventListener("touchstart", this.start);
        this.view.contentDOM.removeEventListener("touchend", this.end);
        document.removeEventListener("pointerdown", this.outside, true);
        flushes.delete(this.view);
      }
    },
  );
  // A browser narrowed to a phone's width is still clicked with a mouse. A touch that
  // was taken above never gets this far, its mousedown cancelled with it.
  const clicks = EditorView.domEventHandlers({
    mousedown: (event, view) => {
      if (event.button !== 0 || view.hasFocus || (event.target as Element).closest?.(".cm-value-edit")) return false;
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (pos === null || !view.state.field(field).values.some((value) => value.start <= pos && pos <= value.end)) return false;
      event.preventDefault();
      return openAt(view, field, pos);
    },
  });
  return [taps, clicks];
}

const theme = EditorView.theme({
  ".cm-quiet": { transition: "opacity 150ms" },
  "&:not(.cm-focused) .cm-quiet": { opacity: "0.45" },
  "&:not(.cm-focused) .cm-value": {
    backgroundColor: "color-mix(in oklab, var(--code-type, currentColor) 14%, transparent)",
    boxShadow: "inset 0 0 0 1px color-mix(in oklab, var(--code-type, currentColor) 35%, transparent)",
    borderRadius: "4px",
  },
  ".cm-value-edit": { position: "relative", display: "inline-block" },
  ".cm-value-input, .cm-value-chosen": {
    font: "inherit",
    color: "inherit",
    backgroundColor: "color-mix(in oklab, var(--code-type, currentColor) 18%, transparent)",
    border: "none",
    borderRadius: "4px",
    outline: "2px solid var(--code-type, currentColor)",
    padding: "0 3px",
    margin: "0",
  },
  ".cm-value-panel": {
    position: "absolute",
    top: "calc(100% + 6px)",
    left: "0",
    zIndex: "20",
    width: "max-content",
    minWidth: "220px",
    maxWidth: "min(340px, calc(100vw - 24px))",
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    padding: "6px",
    borderRadius: "12px",
    border: "1px solid var(--border)",
    backgroundColor: "var(--popover)",
    color: "var(--popover-foreground)",
    boxShadow: "0 12px 32px rgb(0 0 0 / 0.35)",
    fontFamily: "var(--font-sans, system-ui)",
    fontSize: "15px",
    lineHeight: "1.2",
    whiteSpace: "normal",
  },
  ".cm-value-chips": { display: "flex", gap: "6px", overflowX: "auto", scrollbarWidth: "none" },
  ".cm-value-chip": {
    flex: "none",
    fontFamily: "var(--font-mono)",
    fontSize: "14px",
    padding: "7px 11px",
    borderRadius: "999px",
    backgroundColor: "var(--muted)",
    color: "inherit",
    border: "none",
  },
  ".cm-value-choices": { display: "flex", flexDirection: "column" },
  ".cm-value-choice": {
    textAlign: "left",
    padding: "11px 10px",
    borderRadius: "8px",
    fontFamily: "var(--font-mono)",
    fontSize: "15px",
    whiteSpace: "pre",
    backgroundColor: "transparent",
    color: "inherit",
    border: "none",
  },
  ".cm-value-choice:active, .cm-value-chip:active, .cm-value-key:active": { backgroundColor: "var(--accent)" },
  ".cm-value-other": { fontFamily: "var(--font-sans, system-ui)", color: "var(--muted-foreground)" },
  ".cm-value-nav": { display: "flex", alignItems: "center", gap: "6px", borderTop: "1px solid var(--border)", paddingTop: "6px" },
  ".cm-value-label": {
    flex: "1",
    minWidth: "0",
    textAlign: "center",
    fontSize: "13px",
    color: "var(--muted-foreground)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  ".cm-value-key, .cm-value-done": {
    minWidth: "38px",
    height: "34px",
    padding: "0 10px",
    borderRadius: "8px",
    border: "none",
    backgroundColor: "var(--muted)",
    color: "inherit",
    fontSize: "17px",
  },
  ".cm-value-done": { fontSize: "15px", fontWeight: "600", backgroundColor: "var(--primary)", color: "var(--primary-foreground)" },
  "[aria-disabled=true]": { opacity: "0.35" },
});

export function valueEditing(hooks: Hooks): Extension {
  const field = valuesField(hooks);
  return [field, chooser(field), theme];
}
