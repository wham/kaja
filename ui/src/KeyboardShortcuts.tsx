import { CircleAlert, Undo, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "./cn";
import { Button } from "./components/button";
import { ConfirmationDialog } from "./components/confirmation-dialog";
import { IconButton } from "./components/icon-button";
import { rpcErrorMessage } from "./rpcMessage";
import {
  bindingFromEvent,
  collidingActions,
  formatBinding,
  formatPartialChord,
  isMacPlatform,
  listedShortcuts,
  recordingRefusal,
  resolveBindings,
  SHORTCUT_GROUPS,
  shortcutDefinition,
  type ShortcutAction,
} from "./shortcuts";

const AUTOSAVE_MS = 600;
// Long enough to be seen at the moment the chord was refused, short enough that the
// chip is amber again by the time the next one is pressed.
const REFUSAL_FLASH_MS = 600;

type Overrides = { [key: string]: string };

/** What the recorder has heard so far. One row records at a time. */
interface Recording {
  action: ShortcutAction;
  // The modifiers being held, as the chip draws them: `⇧⌘ …`, or `…` with nothing down.
  partial: string;
  refusal?: string;
  flashing: boolean;
}

/** A chord that arrived somewhere it was already spoken for, and the way back. */
interface Takeover {
  action: ShortcutAction;
  from: string[];
  before: Overrides;
}

/** The one view-level verb, handed up to the CommandRow that draws it. */
export interface ResetAllControl {
  count: number;
  onReset: () => void;
}

interface KeyboardShortcutsProps {
  shortcuts: Overrides;
  // Whether the workspace's scripts folder may be written, which is what the two keys
  // that write a file are listed on.
  canWriteFiles: boolean;
  readOnly?: boolean;
  onSave: (shortcuts: Overrides) => Promise<void>;
  // Reset all lives in the CommandRow's action slot like every other view-level verb,
  // so the screen reports what the button should do rather than drawing it.
  onResetAllChange?: (control: ResetAllControl | undefined) => void;
}

/**
 * Every key the window states, with the one thing you can do to it. It is a table
 * rather than a list because the answer for a row is one chord, and a chord you
 * cannot see is one you cannot check against the one beside it.
 *
 * **Nothing sits above the first group heading.** The view is a list of commands and
 * their keys, and the CommandRow's title already says which list; a sentence about
 * where the keys are kept answers a question nobody has while standing between you
 * and what you came for.
 *
 * **A key is recorded, not typed.** A field taking `Mod+Shift+N` as text would be a
 * grammar to learn for a value the keyboard can say itself, and it would take
 * spellings the matcher does not — so Record listens for the next chord and the chip
 * echoes the modifiers as they are held. Recording is the only mode: nothing else
 * here can be edited.
 *
 * **The default is the absence of an override**, so revert removes the row's entry
 * rather than writing the shipped chord into the file. What kaja.json carries is
 * what this workspace disagreed with, which is what makes it worth committing.
 */
export function KeyboardShortcuts({ shortcuts, canWriteFiles, readOnly = false, onSave, onResetAllChange }: KeyboardShortcutsProps) {
  const [overrides, setOverrides] = useState<Overrides>(() => ({ ...shortcuts }));
  const [recording, setRecording] = useState<Recording | null>(null);
  const [takeover, setTakeover] = useState<Takeover | null>(null);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [saving, setSaving] = useState(false);
  const [body, setBody] = useState<HTMLElement | null>(null);
  const onSaveRef = useRef(onSave);
  const onResetAllRef = useRef(onResetAllChange);
  const dirtyRef = useRef(false);
  onSaveRef.current = onSave;
  onResetAllRef.current = onResetAllChange;

  const mac = isMacPlatform();

  // An external write — the file edited by hand, another window — is adopted only
  // while this table holds nothing of its own, on the rule the variables table
  // follows: what you are in the middle of typing outranks what arrived.
  useEffect(() => {
    if (!dirtyRef.current) setOverrides({ ...shortcuts });
  }, [shortcuts]);

  const listed = useMemo(() => listedShortcuts(canWriteFiles), [canWriteFiles]);
  const bindings = useMemo(() => resolveBindings(overrides), [overrides]);

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

  // A row is changed when what it answers to differs from what it shipped with,
  // rather than when the file happens to name it: an override spelling out the
  // default is the same key, and a revert icon over one would point at nothing. It is
  // the count the confirmation names and the answer to whether Reset all is live. A
  // row nothing lists is left out of both, since resetting all must not quietly drop
  // an override for a verb this workspace hasn't got.
  const changed = listed.filter((shortcut) => (bindings.get(shortcut.action) ?? []).join(" ") !== shortcut.defaults.join(" "));
  const changedActions = new Set(changed.map((shortcut) => shortcut.action));

  const resetAll = useCallback(() => setConfirmingReset(true), []);

  // Disabled rather than hidden: Reset all is the answer to "can I get back?", and
  // the answer has to be visible before anything is broken.
  useEffect(() => {
    const available = !readOnly && recording === null && changed.length > 0;
    onResetAllRef.current?.(available ? { count: changed.length, onReset: resetAll } : undefined);
  }, [changed.length, readOnly, recording, resetAll]);

  useEffect(() => () => onResetAllRef.current?.(undefined), []);

  const commit = (action: ShortcutAction, binding: string) => {
    const taken = collidingActions(bindings, action, binding).filter((other) => listed.some((shortcut) => shortcut.action === other));
    // The chord you just pressed wins and the rows it came from go to None, which
    // leaves each of their reverts standing: recoverable from its own row whether or
    // not the caption is read.
    const next: Overrides = { ...overrides, [action]: binding };
    for (const other of taken) next[other] = "";
    setOverrides(next);
    setTakeover(taken.length > 0 ? { action, from: taken.map((other) => shortcutDefinition(other).label), before: overrides } : null);
    setRecording(null);
  };

  // The recorder holds the keyboard for as long as it is open: a chord it is
  // listening for is one every other handler in the window would otherwise act on
  // too, so ⌘S while recording must not open the save sheet behind it. It states no
  // dependencies on purpose — `commit` reads the bindings and overrides of the render
  // it was made in, and re-subscribing per render is what keeps those current.
  useEffect(() => {
    if (recording === null) return;
    const action = recording.action;

    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") {
        setRecording(null);
        return;
      }
      // The remove icon's answer, reachable without letting go of the keyboard.
      if (event.key === "Backspace" && !event.metaKey && !event.ctrlKey && !event.altKey) {
        commit(action, "");
        return;
      }
      const partial = formatPartialChord(event, mac);
      const refusal = recordingRefusal(event, mac);
      if (refusal !== undefined) {
        setRecording({ action, partial, refusal, flashing: true });
        return;
      }
      const binding = bindingFromEvent(event, mac);
      // A modifier on its own is the chip filling in, not a chord.
      if (binding === undefined) {
        setRecording({ action, partial, flashing: false });
        return;
      }
      commit(action, binding);
    };

    const onKeyUp = (event: KeyboardEvent) => {
      setRecording((current) => (current === null ? current : { ...current, partial: formatPartialChord(event, mac) }));
    };

    const onPointerDown = () => setRecording(null);

    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("pointerdown", onPointerDown, true);
    };
  });

  useEffect(() => {
    if (recording === null || !recording.flashing) return;
    const timer = setTimeout(() => setRecording((current) => (current === null ? current : { ...current, flashing: false })), REFUSAL_FLASH_MS);
    return () => clearTimeout(timer);
  }, [recording]);

  const reset = (action: ShortcutAction) => {
    setOverrides((current) => {
      if (!(action in current)) return current;
      const next = { ...current };
      delete next[action];
      return next;
    });
  };

  const clear = (action: ShortcutAction) => setOverrides((current) => ({ ...current, [action]: "" }));

  const groups = SHORTCUT_GROUPS.map((group) => ({ group, rows: listed.filter((shortcut) => shortcut.group === group) })).filter(
    (entry) => entry.rows.length > 0,
  );

  return (
    <div ref={setBody} className="flex h-full flex-col overflow-auto bg-background pb-3">
      {groups.map(({ group, rows }, index) => (
        <section key={group} aria-label={group} className={cn("relative shrink-0", index > 0 && "border-t border-border", index < groups.length - 1 && "pb-5")}>
          <GroupHeading name={group} root={body} />
          {rows.map((shortcut) => (
            <ShortcutRow
              key={shortcut.action}
              label={shortcut.label}
              scope={shortcut.scope}
              bindings={bindings.get(shortcut.action) ?? []}
              defaults={shortcut.defaults}
              overridden={changedActions.has(shortcut.action)}
              recording={recording?.action === shortcut.action ? recording : undefined}
              takeover={takeover?.action === shortcut.action ? takeover : undefined}
              readOnly={readOnly}
              mac={mac}
              onRecord={() => {
                setTakeover(null);
                setRecording({ action: shortcut.action, partial: "…", flashing: false });
              }}
              onCancel={() => setRecording(null)}
              onReset={() => reset(shortcut.action)}
              onClear={() => clear(shortcut.action)}
              onUndoTakeover={() => {
                if (takeover) setOverrides(takeover.before);
                setTakeover(null);
              }}
              onDismissTakeover={() => setTakeover(null)}
            />
          ))}
        </section>
      ))}

      {confirmingReset && (
        <ConfirmationDialog
          title="Reset all shortcuts?"
          confirmButtonContent="Reset all"
          onClose={(gesture) => {
            setConfirmingReset(false);
            if (gesture !== "confirm") return;
            setTakeover(null);
            setOverrides((current) => {
              const next = { ...current };
              for (const shortcut of listed) delete next[shortcut.action];
              return next;
            });
          }}
        >
          {resetSentence(changed.length)}
        </ConfirmationDialog>
      )}
    </div>
  );
}

