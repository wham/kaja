import { useSyncExternalStore } from "react";

/**
 * Every key the window states, in one table. A shortcut is a workspace's own
 * (`shortcuts` in kaja.json) rather than this machine's, so a kaja served to a
 * browser can ship the keys it wants and a checkout carries them.
 *
 * The bindings in the file are overrides and nothing else: an action nothing names
 * keeps what kaja ships, so a workspace that has never opened this view writes
 * nothing. An action named with an empty binding is one deliberately left without a
 * key.
 */

export type ShortcutAction =
  | "finder"
  | "toggleSidebar"
  | "fullScreenRun"
  | "newDraft"
  | "newFolder"
  | "saveAsFile"
  | "copyDeeplink"
  | "editAsJson"
  | "run"
  | "runWithParameters"
  | "previousRun"
  | "nextRun";

export type ShortcutGroup = "Window" | "Scripts" | "Running";

export interface ShortcutDefinition {
  action: ShortcutAction;
  label: string;
  group: ShortcutGroup;
  // What the window answers to with nothing configured. More than one only where a
  // key from somewhere else is honoured beside kaja's own, which is F5 for Run.
  defaults: string[];
  // Where the action is: a row that says only its name reads as a key that works
  // wherever you are, which most of these are not.
  where?: string;
}

export const SHORTCUT_GROUPS: ShortcutGroup[] = ["Window", "Scripts", "Running"];

/**
 * Zoom is not here. `⌘+`, `⌘-` and `⌘0` exist on the desktop to do what a browser
 * already does with them, so a rebind would make the two builds disagree about keys
 * nobody chose in the first place.
 */
export const SHORTCUTS: ShortcutDefinition[] = [
  { action: "finder", label: "Find a call, file or view", group: "Window", defaults: ["Mod+P"] },
  { action: "toggleSidebar", label: "Show or hide the sidebar", group: "Window", defaults: ["Mod+B"] },
  { action: "fullScreenRun", label: "Full-screen run", group: "Window", defaults: ["Mod+Shift+F"], where: "In a run" },
  { action: "newDraft", label: "New script", group: "Scripts", defaults: ["Mod+N"] },
  { action: "newFolder", label: "New folder", group: "Scripts", defaults: ["Mod+Shift+N"], where: "In Files" },
  { action: "saveAsFile", label: "Save as file", group: "Scripts", defaults: ["Mod+S"], where: "On a draft" },
  { action: "copyDeeplink", label: "Copy deeplink", group: "Scripts", defaults: ["Mod+Shift+C"], where: "On a file" },
  { action: "editAsJson", label: "Edit as JSON", group: "Scripts", defaults: ["Mod+J"], where: "In app settings" },
  { action: "run", label: "Run", group: "Running", defaults: ["Mod+Enter", "F5"] },
  { action: "runWithParameters", label: "Run with parameters", group: "Running", defaults: ["Mod+Shift+Enter"] },
  { action: "previousRun", label: "Previous run", group: "Running", defaults: ["Ctrl+ArrowUp"] },
  { action: "nextRun", label: "Next run", group: "Running", defaults: ["Ctrl+ArrowDown"] },
];

const DEFINITION = new Map(SHORTCUTS.map((shortcut) => [shortcut.action, shortcut]));

export function shortcutDefinition(action: ShortcutAction): ShortcutDefinition {
  return DEFINITION.get(action)!;
}

// `Mod` is the platform's own command modifier — ⌘ on a Mac, Ctrl everywhere else —
// which is why a binding recorded on one machine works on the other. `Ctrl` beside it
// is the literal key, and it means the same thing as `Mod` off a Mac.
const MODIFIERS = ["Mod", "Ctrl", "Alt", "Shift"] as const;
type Modifier = (typeof MODIFIERS)[number];

export function isMacPlatform(): boolean {
  return typeof navigator !== "undefined" && navigator.platform.startsWith("Mac");
}

const FUNCTION_KEY = /^F([1-9]|1[0-2])$/;

/**
 * The canonical form of a binding: the modifiers in one order, then the key. Written
 * to kaja.json and compared as a string, so a binding is equal to another exactly
 * when the two are the same chord.
 */
