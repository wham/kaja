import { Blankslate } from "./components/blankslate";
import { Lock, Plus } from "lucide-react";

interface FirstAppBlankslateProps {
  onNewAppClick?: () => void;
  canUpdateConfiguration?: boolean;
}

export function FirstAppBlankslate({ onNewAppClick, canUpdateConfiguration = true }: FirstAppBlankslateProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, justifyContent: "center" }}>
      <Blankslate>
        <Blankslate.Visual>{canUpdateConfiguration ? <Plus size={24} /> : <Lock size={24} />}</Blankslate.Visual>
        <Blankslate.Heading>No apps configured</Blankslate.Heading>
        <Blankslate.Description>
          {canUpdateConfiguration ? (
            "Add an app to get started."
          ) : (
            <>
              This configuration is read-only, and it names no apps. They come from <code>kaja.json</code> in the workspace Kaja was started on.
            </>
          )}
        </Blankslate.Description>
        {canUpdateConfiguration && <Blankslate.PrimaryAction onClick={onNewAppClick}>New app</Blankslate.PrimaryAction>}
      </Blankslate>
    </div>
  );
}
