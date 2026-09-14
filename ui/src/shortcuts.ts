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

/**
 * Where a row applies, in the app's own nouns and no others. It is a closed set
 * because the scope column is read down rather than across: two rows saying the same
 * thing in two wordings read as two different answers.
 */
export type ShortcutScope = "Anywhere" | "In a run" | "In the console" | "In Files" | "On a draft" | "On a file" | "In app settings";

export interface ShortcutDefinition {
  action: ShortcutAction;
  label: string;
  group: ShortcutGroup;
  // What the window answers to with nothing configured. More than one only where a
  // key from somewhere else is honoured beside kaja's own, which is F5 for Run.
  defaults: string[];
  // Stated on every row, `Anywhere` included: an empty cell would have to mean
  // global, and a cell that means something by being empty is one you have to be
  // told about.
  scope: ShortcutScope;
  // The verb this key presses writes a file, so it is not there at all on a workspace
  // that is served read-only — the same rule that takes Save as file off the command
  // row rather than disabling it.
  writesFiles?: boolean;
}

export const SHORTCUT_GROUPS: ShortcutGroup[] = ["Window", "Scripts", "Running"];

/**
 * Zoom is not here. `⌘+`, `⌘-` and `⌘0` exist on the desktop to do what a browser
 * already does with them, so a rebind would make the two builds disagree about keys
 * nobody chose in the first place.
 */
export const SHORTCUTS: ShortcutDefinition[] = [
  { action: "finder", label: "Find a call, file or view", group: "Window", defaults: ["Mod+P"], scope: "Anywhere" },
  { action: "toggleSidebar", label: "Show or hide the sidebar", group: "Window", defaults: ["Mod+B"], scope: "Anywhere" },
  { action: "fullScreenRun", label: "Full-screen run", group: "Window", defaults: ["Mod+Shift+F"], scope: "In a run" },
  { action: "newDraft", label: "New script", group: "Scripts", defaults: ["Mod+N"], scope: "Anywhere" },
  { action: "newFolder", label: "New folder", group: "Scripts", defaults: ["Mod+Shift+N"], scope: "In Files", writesFiles: true },
  { action: "saveAsFile", label: "Save as file", group: "Scripts", defaults: ["Mod+S"], scope: "On a draft", writesFiles: true },
  { action: "copyDeeplink", label: "Copy deeplink", group: "Scripts", defaults: ["Mod+Shift+C"], scope: "On a file" },
  { action: "editAsJson", label: "Edit as JSON", group: "Scripts", defaults: ["Mod+J"], scope: "In app settings" },
  { action: "run", label: "Run", group: "Running", defaults: ["Mod+Enter", "F5"], scope: "Anywhere" },
  { action: "runWithParameters", label: "Run with parameters", group: "Running", defaults: ["Mod+Shift+Enter"], scope: "Anywhere" },
  { action: "previousRun", label: "Previous run", group: "Running", defaults: ["Ctrl+ArrowUp"], scope: "Anywhere" },
  { action: "nextRun", label: "Next run", group: "Running", defaults: ["Ctrl+ArrowDown"], scope: "Anywhere" },
];

const DEFINITION = new Map(SHORTCUTS.map((shortcut) => [shortcut.action, shortcut]));

export function shortcutDefinition(action: ShortcutAction): ShortcutDefinition {
  return DEFINITION.get(action)!;
}

/**
 * The rows worth showing. A key for a verb the workspace hasn't got is a key that
 * does nothing, and stating one is what the read-only screen exists not to do.
 */
export function listedShortcuts(canWriteFiles: boolean): ShortcutDefinition[] {
  return canWriteFiles ? SHORTCUTS : SHORTCUTS.filter((shortcut) => !shortcut.writesFiles);
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
 * Two scopes are in each other's way when both can be active at the moment a key is
 * pressed. `In Files` and `On a draft` can hold one chord between them and neither is
 * ambiguous; anything sharing a scope with `Anywhere` is.
 */
export function scopesOverlap(a: ShortcutScope, b: ShortcutScope): boolean {
  return a === "Anywhere" || b === "Anywhere" || a === b;
}

/**
 * Who else answers to this chord where the recording row would. The chord you just
 * pressed wins and these are what it takes it from, which is why this is asked at the
 * moment one is recorded rather than reported as a state the screen carries.
 */
export function collidingActions(bindings: Map<ShortcutAction, string[]>, action: ShortcutAction, binding: string): ShortcutAction[] {
  if (!binding) return [];
  const scope = shortcutDefinition(action).scope;
  const taken: ShortcutAction[] = [];
  for (const [other, list] of bindings) {
    if (other === action || !list.includes(binding)) continue;
    if (scopesOverlap(scope, shortcutDefinition(other).scope)) taken.push(other);
  }
  return taken;
}

// Chords the host takes before the page is offered them. The list is short on
// purpose: a chord kaja itself ships is evidently one that arrives, and refusing a
// chord that would in fact work is a worse answer than accepting one that won't.
const RESERVED_CHORDS = new Set(["Mod+W", "Mod+Q", "Mod+Tab", "Mod+Space"]);

/**
 * Why the chord just pressed cannot be this row's, or undefined where it can. The
 * recorder states it and goes on listening: a refusal is something to correct with
 * the keyboard you are already holding, not a reason to close the recorder.
 */
export function recordingRefusal(event: KeyboardEvent, mac = isMacPlatform()): string | undefined {
  const key = eventKey(event);
  if (key === undefined) return undefined;
  const held = eventModifiers(event, mac);
  if (held.has("Mod") && held.has("Ctrl")) return "⌃ and ⌘ are one key off a Mac, so a shortcut cannot hold both.";
  if (!FUNCTION_KEY.test(key) && (held.size === 0 || (held.size === 1 && held.has("Shift")))) {
    return mac ? "A shortcut needs ⌘, ⌥ or ⌃. Hold one and press a key." : "A shortcut needs Ctrl or Alt. Hold one and press a key.";
  }
  const binding = normalizeBinding([...held, key].join("+"));
  if (binding === undefined) return "That is not a chord Kaja can listen for.";
  if (RESERVED_CHORDS.has(binding)) return `${formatBinding(binding, mac)} belongs to the system, so Kaja never sees it.`;
  return undefined;
}

// The part of the chord that is still missing, which is what makes the chip a
// question rather than a value.
const PENDING_KEY = "…";

/**
 * The chord as far as it has been heard: the modifiers being held, with the key still
 * to come. Nothing is held yet reads as the ellipsis alone, so letting the modifiers
 * go empties the chip rather than committing what you let go of.
 */
export function formatPartialChord(event: KeyboardEvent, mac = isMacPlatform()): string {
  const held = eventModifiers(event, mac);
  if (held.size === 0) return PENDING_KEY;
  if (mac) {
    return (
      MAC_MODIFIER_ORDER.filter((modifier) => held.has(modifier))
        .map((modifier) => MAC_MODIFIER_SYMBOL[modifier])
        .join("") + ` ${PENDING_KEY}`
    );
  }
  return [...MODIFIERS.filter((modifier) => held.has(modifier)).map((modifier) => OTHER_MODIFIER_LABEL[modifier]), PENDING_KEY].join("+");
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