export function normalizeBinding(binding: string): string | undefined {
  const parts = binding
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return undefined;

  const held = new Set<Modifier>();
  let key: string | undefined;
  for (const part of parts) {
    const modifier = MODIFIERS.find((candidate) => candidate.toLowerCase() === part.toLowerCase());
    if (modifier) {
      held.add(modifier);
      continue;
    }
    // Two keys in one chord is not a chord.
    if (key !== undefined) return undefined;
    key = normalizeKey(part);
  }
  if (key === undefined) return undefined;
  // Mod is Ctrl off a Mac, so a chord holding both is one modifier said twice.
  if (held.has("Mod") && held.has("Ctrl")) return undefined;
  // Shift alone leaves the letters, which is typing.
  if (held.size === 0 && !FUNCTION_KEY.test(key)) return undefined;
  if (held.size === 1 && held.has("Shift") && !FUNCTION_KEY.test(key)) return undefined;

  return [...MODIFIERS.filter((modifier) => held.has(modifier)), key].join("+");
}

const NAMED_KEYS = [
  "Enter",
  "Escape",
  "Tab",
  "Backspace",
  "Delete",
  "Space",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
];

function normalizeKey(key: string): string {
  if (key === " ") return "Space";
  const named = NAMED_KEYS.find((candidate) => candidate.toLowerCase() === key.toLowerCase());
  if (named) return named;
  if (FUNCTION_KEY.test(key.toUpperCase())) return key.toUpperCase();
  if (key.length === 1) return key.toUpperCase();
  return key;
}

/**
 * The key an event is about. `event.key` is what the person typed, which is what a
 * binding should be written in — but ⌥ on macOS rewrites it into whatever the option
 * layer produces (`⌥N` arrives as `˜`), so anything that is not a letter or a digit
 * falls back to the physical key.
 */
function eventKey(event: KeyboardEvent): string | undefined {
  const key = event.key;
  if (key === "Meta" || key === "Control" || key === "Alt" || key === "Shift") return undefined;
  if (/^[A-Za-z0-9]$/.test(key)) return key.toUpperCase();

  const code = event.code ?? "";
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  return normalizeKey(key);
}

function eventModifiers(event: KeyboardEvent, mac: boolean): Set<Modifier> {
  const held = new Set<Modifier>();
  if (mac) {
    if (event.metaKey) held.add("Mod");
    if (event.ctrlKey) held.add("Ctrl");
  } else if (event.ctrlKey || event.metaKey) {
    held.add("Mod");
  }
  if (event.altKey) held.add("Alt");
  if (event.shiftKey) held.add("Shift");
  return held;
}

function bindingModifiers(binding: string, mac: boolean): Set<Modifier> {
  const held = new Set<Modifier>();
  for (const part of binding.split("+")) {
    const modifier = MODIFIERS.find((candidate) => candidate === part);
    // Off a Mac there is no Ctrl beside Mod: they are the one key.
    if (modifier) held.add(!mac && modifier === "Ctrl" ? "Mod" : modifier);
  }
  return held;
}

function bindingKey(binding: string): string {
  return binding.split("+").pop() ?? "";
}

/**
 * The modifier set has to match exactly, so ⇧⌘N is not ⌘N and ⌃↑ is not ⌘↑. It is
 * what lets two chords over one key be two shortcuts.
 */
export function eventMatchesBinding(event: KeyboardEvent, binding: string, mac = isMacPlatform()): boolean {
  if (!binding) return false;
  const key = eventKey(event);
  if (key === undefined || key !== bindingKey(binding)) return false;

  const held = eventModifiers(event, mac);
  const wanted = bindingModifiers(binding, mac);
  return held.size === wanted.size && [...wanted].every((modifier) => held.has(modifier));
}

/**
 * The binding a keypress writes, for the view that records one. Modifier-only
 * presses and chords that would fire while typing come back undefined, which is what
 * keeps the recorder waiting for a real one.
 */
export function bindingFromEvent(event: KeyboardEvent, mac = isMacPlatform()): string | undefined {
  const key = eventKey(event);
  if (key === undefined) return undefined;
  const held = eventModifiers(event, mac);
  return normalizeBinding([...held, key].join("+"));
}

const MAC_MODIFIER_SYMBOL: Record<Modifier, string> = { Ctrl: "⌃", Alt: "⌥", Shift: "⇧", Mod: "⌘" };
// What macOS draws them in, which is not the order they are written in.
const MAC_MODIFIER_ORDER: Modifier[] = ["Ctrl", "Alt", "Shift", "Mod"];
const OTHER_MODIFIER_LABEL: Record<Modifier, string> = { Ctrl: "Ctrl", Alt: "Alt", Shift: "Shift", Mod: "Ctrl" };

