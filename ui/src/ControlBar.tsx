import { PlayIcon } from "@primer/octicons-react";
import { Button, Tooltip } from "@primer/react";
import { useEffect } from "react";

interface ControlBarProps {
  onRun: () => void;
}

export function ControlBar({ onRun }: ControlBarProps) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "F5") {
        event.preventDefault();
        onRun();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onRun]);

  return (
    <div
      style={{
        position: "absolute",
        top: 8,
        right: 20,
        display: "flex",
        gap: 2,
        background: "var(--bgColor-muted)",
        borderRadius: 6,
        padding: 2,
        zIndex: 1,
      }}
    >
      <Tooltip text="Run (F5)" direction="s">
        <Button
          leadingVisual={PlayIcon}
          onClick={onRun}
          size="small"
          variant="primary"
        >
          Run
        </Button>
      </Tooltip>
    </div>
  );
}
