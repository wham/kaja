import { expect, test } from "bun:test";
import {
  bindingConflicts,
  bindingFromEvent,
  eventMatchesBinding,
  formatBinding,
  normalizeBinding,
  resolveBindings,
  SHORTCUTS,
  type ShortcutAction,
} from "./shortcuts";

interface FakeKey {
  key: string;
  code?: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}

function press(event: FakeKey): KeyboardEvent {
  return { code: "", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...event } as KeyboardEvent;
}

test("a binding is written one way whatever order it was said in", () => {
  expect(normalizeBinding("shift+mod+n")).toBe("Mod+Shift+N");
  expect(normalizeBinding("Mod+Shift+N")).toBe("Mod+Shift+N");
  expect(normalizeBinding("Ctrl+arrowup")).toBe("Ctrl+ArrowUp");
  expect(normalizeBinding("mod+enter")).toBe("Mod+Enter");
  expect(normalizeBinding("f5")).toBe("F5");
});

test("a chord that would fire while typing is not a binding", () => {
  expect(normalizeBinding("N")).toBeUndefined();
  expect(normalizeBinding("Shift+N")).toBeUndefined();
  expect(normalizeBinding("Mod")).toBeUndefined();
  expect(normalizeBinding("")).toBeUndefined();
  // Mod is Ctrl off a Mac, so holding both is one modifier said twice.
  expect(normalizeBinding("Mod+Ctrl+N")).toBeUndefined();
  expect(normalizeBinding("Mod+N+P")).toBeUndefined();
});

test("a function key needs no modifier", () => {
  expect(normalizeBinding("F5")).toBe("F5");
  expect(normalizeBinding("Shift+F5")).toBe("Shift+F5");
});

test("the modifier set has to match exactly", () => {
  expect(eventMatchesBinding(press({ key: "n", metaKey: true }), "Mod+N", true)).toBe(true);
  // ⇧⌘N is the new folder, not the new script.
  expect(eventMatchesBinding(press({ key: "N", metaKey: true, shiftKey: true }), "Mod+N", true)).toBe(false);
  expect(eventMatchesBinding(press({ key: "N", metaKey: true, shiftKey: true }), "Mod+Shift+N", true)).toBe(true);
  // ⌃↑ steps through the runs; ⌘↑ is not it.
  expect(eventMatchesBinding(press({ key: "ArrowUp", ctrlKey: true }), "Ctrl+ArrowUp", true)).toBe(true);
  expect(eventMatchesBinding(press({ key: "ArrowUp", metaKey: true }), "Ctrl+ArrowUp", true)).toBe(false);
});

test("Mod is the platform's own command key", () => {
  expect(eventMatchesBinding(press({ key: "p", metaKey: true }), "Mod+P", true)).toBe(true);
  expect(eventMatchesBinding(press({ key: "p", ctrlKey: true }), "Mod+P", true)).toBe(false);
  expect(eventMatchesBinding(press({ key: "p", ctrlKey: true }), "Mod+P", false)).toBe(true);
});

test("off a Mac there is no Ctrl beside Mod", () => {
  expect(eventMatchesBinding(press({ key: "ArrowUp", ctrlKey: true }), "Ctrl+ArrowUp", false)).toBe(true);
});

test("⌥ on macOS rewrites the key, so the physical one answers for it", () => {
  expect(bindingFromEvent(press({ key: "˜", code: "KeyN", metaKey: true, altKey: true }), true)).toBe("Mod+Alt+N");
  expect(bindingFromEvent(press({ key: "!", code: "Digit1", metaKey: true, shiftKey: true }), true)).toBe("Mod+Shift+1");
});

test("a modifier on its own is not a chord to record", () => {
  expect(bindingFromEvent(press({ key: "Meta", metaKey: true }), true)).toBeUndefined();
  expect(bindingFromEvent(press({ key: "Shift", shiftKey: true }), true)).toBeUndefined();
  expect(bindingFromEvent(press({ key: "n" }), true)).toBeUndefined();
});

test("what a recorder heard is what the matcher answers to", () => {
  const event = press({ key: "K", metaKey: true, shiftKey: true });
  const binding = bindingFromEvent(event, true)!;
  expect(binding).toBe("Mod+Shift+K");
  expect(eventMatchesBinding(event, binding, true)).toBe(true);
});

test("a Mac draws the modifiers in its own order", () => {
  expect(formatBinding("Mod+Shift+N", true)).toBe("⇧⌘N");
  expect(formatBinding("Mod+Enter", true)).toBe("⌘⏎");
  expect(formatBinding("Ctrl+ArrowUp", true)).toBe("⌃↑");
  expect(formatBinding("Mod+Shift+N", false)).toBe("Ctrl+Shift+N");
  expect(formatBinding("Ctrl+ArrowUp", false)).toBe("Ctrl+↑");
  expect(formatBinding("F5", true)).toBe("F5");
  expect(formatBinding("", true)).toBe("");
});

test("an action nothing names keeps what kaja ships", () => {
  const bindings = resolveBindings({});
  expect(bindings.get("run")).toEqual(["Mod+Enter", "F5"]);
  expect(bindings.get("finder")).toEqual(["Mod+P"]);
});

test("an override replaces the set rather than adding to it", () => {
  const bindings = resolveBindings({ run: "Mod+R" });
  expect(bindings.get("run")).toEqual(["Mod+R"]);
});

test("an empty override is an action deliberately left without a key", () => {
  expect(resolveBindings({ finder: "" }).get("finder")).toEqual([]);
  // So is one nothing can be made of.
  expect(resolveBindings({ finder: "Shift" }).get("finder")).toEqual([]);
});

test("an override is read in whatever spelling the file carries", () => {
  expect(resolveBindings({ finder: "shift+mod+k" }).get("finder")).toEqual(["Mod+Shift+K"]);
});

test("two actions on one chord are reported to both", () => {
  const conflicts = bindingConflicts(resolveBindings({ finder: "Mod+B" }));
  expect(conflicts.get("finder")).toEqual(["toggleSidebar"]);
  expect(conflicts.get("toggleSidebar")).toEqual(["finder"]);
  expect(conflicts.get("run")).toBeUndefined();
});

test("what kaja ships collides with nothing", () => {
  expect([...bindingConflicts(resolveBindings(undefined)).keys()]).toEqual([]);
});

test("every action is named once and every default is canonical", () => {
  const actions = new Set<ShortcutAction>();
  for (const shortcut of SHORTCUTS) {
    expect(actions.has(shortcut.action)).toBe(false);
    actions.add(shortcut.action);
    expect(shortcut.defaults.length).toBeGreaterThan(0);
    for (const binding of shortcut.defaults) expect(normalizeBinding(binding)).toBe(binding);
  }
});
