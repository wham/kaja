import { useState } from "react";

interface GutterProps {
  orientation: "vertical" | "horizontal";
  onResize: (delta: number) => void;
  hitAreaSize?: number;
}

export function Gutter({ orientation, onResize, hitAreaSize }: GutterProps) {
  const [isResizing, setIsResizing] = useState(false);

  const onMouseDown = (event: React.MouseEvent) => {
    setIsResizing(true);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    window.document.body.style.cursor = orientation === "vertical" ? "col-resize" : "row-resize";

    function onMouseMove(e: MouseEvent) {
      onResize(orientation === "vertical" ? e.movementX : e.movementY);
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

  return (
    <div
      style={{
        width: orientation === "vertical" ? 1 : "100%",
        height: orientation === "vertical" ? "100%" : 1,
        flexShrink: 0,
        position: "relative",
        backgroundColor: "var(--borderColor-default)",
      }}
    >
      <div
        style={{
          width: orientation === "vertical" ? (hitAreaSize ?? 3) : "100%",
          height: orientation === "vertical" ? "100%" : (hitAreaSize ?? 3),
          position: "absolute",
          left: orientation === "vertical" ? "-1px" : 0,
          top: orientation === "vertical" ? 0 : "-1px",
          cursor: orientation === "vertical" ? "col-resize" : "row-resize",
          zIndex: 1,
          backgroundColor: isResizing ? "var(--bgColor-accent-emphasis)" : "transparent",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = "var(--bgColor-accent-emphasis)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = isResizing ? "var(--bgColor-accent-emphasis)" : "transparent";
        }}
        onMouseDown={onMouseDown}
      />
    </div>
  );
}
