import { Box } from "@primer/react";
import { useState } from "react";

interface GutterProps {
  onResize: (delta: number) => void;
}

export function Gutter({ onResize: onResize }: GutterProps) {
  const [isResizing, setIsResizing] = useState(false);

  const onMouseDown = (event: React.MouseEvent) => {
    setIsResizing(true);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    const prevCursor = window.document.body.style.cursor;
    window.document.body.style.cursor = "col-resize";

    function onMouseMove(e: MouseEvent) {
      onResize(e.movementX);
      e.preventDefault();
    }

    function onMouseUp() {
      setIsResizing(false);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      window.document.body.style.cursor = prevCursor;
    }

    event.preventDefault();
  };

  return (
    <Box sx={{ width: "1px", height: "100%", flexShrink: 0, position: "relative", backgroundColor: "border.default" }}>
      <Box
        sx={{
          width: "3px",
          height: "100%",
          position: "absolute",
          left: "-1px",
          cursor: "col-resize",
          zIndex: 1,
          backgroundColor: isResizing ? "accent.emphasis" : "transparent",
          ":hover": { backgroundColor: "accent.emphasis" },
        }}
        onMouseDown={onMouseDown}
      />
    </Box>
  );
}
