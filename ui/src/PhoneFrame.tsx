import { Check, TextAlignStart } from "lucide-react";
import * as monaco from "monaco-editor";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { cn } from "./cn";
import { CodePane } from "./CodePane";
import { Button } from "./components/button";
import { Console } from "./Console";
import { consoles } from "./consoles";
import { snapDrawer } from "./phone";
import { ConsoleView } from "./runs";

// How far in from the left edge a swipe has to start to open the drawer.
const EDGE = 24;
// How far a touch travels before it is read as a swipe or a scroll.
const AXIS_SLOP = 8;
// A finger held still this long before letting go is not a flick.
const FLICK_WINDOW_MS = 100;

interface DrawerTrack {
  startX: number;
  startY: number;
  from: number;
  width: number;
  horizontal: boolean;
  progress: number;
  lastX: number;
  lastTime: number;
  velocity: number;
}

/** What the console is handed on a phone: the one gesture it asks the frame for. */
export interface PhoneConsole {
  // Full screen on a phone is leaving the code for the run.
  onShowRun: () => void;
}

export interface PhoneScript {
  fileId: string;
  model: monaco.editor.ITextModel;
  readOnly: boolean;
}

interface PhoneFrameProps {
  // Where you are, the header's label.
  location: React.ReactNode;
  // The finder, trigger and sheet both: the trigger floats at the page's foot.
  finder: React.ReactNode;
  // The sidebar, which a phone draws under the page rather than beside it.
  drawer: React.ReactNode;
  drawerOpen: boolean;
  onDrawerOpenChange: (open: boolean) => void;
  // Run for a script, the view's own verb for anything else.
  action?: React.ReactNode;
  // The nearest script in the view stack, whose editor stays mounted in the code pane.
  script?: PhoneScript;
  // Set while that script is the view on screen: its code and its run are the body.
  onScript: boolean;
  // The mounted editors, whichever view is current; they live in the code pane.
  editor: React.ReactNode;
  console: (phone: PhoneConsole) => React.ReactNode;
  // Every other view's body.
  children: React.ReactNode;
}

/**
 * The window under 640px: the sidebar as a drawer under the page, and a page that is
 * the sidebar toggle, where you are and the action, the view under them with the finder
 * floating at its foot, and on a
 * script, its code as one more view beside the run's three. The page slides right to show
 * the drawer, from the toggle or from a swipe at the left edge, and follows the
 * finger while it does.
 */
