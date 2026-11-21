import {
  acceptCompletion,
  completionStatus,
  currentCompletions,
  insertBracket,
  selectedCompletionIndex,
  setSelectedCompletion,
  startCompletion,
} from "@codemirror/autocomplete";
import { cursorCharLeft, cursorCharRight, indentMore, redo, redoDepth, undo, undoDepth } from "@codemirror/commands";
import { EditorView } from "@codemirror/view";
import { ArrowLeft, ArrowRight, ArrowRightToLine, ChevronLeft, ChevronRight, Redo2, Undo2 } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { App } from "./apps";
import { cn } from "./cn";
import { FieldStop, fieldStops, hop, stopAt } from "./fieldStops";
import { isIOSApp } from "./wails";

const MAX_COMPLETIONS = 30;
const REPEAT_DELAY_MS = 400;
const REPEAT_EVERY_MS = 60;

const SYMBOLS = ["{", "}", "(", ")", '"', ":", ",", ".", "=>", "[", "]", "'", "`", ";", "=", "!", "?", "&", "|", "<", ">", "$"];

export interface KeyBarState {
  completions: { label: string; detail?: string }[];
  selected: number | null;
  // The field the caret is in, or how many there are where it is in none.
  field?: { key: string; index: number };
  fields: number;
  canPrev: boolean;
  canNext: boolean;
  canUndo: boolean;
  canRedo: boolean;
}

let cached: { code: string; apps: App[]; stops: FieldStop[] } | undefined;

function stopsOf(code: string, apps: App[]): FieldStop[] {
  if (cached?.code !== code || cached.apps !== apps) cached = { code, apps, stops: fieldStops(code, apps) };
  return cached.stops;
}

export function keyBarState(view: EditorView, apps: App[]): KeyBarState {
  const { state } = view;
  const stops = stopsOf(state.doc.toString(), apps);
  const head = state.selection.main.head;
  const index = stopAt(stops, head);
  const open = completionStatus(state) === "active";
  return {
    completions: open
      ? currentCompletions(state)
          .slice(0, MAX_COMPLETIONS)
          .map(({ label, detail }) => ({ label, detail }))
      : [],
    selected: open ? selectedCompletionIndex(state) : null,
    field: index === undefined ? undefined : { key: stops[index].key, index },
    fields: stops.length,
    canPrev: hop(stops, head, false) !== undefined,
    canNext: hop(stops, head, true) !== undefined,
    canUndo: undoDepth(state) > 0,
    canRedo: redoDepth(state) > 0,
  };
}

export function sameKeyBarState(a: KeyBarState | undefined, b: KeyBarState | undefined): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function type(view: EditorView, text: string) {
  const bracket = text.length === 1 ? insertBracket(view.state, text) : null;
  if (bracket) view.dispatch(bracket);
  else view.dispatch(view.state.replaceSelection(text), { scrollIntoView: true, userEvent: "input.type" });
}

function goToField(view: EditorView, apps: App[], forward: boolean) {
  const stops = stopsOf(view.state.doc.toString(), apps);
  const next = hop(stops, view.state.selection.main.head, forward);
  if (next === undefined) return;
  const { from, to } = stops[next];
  view.dispatch({ selection: { anchor: from, head: to }, scrollIntoView: true, userEvent: "select" });
}

// The part of the window the keyboard leaves showing, measured from the bottom of the
// layout viewport, which is what a fixed element is placed against.
function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = () => setInset(Math.max(0, window.innerHeight - (viewport.offsetTop + viewport.height)));
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
    };
  }, []);
  return inset;
}

interface PhoneKeyBarProps {
  view: EditorView;
  state: KeyBarState;
  apps: App[];
  onHeight: (height: number) => void;
}

/**
 * The keys a script needs that a phone's keyboard hides, riding on top of it: the
 * completion list, the request's fields to step through, and the symbols. Every key
 * is the command the desktop's key would run.
 */
