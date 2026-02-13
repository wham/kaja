# Tab State Persistence

## Current State

Tabs live in React `useState` and are lost on page reload. The existing IndexedDB storage (`storage.ts`) already persists UI preferences (sidebar width, editor layout, color mode) via debounced writes. Tab list, active tab index, editor content, and cursor positions are not persisted.

## What Can Be Stored

### Definitely storable

| State | Source | Notes |
|---|---|---|
| Open tab list (type + identity) | `TabModel[]` | Serialize tab type + references to project/service/method |
| Active tab index | `activeTabIndex` | Simple number |
| Editor content | `model.getValue()` | The actual TypeScript code the user has written/modified |
| Cursor position | `editor.getPosition()` | `{lineNumber, column}` - trivial to serialize |
| Scroll position | `editor.saveViewState()` | Monaco's `ICodeEditorViewState` includes scroll top/left |
| Folded regions | included in `saveViewState()` | Part of Monaco view state |
| Selection(s) | included in `saveViewState()` | Cursor + multi-cursor selections |
| `hasInteraction` flag | `TaskTab.hasInteraction` | Whether the tab is ephemeral |
| Console output | `ConsoleItem[]` | Could be stored but may not be worth it |

### Not worth storing

| State | Why |
|---|---|
| Definition tabs | Ephemeral by nature; always replaced on next click |
| Project form tabs | Transient editing state; forms should start fresh |
| Compiler tab | Stateless singleton; just re-add if it was open |

## Serialization Format

A single IndexedDB key `"tabs"` in the existing `ui-state` store:

```typescript
interface PersistedTabState {
  version: 1;
  activeIndex: number;
  tabs: PersistedTab[];
}

type PersistedTab =
  | PersistedTaskTab
  | PersistedCompilerTab;

interface PersistedTaskTab {
  type: "task";
  // References to reconstruct the tab identity
  projectName: string;
  serviceName: string;
  methodName: string;
  // Editor state
  code: string;              // current editor content
  originalCode: string;      // the generated code at tab creation
  hasInteraction: boolean;
  viewState?: object;        // monaco ICodeEditorViewState (cursor, scroll, folds, selections)
}

interface PersistedCompilerTab {
  type: "compiler";
}
```

## Monaco View State

Monaco has first-class support for this via `saveViewState()` / `restoreViewState()`. The view state object includes:

- **Cursor position** (line, column)
- **Selections** (including multi-cursor)
- **Scroll position** (top and left)
- **Folded regions**
- **Contributing editor states** (find widget state, etc.)

This is a plain object that serializes to JSON cleanly - no circular references, no class instances.

### How it works in the current architecture

The Editor component (`Editor.tsx`) creates and disposes a Monaco editor instance on every mount/unmount (the `useEffect` cleanup calls `editor.dispose()`). Tabs are rendered with `display: none` for inactive ones (`Tabs.tsx:234`), meaning **all tab components stay mounted** - but Monaco editors are created per-mount, so the editor instance persists while the tab is alive.

The key insight: **view state should be captured on tab switch (not just on unmount)**, since the editor instance is alive the whole time a tab exists. When persisting to IndexedDB, capture the current active editor's view state before writing.

## Implementation Approach

### 1. Capture view state on tab switch

In `App.tsx`, before switching `activeTabIndex`, call `saveViewState()` on the outgoing tab's editor and stash it on the `TabModel`. This requires adding a `viewState` field to `TaskTab` and a ref/callback to access the editor instance.

### 2. Persist on changes (debounced)

Use the existing `setPersistedValue()` with a new key `"tabs"`. Trigger writes when:
- Tab is opened/closed
- Active tab changes
- Editor content changes (already tracked via `hasInteraction`)
- Periodically (the debounce already handles batching)

### 3. Restore on app load

During `App.tsx` initialization (after `initializeStorage` resolves):
1. Read `getPersistedValue<PersistedTabState>("tabs")`
2. For each `PersistedTaskTab`, look up the project/service/method by name from the loaded configuration
3. If found: create a Monaco model with the stored `code`, create the `TaskTab`, stash the `viewState` for later restoration
4. If not found (project/method was deleted): skip that tab
5. Set `activeTabIndex` from stored state

### 4. Restore editor view state

When a tab's Editor mounts and the tab has a stored `viewState`, call `editor.restoreViewState(viewState)` instead of the current `revealLineInCenter` / `setPosition` logic.

## Edge Cases

- **Project renamed/deleted**: Match by name; if not found, drop the tab. The existing `App.tsx` logic (lines 259-299) already handles project renames for live tabs - the same approach applies to restoration.
- **Method signature changed**: The `originalCode` will differ from what `generateMethodEditorCode` produces. Restore the tab with the stored `code` anyway - the user modified it, so it should be preserved. Mark it as `hasInteraction: true`.
- **Storage quota**: A handful of tabs with TypeScript code is tiny (a few KB each). Not a concern.
- **Stale view state**: If Monaco version changes and view state format evolves, `restoreViewState` will silently ignore incompatible state. No crash risk.

## Scope

For a first pass, persist only **task tabs** and the **compiler tab** (open/closed). Definition tabs and project form tabs are intentionally excluded as transient. Console output is excluded too - it's a "nice to have" that adds significant complexity for little value.
