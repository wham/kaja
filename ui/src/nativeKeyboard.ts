import {
  acceptCompletion,
  completionStatus,
  currentCompletions,
  deleteBracketPair,
  insertBracket,
  setSelectedCompletion,
  startCompletion,
} from "@codemirror/autocomplete";
import { cursorCharLeft, cursorCharRight, deleteCharBackward, indentMore, undo, undoDepth } from "@codemirror/commands";
import { EditorView } from "@codemirror/view";
import { App } from "./apps";
import { FieldStop, fieldStops, hop } from "./fieldStops";

/**
 * The iOS app's keyboard for code (`desktop/keyboard_ios.m`): a bar attached to the
 * system keyboard and a symbol pad that takes its place, both UIKit. The page says
 * what the bar shows over a script message, and the keys come back as calls to
 * `window.kajaKeyboard.press`, run against the editor that has the focus.
 */

const MAX_COMPLETIONS = 30;

export interface KeyboardState {
  active: boolean;
  completions: string[];
  fields: number;
  canPrev: boolean;
  canNext: boolean;
  canUndo: boolean;
}

const INACTIVE: KeyboardState = { active: false, completions: [], fields: 0, canPrev: false, canNext: false, canUndo: false };

interface NativeHandler {
  postMessage(message: string): void;
}

function handler(): NativeHandler | undefined {
  return (window as unknown as { webkit?: { messageHandlers?: { kajaKeyboard?: NativeHandler } } }).webkit?.messageHandlers?.kajaKeyboard;
}

let cached: { code: string; apps: App[]; stops: FieldStop[] } | undefined;

function stopsOf(code: string, apps: App[]): FieldStop[] {
  if (cached?.code !== code || cached.apps !== apps) cached = { code, apps, stops: fieldStops(code, apps) };
  return cached.stops;
}

function keyboardState(view: EditorView, apps: App[]): KeyboardState {
  const { state } = view;
  const stops = stopsOf(state.doc.toString(), apps);
  const head = state.selection.main.head;
  return {
    active: true,
    completions:
      completionStatus(state) === "active"
        ? currentCompletions(state)
            .slice(0, MAX_COMPLETIONS)
            .map((completion) => completion.label)
        : [],
    fields: stops.length,
    canPrev: hop(stops, head, false) !== undefined,
    canNext: hop(stops, head, true) !== undefined,
    canUndo: undoDepth(state) > 0,
  };
}

let focused: { view: EditorView; apps: () => App[] } | undefined;
let posted = JSON.stringify(INACTIVE);

/** Called on every update of an editor the keyboard serves; only what changed is sent. */
export function syncNativeKeyboard(view: EditorView, apps: () => App[]): void {
  if (view.hasFocus) focused = { view, apps };
  else if (focused?.view === view) focused = undefined;
  else return;
  const message = JSON.stringify(focused ? keyboardState(view, apps()) : INACTIVE);
  if (message === posted) return;
  posted = message;
  handler()?.postMessage(message);
}

export function releaseNativeKeyboard(view: EditorView): void {
  if (focused?.view !== view) return;
  focused = undefined;
  posted = JSON.stringify(INACTIVE);
  handler()?.postMessage(posted);
}

function type(view: EditorView, text: string) {
  const bracket = text.length === 1 ? insertBracket(view.state, text) : null;
  if (bracket) view.dispatch(bracket);
  else view.dispatch(view.state.replaceSelection(text), { scrollIntoView: true, userEvent: "input.type" });
  if (text === ".") startCompletion(view);
}

function goToField(view: EditorView, apps: App[], forward: boolean) {
  const stops = stopsOf(view.state.doc.toString(), apps);
  const next = hop(stops, view.state.selection.main.head, forward);
  if (next === undefined) return;
  const { from, to } = stops[next];
  view.dispatch({ selection: { anchor: from, head: to }, scrollIntoView: true, userEvent: "select" });
}

export function press(action: string, argument?: string | number): void {
  if (!focused) return;
  const { view, apps } = focused;
  switch (action) {
    case "type":
      if (typeof argument === "string") type(view, argument);
      break;
    case "complete":
      if (typeof argument !== "number") break;
      view.dispatch({ effects: setSelectedCompletion(argument) });
      acceptCompletion(view);
      break;
    case "prev":
    case "next":
      goToField(view, apps(), action === "next");
      break;
    case "indent":
      indentMore(view);
      break;
    case "left":
      cursorCharLeft(view);
      break;
    case "right":
      cursorCharRight(view);
      break;
    case "undo":
      undo(view);
      break;
    case "backspace":
      if (!deleteBracketPair(view)) deleteCharBackward(view);
      break;
  }
}

if (typeof window !== "undefined") (window as unknown as { kajaKeyboard: { press: typeof press } }).kajaKeyboard = { press };