/**
 * The heading of the group you are in, held at the top of the body while you scroll
 * it, so the scope column is never unlabelled by context. The rule between two groups
 * is the group's own, so the heading wears a `border-b` only while it is standing in
 * for one that has scrolled away.
 */
function GroupHeading({ name, root }: { name: string; root: HTMLElement | null }) {
  const sentinel = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(false);

  useEffect(() => {
    const node = sentinel.current;
    if (node === null || root === null || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setStuck(!entry.isIntersecting), { root });
    observer.observe(node);
    return () => observer.disconnect();
  }, [root]);

  return (
    <>
      {/* Out of flow, so asking where the group's top edge is costs the layout nothing. */}
      <div ref={sentinel} aria-hidden className="pointer-events-none absolute left-0 top-0 h-px w-px" />
      <h2
        className={cn(
          "sticky top-0 z-10 m-0 flex h-7 items-center bg-background px-4 text-xs font-semibold text-foreground",
          stuck && "border-b border-border",
        )}
      >
        {name}
      </h2>
    </>
  );
}

interface ShortcutRowProps {
  label: string;
  scope: string;
  bindings: string[];
  defaults: string[];
  overridden: boolean;
  recording?: Recording;
  takeover?: Takeover;
  readOnly: boolean;
  mac: boolean;
  onRecord: () => void;
  onCancel: () => void;
  onReset: () => void;
  onClear: () => void;
  onUndoTakeover: () => void;
  onDismissTakeover: () => void;
}

