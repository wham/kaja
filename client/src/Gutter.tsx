import { Box } from "@primer/react";
import { useState } from "react";

interface GutterProps {
  orientation: "vertical" | "horizontal";
  onResize: (delta: number) => void;
}

export function Gutter({ orientation, onResize }: GutterProps) {
  const [isResizing, setIsResizing] = useState(false);

  const onMouseDown = (event: React.MouseEvent) => {
    setIsResizing(true);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    const prevCursor = window.document.body.style.cursor;
    window.document.body.style.cursor = "col-resize";

    function onMouseMove(e: MouseEvent) {
      onResize(orientation == "vertical" ? e.movementX : e.movementY);
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
    <Box
      sx={{
        width: orientation == "vertical" ? 1 : "100%",
        height: orientation == "vertical" ? "100%" : 1,
        flexShrink: 0,
        position: "relative",
        backgroundColor: "border.default",
      }}
    >
      <Box
        sx={{
          width: orientation == "vertical" ? 3 : "100%",
          height: orientation == "vertical" ? "100%" : 3,
          position: "absolute",
          left: orientation == "vertical" ? "-1px" : 0,
          top: orientation == "vertical" ? 0 : "-1px",
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
