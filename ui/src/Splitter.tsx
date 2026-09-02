import { useState } from "react";

import { cn } from "./cn";

const HIT_AREA = 9;
const OVERLAP = 4;

interface SplitterProps {
  orientation: "vertical" | "horizontal";
  onResize: (delta: number) => void;
  hitAreaSize?: number;
}

export function Splitter({ orientation, onResize, hitAreaSize }: SplitterProps) {
  const [isResizing, setIsResizing] = useState(false);
  const isVertical = orientation === "vertical";

  const onMouseDown = (event: React.MouseEvent) => {
    setIsResizing(true);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    window.document.body.style.cursor = isVertical ? "col-resize" : "row-resize";

    function onMouseMove(e: MouseEvent) {
      onResize(isVertical ? e.movementX : e.movementY);
      e.preventDefault();
    }

    function onMouseUp() {
      setIsResizing(false);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      window.document.body.style.cursor = "";
    }

    event.preventDefault();
  };

  const hitArea = hitAreaSize ?? HIT_AREA;

  return (
    <div className={cn("relative shrink-0 bg-border", isVertical ? "h-full w-px" : "h-px w-full")}>
      <div
        className={cn("group absolute z-[2]", isVertical ? "top-0 h-full cursor-col-resize" : "left-0 w-full cursor-row-resize")}
        style={isVertical ? { width: hitArea, left: -OVERLAP } : { height: hitArea, top: -OVERLAP }}
        onMouseDown={onMouseDown}
      >
        <div
          className={cn(
            "absolute bg-primary transition-opacity delay-100 duration-[120ms]",
            isVertical ? "top-0 h-full w-px" : "left-0 h-px w-full",
            isResizing ? "opacity-100" : "opacity-0 group-hover:opacity-70",
          )}
          style={isVertical ? { left: OVERLAP } : { top: OVERLAP }}
        />
      </div>
    </div>
  );
}