export function PhoneKeyBar({ view, state, apps, onHeight }: PhoneKeyBarProps) {
  const inset = useKeyboardInset();
  const ref = useRef<HTMLDivElement>(null);
  const reportHeight = useRef(onHeight);
  reportHeight.current = onHeight;

  useLayoutEffect(() => {
    const bar = ref.current;
    if (!bar) return;
    const observer = new ResizeObserver(() => reportHeight.current(bar.offsetHeight));
    observer.observe(bar);
    return () => {
      observer.disconnect();
      reportHeight.current(0);
    };
  }, []);

  // Safari stacks its form bar and its address bar over the keyboard and a page can
  // hide neither, so there the bar is one row; the app has removed its form bar.
  const compact = !isIOSApp();

  const pick = (index: number) => {
    view.dispatch({ effects: setSelectedCompletion(index) });
    acceptCompletion(view);
  };

  const chips = state.completions.map((completion, index) => (
    <Key
      key={`${index}:${completion.label}`}
      onPress={() => pick(index)}
      className={cn("rounded-full px-3 font-mono text-[13px]", index === state.selected && "bg-primary text-primary-foreground")}
    >
      {completion.label}
      {completion.detail && <span className="ml-1.5 font-sans text-[11px] opacity-60">{completion.detail}</span>}
    </Key>
  ));
  const prev = (
    <Key
      aria-label="Previous field"
      disabled={!state.canPrev}
      onPress={() => goToField(view, apps, false)}
      className={cn(!compact && "pr-2.5 pl-1.5 text-[13px]")}
    >
      <ChevronLeft size={16} />
      {!compact && "Prev"}
    </Key>
  );
  const next = (
    <Key aria-label="Next field" disabled={!state.canNext} onPress={() => goToField(view, apps, true)} className="pr-1.5 pl-2.5 text-[13px]">
      Next
      <ChevronRight size={16} />
    </Key>
  );
  const symbols = (
    <>
      <Key aria-label="Indent" onPress={() => indentMore(view)}>
        <ArrowRightToLine size={16} />
      </Key>
      {SYMBOLS.map((symbol) => (
        <Key
          key={symbol}
          className="font-mono text-[15px]"
          onPress={() => {
            type(view, symbol);
            if (symbol === ".") startCompletion(view);
          }}
        >
          {symbol}
        </Key>
      ))}
    </>
  );
  const history = (
    <>
      <Key aria-label="Undo" disabled={!state.canUndo} repeat onPress={() => undo(view)}>
        <Undo2 size={16} />
      </Key>
      <Key aria-label="Redo" disabled={!state.canRedo} repeat onPress={() => redo(view)}>
        <Redo2 size={16} />
      </Key>
    </>
  );
  const arrows = (
    <>
      <Key aria-label="Left" repeat onPress={() => cursorCharLeft(view)}>
        <ArrowLeft size={16} />
      </Key>
      <Key aria-label="Right" repeat onPress={() => cursorCharRight(view)}>
        <ArrowRight size={16} />
      </Key>
    </>
  );
  const scroller = "flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto [scrollbar-width:none]";

  return createPortal(
    <div
      ref={ref}
      data-testid="phone-key-bar"
      className="fixed inset-x-0 z-40 flex flex-col gap-1.5 border-t border-border bg-card px-2 py-1.5 select-none"
      style={{ bottom: inset }}
    >
      {compact ? (
        <div className="flex h-9 items-center gap-1.5">
          <div className={scroller}>
            {chips.length > 0 ? (
              chips
            ) : (
              <>
                {state.fields > 0 && (
                  <>
                    {prev}
                    {next}
                    <span className="mx-0.5 h-5 w-px shrink-0 bg-border" />
                  </>
                )}
                {symbols}
                {history}
              </>
            )}
          </div>
          {arrows}
        </div>
      ) : (
        <>
          <div className="flex h-9 items-center gap-1.5">
            <div className={scroller}>
              {chips.length > 0
                ? chips
                : state.fields > 0 && (
                    <>
                      {prev}
                      <span className="min-w-0 flex-1 truncate text-center text-[13px] text-muted-foreground">
                        {state.field ? (
                          <>
                            <span className="font-mono text-foreground">{state.field.key}</span> · {state.field.index + 1} of {state.fields}
                          </>
                        ) : (
                          `${state.fields} ${state.fields === 1 ? "field" : "fields"}`
                        )}
                      </span>
                      {next}
                    </>
                  )}
            </div>
            {history}
          </div>
          <div className="flex h-9 items-center gap-1.5">
            <div className={scroller}>{symbols}</div>
            {arrows}
          </div>
        </>
      )}
    </div>,
    document.body,
  );
}

interface KeyProps {
  onPress: () => void;
  // Pressed and held, it goes on pressing, the way a key on the keyboard does.
  repeat?: boolean;
  // Not the attribute: a disabled button passes the press through, and the editor loses the focus.
  disabled?: boolean;
  className?: string;
  children: React.ReactNode;
  "aria-label"?: string;
}

function Key({ onPress, repeat = false, disabled = false, className, children, ...rest }: KeyProps) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const press = useRef(onPress);
  press.current = onPress;

  const stop = () => {
    clearTimeout(timer.current);
    clearInterval(timer.current);
    timer.current = undefined;
  };
  useEffect(() => stop, []);

  return (
    <button
      type="button"
      tabIndex={-1}
      aria-disabled={disabled || undefined}
      aria-label={rest["aria-label"]}
      // Cancelled, the press leaves the editor focused and the keyboard up.
      onPointerDown={(event) => {
        event.preventDefault();
        if (!repeat || disabled) return;
        press.current();
        timer.current = setTimeout(() => {
          timer.current = setInterval(() => press.current(), REPEAT_EVERY_MS);
        }, REPEAT_DELAY_MS);
      }}
      onMouseDown={(event) => event.preventDefault()}
      onPointerUp={stop}
      onPointerCancel={stop}
      onPointerLeave={stop}
      onClick={() => {
        if (!repeat && !disabled) onPress();
      }}
      className={cn(
        "flex h-9 min-w-9 shrink-0 items-center justify-center gap-0.5 rounded-md bg-muted px-2 whitespace-nowrap text-foreground active:bg-accent aria-disabled:opacity-40",
        className,
      )}
    >
      {children}
    </button>
  );
}
