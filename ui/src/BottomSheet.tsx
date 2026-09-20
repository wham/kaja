import { useLayoutEffect, useRef, useState } from "react";
import { cn } from "./cn";
import { SheetPosition, snapSheet } from "./phone";

interface BottomSheetProps {
  position: SheetPosition;
  onPositionChange: (position: SheetPosition) => void;
  // What the sheet shows at rest: the chrome and nothing under it.
  restHeight: number;
  // What stays uncovered above the sheet when it is up.
  topInset: number;
  // The rows that drag it — the handle and whatever header sits under the handle. A
  // tap on them with no drag flips the sheet.
  chrome: React.ReactNode;
  hidden?: boolean;
  children: React.ReactNode;
}

// Past this the pointer is dragging rather than tapping.
const DRAG_SLOP = 4;

/**
 * A sheet along the bottom of its container, with two places to be: resting on its
 * chrome, or up with the container's top still showing. It is moved by a drag on the
 * chrome and lands on one end or the other, so there is no third state to reason
 * about. The body is the sheet's own scroll; only the chrome moves it.
 */
export function BottomSheet({ position, onPositionChange, restHeight, topInset, chrome, hidden, children }: BottomSheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  const [drag, setDrag] = useState<number>();
  const gesture = useRef<{ pointerId: number; startY: number; startOffset: number; moved: boolean; samples: { y: number; t: number }[] } | undefined>(
    undefined,
  );

  useLayoutEffect(() => {
    const element = sheetRef.current;
    if (!element) return;
    const measure = () => setHeight(element.clientHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const restOffset = Math.max(0, height - restHeight);
  const offset = drag ?? (position === "up" ? 0 : restOffset);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    // A control on the chrome keeps its click: dragging starts on the chrome's own
    // surface, not on the buttons it carries.
    if ((event.target as HTMLElement).closest("button, input, [role=tab]")) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startOffset: offset,
      moved: false,
      samples: [{ y: event.clientY, t: event.timeStamp }],
    };
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const delta = event.clientY - current.startY;
    if (!current.moved && Math.abs(delta) < DRAG_SLOP) return;
    current.moved = true;
    current.samples.push({ y: event.clientY, t: event.timeStamp });
    if (current.samples.length > 4) current.samples.shift();
    setDrag(Math.min(restOffset, Math.max(0, current.startOffset + delta)));
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) return;
    gesture.current = undefined;
    setDrag(undefined);
    if (!current.moved) {
      onPositionChange(position === "up" ? "rest" : "up");
      return;
    }
    const first = current.samples[0];
    const last = current.samples[current.samples.length - 1];
    const velocity = last.t > first.t ? (last.y - first.y) / (last.t - first.t) : 0;
    onPositionChange(snapSheet(Math.min(restOffset, Math.max(0, current.startOffset + (event.clientY - current.startY))), restOffset, velocity));
  };

  return (
    <div
      ref={sheetRef}
      data-testid="bottom-sheet"
      className={cn(
        "absolute inset-x-0 bottom-0 z-20 flex flex-col rounded-t-[14px] border-t border-border bg-card shadow-[0_-8px_24px_-16px_rgba(0,0,0,0.5)]",
        hidden && "hidden",
      )}
      style={{
        top: topInset,
        transform: `translateY(${offset}px)`,
        // Only a release animates: under a finger the sheet is where the finger is.
        transition: drag === undefined ? "transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1)" : "none",
        // The sheet is measured at its own size, so it has one before it is shown at all.
        visibility: height === 0 ? "hidden" : undefined,
      }}
    >
      <div
        className="shrink-0 touch-none select-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div className="flex justify-center pb-1 pt-2">
          <div className="h-1 w-9 rounded-full bg-muted-foreground/40" />
        </div>
        {chrome}
      </div>
      <div className="flex min-h-0 flex-1 flex-col" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        {children}
      </div>
    </div>
  );
}
