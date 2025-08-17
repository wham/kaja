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
    <div style={{ position: "absolute", top: 20, right: 40, zIndex: 1 }}>
      <Tooltip text="Run (F5)" direction="s">
        <Button
          leadingVisual={() => <PlayIcon size={100} fill="var(--fgColor-success)" />}
          onClick={onRun}
          variant="invisible"
          size="large"
          style={{
            width: 100,
            height: 100,
            borderRadius: "50%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 0,
            backgroundColor: "transparent",
          }}
        />
      </Tooltip>
    </div>
  );
}
