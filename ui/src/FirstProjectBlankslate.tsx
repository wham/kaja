import { PlusIcon } from "@primer/octicons-react";
import { Blankslate } from "@primer/react/experimental";

interface FirstProjectBlankslateProps {
  canUpdateConfiguration: boolean;
  onNewProjectClick?: () => void;
}

export function FirstProjectBlankslate({ canUpdateConfiguration, onNewProjectClick }: FirstProjectBlankslateProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, justifyContent: "center" }}>
      <Blankslate>
        <Blankslate.Visual>
          <PlusIcon size="medium" />
        </Blankslate.Visual>
        <Blankslate.Heading>No projects configured</Blankslate.Heading>
        <Blankslate.Description>
          {canUpdateConfiguration ? "Add a project to get started." : "Contact your administrator to add projects."}
        </Blankslate.Description>
        {canUpdateConfiguration && (
          <Blankslate.PrimaryAction onClick={onNewProjectClick}>New Project</Blankslate.PrimaryAction>
        )}
      </Blankslate>
    </div>
  );
}
