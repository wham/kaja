import { useState } from "react";

import { cn } from "./cn";

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

  const hitArea = hitAreaSize ?? 3;

  return (
    <div className={cn("relative shrink-0 bg-border", isVertical ? "h-full w-px" : "h-px w-full")}>
      <div
        className={cn(
          "absolute z-[1] hover:bg-primary",
          isVertical ? "-left-px top-0 h-full cursor-col-resize" : "-top-px left-0 w-full cursor-row-resize",
          isResizing && "bg-primary",
        )}
        style={isVertical ? { width: hitArea } : { height: hitArea }}
        onMouseDown={onMouseDown}
      />
    </div>
  );
}
