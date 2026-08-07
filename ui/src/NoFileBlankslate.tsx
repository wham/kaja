import { Blankslate } from "./components/blankslate";
import { FileCode } from "lucide-react";

interface NoFileBlankslateProps {
  onOpenSwitcher: () => void;
}

// With no tab strip there is nothing left on screen to say the pane is empty, so
// the pane says it itself — and offers the one gesture that fills it.
export function NoFileBlankslate({ onOpenSwitcher }: NoFileBlankslateProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col justify-center">
      <Blankslate>
        <Blankslate.Visual>
          <FileCode size={40} />
        </Blankslate.Visual>
        <Blankslate.Heading>No file open</Blankslate.Heading>
        <Blankslate.Description>Pick a call from the sidebar, or press {navigator.platform.startsWith("Mac") ? "⌘P" : "Ctrl+P"}.</Blankslate.Description>
        <Blankslate.PrimaryAction onClick={onOpenSwitcher}>Open a file</Blankslate.PrimaryAction>
      </Blankslate>
    </div>
  );
}
