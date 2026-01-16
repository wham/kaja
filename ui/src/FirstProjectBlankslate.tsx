import { PlusIcon } from "@primer/octicons-react";
import { Blankslate } from "@primer/react/experimental";
import { Button, ButtonGroup, Link } from "@primer/react";

interface FirstProjectBlankslateProps {
  canUpdateConfiguration: boolean;
  onNewProjectClick?: () => void;
  onDemoClick?: () => void;
}

export function FirstProjectBlankslate({ canUpdateConfiguration, onNewProjectClick, onDemoClick }: FirstProjectBlankslateProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, justifyContent: "center" }}>
      <Blankslate>
        <Blankslate.Visual>
          <PlusIcon size="medium" />
        </Blankslate.Visual>
        <Blankslate.Heading>No projects configured</Blankslate.Heading>
        <Blankslate.Description>
          {canUpdateConfiguration ? (
            <>
              Add a project to get started or start with a pre-configured demo from{" "}
              <Link href="https://kaja.tools" target="_blank">
                kaja.tools
              </Link>{" "}
              website.
            </>
          ) : (
            "Contact your administrator to add projects."
          )}
        </Blankslate.Description>
        {canUpdateConfiguration && (
          <ButtonGroup>
            <Button variant="primary" onClick={onNewProjectClick}>
              New Project
            </Button>
            <Button onClick={onDemoClick}>Demo</Button>
          </ButtonGroup>
        )}
      </Blankslate>
    </div>
  );
}
