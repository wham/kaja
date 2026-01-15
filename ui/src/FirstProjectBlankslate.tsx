import { PlusIcon } from "@primer/octicons-react";
import { Blankslate } from "@primer/react/experimental";

interface FirstProjectBlankslateProps {
  canUpdateConfiguration: boolean;
  onNewProjectClick?: () => void;
}

export function FirstProjectBlankslate({ canUpdateConfiguration, onNewProjectClick }: FirstProjectBlankslateProps) {
  return (
    <Blankslate
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        flex: 1,
        minHeight: 0,
      }}
    >
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
  );
}
