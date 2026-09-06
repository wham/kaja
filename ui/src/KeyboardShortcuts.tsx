import { RotateCcw, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "./cn";
import { Button } from "./components/button";
import { IconButton } from "./components/icon-button";
import { rpcErrorMessage } from "./rpcMessage";
import {
  bindingConflicts,
  bindingFromEvent,
  formatBinding,
  isMacPlatform,
  resolveBindings,
  SHORTCUT_GROUPS,
  SHORTCUTS,
  shortcutDefinition,
  type ShortcutAction,
} from "./shortcuts";

const AUTOSAVE_MS = 600;

// Record is the row's one verb and stays; the two that undo it are the cursor's, so
// twelve rows are twelve chords rather than thirty-six buttons.
const revealed = "opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100";

interface KeyboardShortcutsProps {
  shortcuts: { [key: string]: string };
  readOnly?: boolean;
  onSave: (shortcuts: { [key: string]: string }) => Promise<void>;
}

/**
 * Every key the window states, with the one thing you can do to it. It is a table
 * rather than a list because the answer for a row is one chord, and a chord you
 * cannot see is one you cannot check for a collision.
 *
 * **A key is recorded, not typed.** A field taking `Mod+Shift+N` as text would be a
 * grammar to learn for a value the keyboard can say itself, and it would take
 * spellings the matcher does not — so Record listens for the next chord and the row
 * shows what it heard. Recording is the only mode: nothing else here can be edited.
 *
 * **The default is the absence of an override**, so Reset removes the row's entry
 * rather than writing the shipped chord into the file. What kaja.json carries is
 * what this workspace disagreed with, which is what makes it worth committing.
 */
export function KeyboardShortcuts({ shortcuts, readOnly = false, onSave }: KeyboardShortcutsProps) {
  const [overrides, setOverrides] = useState<{ [key: string]: string }>(() => ({ ...shortcuts }));
  const [recording, setRecording] = useState<ShortcutAction | null>(null);
  const [saving, setSaving] = useState(false);
  const onSaveRef = useRef(onSave);
  const dirtyRef = useRef(false);
  onSaveRef.current = onSave;

  const mac = isMacPlatform();

  // An external write — the file edited by hand, another window — is adopted only
  // while this table holds nothing of its own, on the rule the variables table
  // follows: what you are in the middle of typing outranks what arrived.
  useEffect(() => {
    if (!dirtyRef.current) setOverrides({ ...shortcuts });
  }, [shortcuts]);

  const bindings = useMemo(() => resolveBindings(overrides), [overrides]);
  const conflicts = useMemo(() => bindingConflicts(bindings), [bindings]);

  const dirty = !sameOverrides(overrides, shortcuts);
  dirtyRef.current = dirty;

  useEffect(() => {
    if (readOnly || !dirty || saving) return;
    const timer = setTimeout(() => {
      const snapshot = overrides;
      setSaving(true);
      void onSaveRef
        .current(snapshot)
        .catch((error) => console.error(`Saving keyboard shortcuts failed: ${rpcErrorMessage(error)}`))
        .finally(() => setSaving(false));
    }, AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [dirty, overrides, readOnly, saving]);

  // The recorder holds the keyboard for as long as it is open: a chord it is
  // listening for is one every other handler in the window would otherwise act on
  // too, so ⌘S while recording must not open the save sheet behind it.
  useEffect(() => {
    if (recording === null) return;
    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") {
        setRecording(null);
        return;
      }
      const binding = bindingFromEvent(event, mac);
      if (!binding) return;
      setOverrides((current) => ({ ...current, [recording]: binding }));
      setRecording(null);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [mac, recording]);

  const reset = (action: ShortcutAction) => {
    setOverrides((current) => {
      if (!(action in current)) return current;
      const next = { ...current };
      delete next[action];
      return next;
    });
  };

  const clear = (action: ShortcutAction) => {
    setOverrides((current) => ({ ...current, [action]: "" }));
  };

  const resetAll = () => setOverrides({});

  return (
    <div className="flex h-full flex-col overflow-auto bg-background px-4 pt-3.5">
      <div className="flex shrink-0 items-center gap-3 pb-3">
        <p className="m-0 min-w-0 flex-1 text-xs text-muted-foreground">
          {readOnly
            ? "This configuration is read-only. These are the keys this workspace ships."
            : "A key is this workspace's, not this machine's: it is written to kaja.json and travels with it."}
        </p>
        {!readOnly && Object.keys(overrides).length > 0 && (
          <Button size="sm" variant="outline" onClick={resetAll}>
            Reset all
          </Button>
        )}
      </div>

      {SHORTCUT_GROUPS.map((group) => (
        <section key={group} aria-label={group} className="shrink-0 pb-3">
          <h2 className="m-0 flex h-[26px] items-center px-1 text-xs font-medium text-foreground">{group}</h2>
          {SHORTCUTS.filter((shortcut) => shortcut.group === group).map((shortcut) => (
            <ShortcutRow
              key={shortcut.action}
              label={shortcut.label}
              where={shortcut.where}
              bindings={bindings.get(shortcut.action) ?? []}
              overridden={shortcut.action in overrides}
              conflicts={conflicts.get(shortcut.action) ?? []}
              recording={recording === shortcut.action}
              readOnly={readOnly}
              mac={mac}
              onRecord={() => setRecording(shortcut.action)}
              onCancel={() => setRecording(null)}
              onReset={() => reset(shortcut.action)}
              onClear={() => clear(shortcut.action)}
            />
          ))}
        </section>
      ))}
    </div>
  );
}

interface ShortcutRowProps {
  label: string;
  where?: string;
  bindings: string[];
  overridden: boolean;
  conflicts: ShortcutAction[];
  recording: boolean;
  readOnly: boolean;
  mac: boolean;
  onRecord: () => void;
  onCancel: () => void;
  onReset: () => void;
  onClear: () => void;
}

function ShortcutRow({ label, where, bindings, overridden, conflicts, recording, readOnly, mac, onRecord, onCancel, onReset, onClear }: ShortcutRowProps) {
  // One line, the way every other dense list here is, and a caption under it only
  // where the row has something the chord itself does not say.
  const caption = conflicts.length > 0 ? `Also ${conflicts.map((action) => shortcutDefinition(action).label.toLowerCase()).join(", ")}.` : undefined;

  return (
    <div
      className={cn(
        "group flex flex-col justify-center border-b border-border px-1 transition-colors hover:bg-muted/40",
        caption ? "min-h-[52px] py-1.5" : "h-9",
      )}
    >
      <div className="flex items-center gap-3">
        <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">{label}</span>
        {where && <span className="shrink-0 text-xs text-muted-foreground">{where}</span>}

        <span className="flex w-[132px] shrink-0 items-center gap-1">
          {recording ? (
            <span className="rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 font-mono text-xs text-amber-600 dark:text-amber-400">
              Press a key
            </span>
          ) : bindings.length === 0 ? (
            <span className="text-xs text-muted-foreground">None</span>
          ) : (
            bindings.map((binding) => (
              <kbd
                key={binding}
                className={cn(
                  "rounded border px-1.5 py-0.5 font-mono text-xs",
                  conflicts.length > 0 ? "border-destructive/40 bg-destructive/10 text-destructive" : "border-border bg-muted text-foreground",
                )}
              >
                {formatBinding(binding, mac)}
              </kbd>
            ))
          )}
        </span>

        <span className="flex w-[132px] shrink-0 items-center justify-end gap-1">
          {readOnly ? null : recording ? (
            <Button size="sm" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
          ) : (
            <>
              <Button size="sm" variant="outline" onClick={onRecord}>
                Record
              </Button>
              {bindings.length > 0 && (
                <IconButton
                  size="xs"
                  variant="ghost"
                  tooltip="native"
                  icon={X}
                  aria-label={`Leave ${label.toLowerCase()} without a shortcut`}
                  onClick={onClear}
                  className={revealed}
                />
              )}
              {overridden && (
                <IconButton
                  size="xs"
                  variant="ghost"
                  tooltip="native"
                  icon={RotateCcw}
                  aria-label={`Reset ${label.toLowerCase()}`}
                  onClick={onReset}
                  className={revealed}
                />
              )}
            </>
          )}
        </span>
      </div>
      {caption && <span className="pt-1 text-xs text-destructive">{caption}</span>}
    </div>
  );
}

function sameOverrides(a: { [key: string]: string }, b: { [key: string]: string }): boolean {
  const names = Object.keys(a);
  return names.length === Object.keys(b).length && names.every((name) => name in b && a[name] === b[name]);
}
