import { PlayIcon } from "@primer/octicons-react";
import { Box, Button } from "@primer/react";

interface ControlBarProps {
  onRun: () => void;
}

export function ControlBar({ onRun }: ControlBarProps) {
  return (
    <Box sx={{ padding: 1 }}>
      <Button leadingVisual={PlayIcon} onClick={onRun} variant="primary" size="small">
        Run
      </Button>
    </Box>
  );
}