// Both icons are revealed by the cursor and stay present for the keyboard. Revert is
// the exception that is always drawn once it is there: it is the change marker as
// well as the control, so a column of them down the right edge is the list of
// everything you have touched.
const revealed = "opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100";

function ShortcutRow({
  label,
  scope,
  bindings,
  defaults,
  overridden,
  recording,
  takeover,
  readOnly,
  mac,
  onRecord,
  onCancel,
  onReset,
  onClear,
  onUndoTakeover,
  onDismissTakeover,
}: ShortcutRowProps) {
  const notice = useRef<HTMLDivElement>(null);

  // The caption clears on the next click anywhere, the Undo inside it excepted: it is
  // a receipt for something already done, not a decision left open.
  useEffect(() => {
    if (takeover === undefined) return;
    const onClick = (event: MouseEvent) => {
      if (notice.current?.contains(event.target as Node)) return;
      onDismissTakeover();
    };
    window.addEventListener("click", onClick);
    return () => window.removeEventListener("click", onClick);
  }, [takeover, onDismissTakeover]);

  const caption = recording ? (recording.refusal ?? "Hold the modifiers and press a key. Esc cancels, ⌫ leaves it with no shortcut.") : undefined;
  const defaultLabel = defaults.length === 0 ? "no shortcut" : defaults.map((binding) => formatBinding(binding, mac)).join(" ");

  return (
    <div
      className={cn(
        "group flex flex-col justify-center px-4 transition-colors hover:bg-muted has-[:focus-visible]:bg-muted",
        recording && "bg-muted",
        caption !== undefined || takeover ? "h-[58px] gap-1" : "h-9",
      )}
    >
      <div className="flex items-center">
        <span className="min-w-0 flex-1 truncate text-sm text-foreground">{label}</span>
        <span className="shrink-0 text-right text-xs text-muted-foreground" style={{ width: 100 }}>
          {scope}
        </span>

        <span className="flex shrink-0 items-center gap-1 pl-4" style={{ width: 136 }}>
          {recording ? (
            <span
              className={cn(
                "inline-flex justify-center rounded-md border px-1.5 py-0.5 font-mono text-xs",
                recording.flashing
                  ? "border-destructive/40 bg-destructive/10 text-destructive"
                  : "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400",
              )}
              // A minimum, so the chip does not grow as the modifiers arrive.
              style={{ minWidth: 52 }}
            >
              {recording.partial}
            </span>
          ) : bindings.length === 0 ? (
            <span className="text-xs text-muted-foreground">None</span>
          ) : (
            bindings.map((binding) => (
              <kbd key={binding} className="rounded-md border border-input bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
                {formatBinding(binding, mac)}
              </kbd>
            ))
          )}
        </span>

        {!readOnly && (
          <>
            <span className="flex shrink-0 items-center" style={{ width: 80 }}>
              <Button size="sm" variant="outline" className="w-20 border-input bg-card" onClick={recording ? onCancel : onRecord}>
                {recording ? "Cancel" : "Record"}
              </Button>
            </span>
            {/* Two slots, held whether or not anything is in them, so setting a key
                never moves the button you were about to click. */}
            <span className="flex shrink-0 items-center justify-end gap-0.5" style={{ width: 60 }}>
              {!recording && overridden ? (
                <IconButton
                  size="sm"
                  variant="ghost"
                  icon={Undo}
                  aria-label={`Reset to ${defaultLabel}`}
                  onClick={onReset}
                  className="size-7 text-muted-foreground group-hover:text-foreground group-has-[:focus-visible]:text-foreground [&_svg]:size-[14px]"
                />
              ) : (
                <span className="size-7" />
              )}
              {!recording && bindings.length > 0 ? (
                <IconButton
                  size="sm"
                  variant="ghost"
                  icon={X}
                  aria-label="Remove shortcut"
                  onClick={onClear}
                  className={cn("size-7 [&_svg]:size-[14px]", revealed)}
                />
              ) : (
                <span className="size-7" />
              )}
            </span>
          </>
        )}
      </div>

      {caption !== undefined && <span className={cn("text-xs", recording?.refusal ? "text-destructive" : "text-muted-foreground")}>{caption}</span>}
      {caption === undefined && takeover && (
        <div ref={notice} className="flex items-center gap-2">
          <CircleAlert size={12} className="shrink-0 text-amber-600 dark:text-amber-400" />
          <span className="min-w-0 truncate text-xs text-amber-600 dark:text-amber-400">
            Taken from {joinLabels(takeover.from)}, which now {takeover.from.length === 1 ? "has" : "have"} no shortcut.
          </span>
          <button type="button" className="shrink-0 text-xs font-medium text-foreground hover:underline" onClick={onUndoTakeover}>
            Undo
          </button>
        </div>
      )}
    </div>
  );
}

function joinLabels(labels: string[]): string {
  if (labels.length < 2) return labels.join("");
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

// The dialog names how many rows go back, never which: the revert icons in the list
// already point at those. The table is twelve rows, so the words never run out.
const COUNT_WORDS = ["no", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve"];

function resetSentence(count: number): string {
  const many = `${COUNT_WORDS[count] ?? count} commands use keys you set. Resetting returns every one of them to the key it shipped with.`;
  return count === 1 ? "One command uses a key you set. Resetting returns it to the key it shipped with." : many;
}

function sameOverrides(a: Overrides, b: Overrides): boolean {
  const names = Object.keys(a);
  return names.length === Object.keys(b).length && names.every((name) => name in b && a[name] === b[name]);
}