export function PhoneFrame({
  location,
  finder,
  drawer,
  drawerOpen,
  onDrawerOpenChange,
  action,
  script,
  onScript,
  editor,
  console: renderConsole,
  children,
}: PhoneFrameProps) {
  const [code, setCode] = useState(false);
  const [editing, setEditing] = useState(false);
  const fileId = script?.fileId;

  // A file with no run to show opens on its code, which is what you came for; one
  // with runs opens on the run.
  useLayoutEffect(() => {
    if (fileId === undefined) return;
    setCode(consoles.file(fileId).groups.length === 0);
    setEditing(false);
  }, [fileId]);

  useSyncExternalStore(
    useCallback((notify: () => void) => (fileId === undefined ? () => {} : consoles.subscribeFile(fileId, notify)), [fileId]),
    useCallback(() => consoles.fileVersion(fileId), [fileId]),
  );
  const file = consoles.file(fileId);

  const showRun = useCallback(() => {
    setCode(false);
    setEditing(false);
  }, []);

  // A run starting is a request to watch it. Only a live one: the runs a file kept
  // from last time arrive settled.
  const newest = file.groups.at(-1);
  const newestRunId = newest?.run.id;
  const newestRunning = newest?.running === true;
  useLayoutEffect(() => {
    if (newestRunId !== undefined && newestRunning) showRun();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newestRunId]);

  const onRunView = useCallback(
    (view: ConsoleView) => {
      consoles.setView(fileId, view, Date.now());
      showRun();
    },
    [fileId, showRun],
  );

  const phone = useMemo<PhoneConsole>(() => ({ onShowRun: showRun }), [showRun]);

  const rootRef = useRef<HTMLDivElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const openRef = useRef(drawerOpen);
  openRef.current = drawerOpen;
  // A swipe from the edge of a keyboard-sized editor is a selection, not a gesture.
  const swipeRef = useRef(true);
  swipeRef.current = !editing;
  const onDrawerOpenChangeRef = useRef(onDrawerOpenChange);
  onDrawerOpenChangeRef.current = onDrawerOpenChange;

  // The drawer's place is a CSS variable rather than state, because a drag writes it
  // on every touchmove and a render per frame would repaint the run under it.
  useLayoutEffect(() => {
    rootRef.current?.style.setProperty("--drawer-progress", drawerOpen ? "1" : "0");
  }, [drawerOpen]);

  useLayoutEffect(() => {
    if (drawerOpen) {
      if (!drawerRef.current?.contains(document.activeElement)) drawerRef.current?.focus({ preventScroll: true });
      return;
    }
    // A drawer going inert takes the focus with it, so it comes back to what opened it.
    const active = document.activeElement;
    if (active === null || active === document.body || drawerRef.current?.contains(active)) triggerRef.current?.focus({ preventScroll: true });
  }, [drawerOpen]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let track: DrawerTrack | undefined;
    const place = (progress: number) => root.style.setProperty("--drawer-progress", String(progress));

    const start = (event: TouchEvent) => {
      track = undefined;
      if (event.touches.length !== 1) return;
      const touch = event.touches[0];
      const open = openRef.current;
      if (!open && (touch.clientX > EDGE || !swipeRef.current)) return;
      const width = drawerRef.current?.offsetWidth ?? 0;
      if (width === 0) return;
      const from = open ? 1 : 0;
      track = {
        startX: touch.clientX,
        startY: touch.clientY,
        from,
        width,
        horizontal: false,
        progress: from,
        lastX: touch.clientX,
        lastTime: event.timeStamp,
        velocity: 0,
      };
    };

    const move = (event: TouchEvent) => {
      if (!track) return;
      const touch = event.touches[0];
      const dx = touch.clientX - track.startX;
      const dy = touch.clientY - track.startY;
      if (!track.horizontal) {
        if (Math.abs(dx) < AXIS_SLOP && Math.abs(dy) < AXIS_SLOP) return;
        if (Math.abs(dy) >= Math.abs(dx)) {
          track = undefined;
          return;
        }
        track.horizontal = true;
        root.dataset.dragging = "";
      }
      event.preventDefault();
      const elapsed = event.timeStamp - track.lastTime;
      if (elapsed > 0) track.velocity = (touch.clientX - track.lastX) / elapsed;
      track.lastX = touch.clientX;
      track.lastTime = event.timeStamp;
      track.progress = Math.min(1, Math.max(0, track.from + dx / track.width));
      place(track.progress);
    };

    const end = (event: TouchEvent) => {
      const ended = track;
      track = undefined;
      if (!ended?.horizontal) return;
      delete root.dataset.dragging;
      const velocity = event.timeStamp - ended.lastTime > FLICK_WINDOW_MS ? 0 : ended.velocity;
      const open = snapDrawer(ended.progress, velocity);
      place(open ? 1 : 0);
      if (open !== openRef.current) onDrawerOpenChangeRef.current(open);
    };

    const cancel = () => {
      if (track?.horizontal) {
        delete root.dataset.dragging;
        place(openRef.current ? 1 : 0);
      }
      track = undefined;
    };

    root.addEventListener("touchstart", start, { passive: true });
    // Not passive: a swipe that has been read as one has to stop the page scrolling under it.
    root.addEventListener("touchmove", move, { passive: false });
    root.addEventListener("touchend", end);
    root.addEventListener("touchcancel", cancel);
    return () => {
      root.removeEventListener("touchstart", start);
      root.removeEventListener("touchmove", move);
      root.removeEventListener("touchend", end);
      root.removeEventListener("touchcancel", cancel);
    };
  }, []);

  const slide = "transition-[transform,border-radius,opacity] duration-300 ease-out group-data-[dragging]/frame:transition-none";

  return (
    <div
      ref={rootRef}
      className="group/frame fixed inset-0 overflow-hidden bg-chrome text-foreground"
      style={{ overscrollBehavior: "contain", "--drawer-width": "min(86vw, 360px)" } as React.CSSProperties}
    >
      <nav
        ref={drawerRef}
        id="phone-drawer"
        aria-label="Sidebar"
        tabIndex={-1}
        inert={!drawerOpen}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !event.defaultPrevented) onDrawerOpenChange(false);
        }}
        className={cn("absolute inset-y-0 left-0 flex flex-col bg-chrome outline-none", slide)}
        style={{
          width: "var(--drawer-width)",
          paddingTop: "env(safe-area-inset-top)",
          paddingBottom: "env(safe-area-inset-bottom)",
          transform: "translateX(calc((var(--drawer-progress) - 1) * var(--drawer-width) * 0.3))",
        }}
      >
        {drawer}
      </nav>
      <div
        inert={drawerOpen}
        className={cn("absolute inset-0 flex flex-col overflow-hidden bg-background shadow-[0_0_24px_rgba(0,0,0,0.25)]", slide)}
        style={{
          transform: "translateX(calc(var(--drawer-progress) * var(--drawer-width)))",
          borderRadius: "calc(var(--drawer-progress) * 16px) 0 0 calc(var(--drawer-progress) * 16px)",
          // Faded into the chrome rather than dimmed with black, which a dark page doesn't show.
          opacity: "calc(1 - var(--drawer-progress) * 0.6)",
        }}
      >
        <div className="shrink-0 border-b border-border bg-chrome" style={{ paddingTop: "env(safe-area-inset-top)" }}>
          <div className="flex h-[60px] items-center gap-2 px-3">
            <button
              ref={triggerRef}
              type="button"
              aria-label="Show sidebar"
              aria-expanded={drawerOpen}
              aria-controls="phone-drawer"
              onClick={() => onDrawerOpenChange(true)}
              className="flex size-11 shrink-0 items-center justify-center rounded-full border border-border bg-card text-foreground outline-none active:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
            >
              <TextAlignStart size={22} />
            </button>
            {location}
            {/* Keeps the label centred when there is no action to balance the toggle. */}
            {action ?? <div className="size-11 shrink-0" />}
          </div>
        </div>
        <div className="relative flex min-h-0 flex-1 flex-col">
          {onScript && (
            <div className="flex h-[44px] shrink-0 items-center px-3">
              <Console.ViewSelect
                activeView={file.activeView}
                waiting={file.selectedGroup?.awaiting !== undefined}
                onChange={onRunView}
                fullWidth
                code={{ selected: code, onSelect: () => setCode(true) }}
              />
              {editing && (
                <Button
                  variant="outline"
                  size="sm"
                  className="ml-2 h-[32px] shrink-0 gap-1.5 px-3 text-xs"
                  data-testid="code-pane-done"
                  onClick={() => setEditing(false)}
                >
                  <Check size={13} className="text-muted-foreground" />
                  Done
                </Button>
              )}
            </div>
          )}
          {onScript && (
            <div
              data-testid="phone-run"
              className={cn("flex min-h-0 flex-1 flex-col", code && "hidden")}
              style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
            >
              {renderConsole(phone)}
            </div>
          )}
          {/* Always mounted, because it holds the editors. */}
          <div className={cn("flex min-h-0 flex-1 flex-col", !(onScript && code) && "hidden")}>
            <CodePane
              model={onScript ? script?.model : undefined}
              readOnly={script?.readOnly ?? true}
              editing={editing}
              onEditingChange={setEditing}
              editor={editor}
            />
          </div>
          <div className={cn("flex min-h-0 flex-1 flex-col", onScript && "hidden")} style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
            {children}
          </div>
          <div className={cn("absolute left-4 z-20", editing && "hidden")} style={{ bottom: "calc(env(safe-area-inset-bottom) + 16px)" }}>
            {finder}
          </div>
        </div>
      </div>
      {/* The page left showing beside the sidebar is faded, and a tap on it is the way back. */}
      <button
        type="button"
        aria-label="Hide sidebar"
        inert={!drawerOpen}
        onClick={() => onDrawerOpenChange(false)}
        className={cn("absolute inset-0", slide, !drawerOpen && "pointer-events-none")}
        style={{
          transform: "translateX(calc(var(--drawer-progress) * var(--drawer-width)))",
          borderRadius: "calc(var(--drawer-progress) * 16px) 0 0 calc(var(--drawer-progress) * 16px)",
        }}
      />
    </div>
  );
}