const KEY_SYMBOL: Record<string, string> = {
  Enter: "⏎",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  Escape: "Esc",
  Backspace: "⌫",
  Delete: "⌦",
  Tab: "⇥",
};

export function formatBinding(binding: string, mac = isMacPlatform()): string {
  if (!binding) return "";
  const key = bindingKey(binding);
  const label = KEY_SYMBOL[key] ?? key;
  const held = bindingModifiers(binding, mac);
  if (mac) {
    return MAC_MODIFIER_ORDER.filter((modifier) => held.has(modifier))
      .map((modifier) => MAC_MODIFIER_SYMBOL[modifier])
      .join("")
      .concat(label);
  }
  return [...MODIFIERS.filter((modifier) => held.has(modifier)).map((modifier) => OTHER_MODIFIER_LABEL[modifier]), label].join("+");
}

/**
 * What each action answers to, defaults with the overrides laid over them. An
 * override is one binding: it replaces the set rather than adding to it, so what the
 * row says is the whole of what the key does.
 */
export function resolveBindings(overrides: { [key: string]: string } | undefined): Map<ShortcutAction, string[]> {
  const resolved = new Map<ShortcutAction, string[]>();
  for (const shortcut of SHORTCUTS) {
    const override = overrides?.[shortcut.action];
    if (override === undefined) {
      resolved.set(shortcut.action, shortcut.defaults);
      continue;
    }
    const normalized = normalizeBinding(override);
    resolved.set(shortcut.action, normalized ? [normalized] : []);
  }
  return resolved;
}

/**
 * Two actions on one chord, which is a shortcut that does whichever of the two the
 * window happens to ask about first. Reported per action, naming the other.
 */
export function bindingConflicts(bindings: Map<ShortcutAction, string[]>): Map<ShortcutAction, ShortcutAction[]> {
  const byBinding = new Map<string, ShortcutAction[]>();
  for (const [action, list] of bindings) {
    for (const binding of list) {
      byBinding.set(binding, [...(byBinding.get(binding) ?? []), action]);
    }
  }

  const conflicts = new Map<ShortcutAction, ShortcutAction[]>();
  for (const actions of byBinding.values()) {
    if (actions.length < 2) continue;
    for (const action of actions) {
      const others = actions.filter((candidate) => candidate !== action);
      conflicts.set(action, [...(conflicts.get(action) ?? []), ...others]);
    }
  }
  return conflicts;
}

// The overrides the window is running, kept beside the configuration the way the
// variables registry is, so a keydown handler never has to be handed them.
let bindings = resolveBindings(undefined);
let version = 0;
const listeners = new Set<() => void>();

export function setShortcutOverrides(overrides: { [key: string]: string } | undefined): void {
  const next = resolveBindings(overrides);
  const changed = SHORTCUTS.some((shortcut) => (bindings.get(shortcut.action) ?? []).join(" ") !== (next.get(shortcut.action) ?? []).join(" "));
  if (!changed) return;
  bindings = next;
  version++;
  for (const listener of listeners) listener();
}

export function bindingsFor(action: ShortcutAction): string[] {
  return bindings.get(action) ?? [];
}

/** Whether a keypress is this action's. The one question every handler asks. */
export function matchesShortcut(event: KeyboardEvent, action: ShortcutAction): boolean {
  return bindingsFor(action).some((binding) => eventMatchesBinding(event, binding));
}

/** The chord as it is shown in a menu or beside a button. Empty where there is none. */
export function shortcutLabel(action: ShortcutAction): string {
  const binding = bindingsFor(action)[0];
  return binding ? formatBinding(binding) : "";
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Every chord the window claims, for whatever else in the page also wants them. */
export function claimedBindings(): string[] {
  return [...bindings.values()].flat();
}

export { subscribe as subscribeShortcuts };

function snapshot(): number {
  return version;
}

/**
 * The label, for the components that draw one. It is a hook because rebinding a key
 * has to redraw every place that names it.
 */
export function useShortcutLabel(action: ShortcutAction): string {
  useSyncExternalStore(subscribe, snapshot, snapshot);
  return shortcutLabel(action);
}

export function useShortcutBindings(): Map<ShortcutAction, string[]> {
  useSyncExternalStore(subscribe, snapshot, snapshot);
  return bindings;
}
