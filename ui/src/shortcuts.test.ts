import { expect, test } from "bun:test";
import {
  collidingActions,
  bindingFromEvent,
  eventMatchesBinding,
  formatBinding,
  formatPartialChord,
  listedShortcuts,
  normalizeBinding,
  recordingRefusal,
  resolveBindings,
  scopesOverlap,
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

test("the chord you just pressed takes it from whoever answered to it", () => {
  const bindings = resolveBindings({});
  expect(collidingActions(bindings, "finder", "Mod+B")).toEqual(["toggleSidebar"]);
  // Nothing else answers to it, so nothing is taken.
  expect(collidingActions(bindings, "finder", "Mod+K")).toEqual([]);
  // Removing a key takes nothing from anyone.
  expect(collidingActions(bindings, "finder", "")).toEqual([]);
});

test("scopes that cannot both be active are not a conflict", () => {
  expect(scopesOverlap("In Files", "On a draft")).toBe(false);
  expect(scopesOverlap("In Files", "In Files")).toBe(true);
  expect(scopesOverlap("Anywhere", "On a file")).toBe(true);
  // ⇧⌘N is New folder's; Save as file may hold it too, since the two are never both
  // the thing the window is on.
  expect(collidingActions(resolveBindings({}), "saveAsFile", "Mod+Shift+N")).toEqual([]);
  // Whereas anything the finder holds is held everywhere.
  expect(collidingActions(resolveBindings({}), "newFolder", "Mod+P")).toEqual(["finder"]);
});

test("a chord that cannot be a shortcut says why, and one that can says nothing", () => {
  expect(recordingRefusal(press({ key: "n" }), true)).toContain("needs");
  expect(recordingRefusal(press({ key: "N", shiftKey: true }), true)).toContain("needs");
  expect(recordingRefusal(press({ key: "w", metaKey: true }), true)).toContain("belongs to the system");
  expect(recordingRefusal(press({ key: "n", metaKey: true, ctrlKey: true }), true)).toContain("one key off a Mac");
  // F5 is why a bare function key is allowed.
  expect(recordingRefusal(press({ key: "F5" }), true)).toBeUndefined();
  expect(recordingRefusal(press({ key: "k", metaKey: true }), true)).toBeUndefined();
  // A modifier on its own is the chip filling in, not a refusal.
  expect(recordingRefusal(press({ key: "Meta", metaKey: true }), true)).toBeUndefined();
});

test("the chip echoes what is held and says what is still missing", () => {
  expect(formatPartialChord(press({ key: "Meta", metaKey: true, shiftKey: true }), true)).toBe("⇧⌘ …");
  expect(formatPartialChord(press({ key: "Meta" }), true)).toBe("…");
  expect(formatPartialChord(press({ key: "Control", ctrlKey: true }), false)).toBe("Ctrl+…");
});

test("what kaja ships takes nothing from anything else", () => {
  const bindings = resolveBindings(undefined);
  for (const shortcut of SHORTCUTS) {
    for (const binding of shortcut.defaults) expect(collidingActions(bindings, shortcut.action, binding)).toEqual([]);
  }
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

test("a key for a verb the workspace hasn't got is not listed", () => {
  const listed = listedShortcuts(false).map((shortcut) => shortcut.action);
  expect(listed).not.toContain("newFolder");
  expect(listed).not.toContain("saveAsFile");
  // Everything that is not a write is still there — a deployed kaja still runs,
  // finds and copies a deeplink.
  expect(listed).toContain("run");
  expect(listed).toContain("copyDeeplink");
  expect(listedShortcuts(true)).toEqual(SHORTCUTS);
});
