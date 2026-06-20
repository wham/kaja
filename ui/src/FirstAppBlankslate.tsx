import { PlusIcon } from "@primer/octicons-react";
import { Blankslate } from "@primer/react/experimental";

interface FirstAppBlankslateProps {
  onNewAppClick?: () => void;
}

export function FirstAppBlankslate({ onNewAppClick }: FirstAppBlankslateProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, justifyContent: "center" }}>
      <Blankslate>
        <Blankslate.Visual>
          <PlusIcon size="medium" />
        </Blankslate.Visual>
        <Blankslate.Heading>No apps configured</Blankslate.Heading>
        <Blankslate.Description>Add an app to get started.</Blankslate.Description>
        <Blankslate.PrimaryAction onClick={onNewAppClick}>New app</Blankslate.PrimaryAction>
      </Blankslate>
    </div>
  );
}
