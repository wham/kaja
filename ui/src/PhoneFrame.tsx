import { Menu } from "lucide-react";
import * as monaco from "monaco-editor";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { cn } from "./cn";
import { CODE_SHEET_REST_HEIGHT, CodeSheet } from "./CodeSheet";
import { consoles } from "./consoles";
import { SheetPosition, snapDrawer } from "./phone";

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

/** What the console is handed on a phone: the one gesture it asks the sheet for. */
export interface PhoneConsole {
  // Full screen on a phone is the sheet getting out of the way.
  onShowRun: () => void;
}

export interface PhoneScript {
  fileId: string;
  name: string;
  model: monaco.editor.ITextModel;
  readOnly: boolean;
}

interface PhoneFrameProps {
  // Where you are, said in the header that opens the drawer.
  title: React.ReactNode;
  drawer: React.ReactNode;
  drawerOpen: boolean;
  onDrawerOpenChange: (open: boolean) => void;
  // Run for a script, the view's own verb for anything else.
  action?: React.ReactNode;
  // The nearest script in the view stack, whose editor stays mounted in the sheet.
  script?: PhoneScript;
  // Set while that script is the view on screen: the run is the body and the sheet is
  // there to raise. Anywhere else there is no sheet.
  onScript: boolean;
  // The mounted editors, whichever view is current; they live in the sheet.
  editor: React.ReactNode;
  console: (phone: PhoneConsole) => React.ReactNode;
  // Every other view's body.
  children: React.ReactNode;
}

/**
 * The window under 640px: the sidebar as a drawer under the page, and a page that is
 * a header, the view under it, and on a script, its code as an overlay raised over
 * the run. The page slides right to show the drawer, from the header or from a swipe
 * at the left edge, and follows the finger while it does.
 */
export function PhoneFrame({
  title,
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
  const [position, setPosition] = useState<SheetPosition>("rest");
  const [editing, setEditing] = useState(false);
  const fileId = script?.fileId;

  // A file with no run to show opens on its code, which is what you came for; one
  // with runs opens on the run.
  useLayoutEffect(() => {
    if (fileId === undefined) return;
    setPosition(consoles.file(fileId).groups.length === 0 ? "half" : "rest");
    setEditing(false);
  }, [fileId]);

  // A run starting is a request to watch it, so the sheet gets out of its way. Only a
  // live one: the runs a file kept from last time arrive settled.
  useSyncExternalStore(
    useCallback((notify: () => void) => (fileId === undefined ? () => {} : consoles.subscribeFile(fileId, notify)), [fileId]),
    useCallback(() => consoles.fileVersion(fileId), [fileId]),
  );
  const newest = consoles.file(fileId).groups.at(-1);
  const newestRunId = newest?.run.id;
  const newestRunning = newest?.running === true;
  useLayoutEffect(() => {
    if (newestRunId !== undefined && newestRunning) setPosition("rest");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newestRunId]);

  // A keyboard leaves nothing over for what the sheet covers, so editing takes the
  // screen rather than being typed into through a gap.
  const onEditingChange = useCallback((next: boolean) => {
    setEditing(next);
    if (next) setPosition("full");
  }, []);

  // Putting the sheet away ends the edit with it: a keyboard over a 24px grabber has
  // nothing left to type into.
  const onPositionChange = useCallback((next: SheetPosition) => {
    setPosition(next);
    if (next === "rest") setEditing(false);
  }, []);

  const phone = useMemo<PhoneConsole>(() => ({ onShowRun: () => onPositionChange("rest") }), [onPositionChange]);

  const up = onScript && position !== "rest";

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
      style={{ overscrollBehavior: "contain", "--drawer-width": "min(84vw, 320px)" } as React.CSSProperties}
    >
      <nav
        ref={drawerRef}
        id="phone-drawer"
        aria-label="Navigation"
        tabIndex={-1}
        inert={!drawerOpen}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !event.defaultPrevented) onDrawerOpenChange(false);
        }}
        className={cn("absolute inset-y-0 left-0 flex flex-col bg-chrome outline-none", slide)}
        style={{
          width: "var(--drawer-width)",
          paddingTop: "env(safe-area-inset-top)",
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
        }}
      >
        <div className="shrink-0 border-b border-border bg-chrome" style={{ paddingTop: "env(safe-area-inset-top)" }}>
          <div className="flex h-[52px] items-center gap-2 px-3">
            <button
              ref={triggerRef}
              type="button"
              aria-expanded={drawerOpen}
              aria-controls="phone-drawer"
              onClick={() => onDrawerOpenChange(true)}
              className="flex h-[36px] min-w-0 flex-1 items-center gap-2 rounded-md pr-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="sr-only">Navigation: </span>
              <span className="flex size-9 shrink-0 items-center justify-center text-muted-foreground">
                <Menu size={18} />
              </span>
              {title}
            </button>
            {action}
          </div>
        </div>
        <div className="relative flex min-h-0 flex-1 flex-col">
          {onScript && (
            <div
              data-testid="phone-run"
              className={cn("flex min-h-0 flex-1 flex-col transition-opacity duration-200", up && "opacity-40")}
              style={{ paddingBottom: `calc(${CODE_SHEET_REST_HEIGHT}px + env(safe-area-inset-bottom))` }}
            >
              {renderConsole(phone)}
            </div>
          )}
          <div className={cn("flex min-h-0 flex-1 flex-col", onScript && "hidden")} style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
            {children}
          </div>
          {/* What is behind a raised sheet is dimmed, and a tap on it is the way back. */}
          {up && <button type="button" aria-label="Put the code away" className="absolute inset-0 z-10" onClick={() => onPositionChange("rest")} />}
          <CodeSheet
            model={onScript ? script?.model : undefined}
            name={script?.name}
            readOnly={script?.readOnly ?? true}
            position={position}
            onPositionChange={onPositionChange}
            editing={editing}
            onEditingChange={onEditingChange}
            editor={editor}
          />
        </div>
      </div>
      {/* The page left showing beside the drawer is dimmed, and a tap on it is the way back. */}
      <button
        type="button"
        aria-label="Close navigation"
        inert={!drawerOpen}
        onClick={() => onDrawerOpenChange(false)}
        className={cn("absolute inset-0 bg-black", slide, !drawerOpen && "pointer-events-none")}
        style={{
          opacity: "calc(var(--drawer-progress) * 0.4)",
          transform: "translateX(calc(var(--drawer-progress) * var(--drawer-width)))",
          borderRadius: "calc(var(--drawer-progress) * 16px) 0 0 calc(var(--drawer-progress) * 16px)",
        }}
      />
    </div>
  );
}
