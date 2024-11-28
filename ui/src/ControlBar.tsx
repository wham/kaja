import { PlayIcon } from "@primer/octicons-react";
import { Box, Button, Tooltip } from "@primer/react";
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
    <Box sx={{ position: "absolute", top: "20px", right: "40px", zIndex: 1 }}>
      <Tooltip aria-label="Run (F5)" direction="s">
        <Button
          leadingVisual={() => <PlayIcon size={100} fill="#1a7f37" />}
          onClick={onRun}
          variant="invisible"
          size="large"
          sx={{
            width: "100px",
            height: "100px",
            borderRadius: "50%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 0,
            backgroundColor: "transparent",
          }}
        />
      </Tooltip>
    </Box>
  );
}
