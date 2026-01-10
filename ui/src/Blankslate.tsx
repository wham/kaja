import { RocketIcon } from "@primer/octicons-react";
import { Blankslate as PrimerBlankslate } from "@primer/react/experimental";

export function Blankslate() {
  return (
    <PrimerBlankslate>
      <PrimerBlankslate.Visual>
        <RocketIcon size="medium" />
      </PrimerBlankslate.Visual>
      <PrimerBlankslate.Heading>Welcome to kaja</PrimerBlankslate.Heading>
      <PrimerBlankslate.Description>
        Select a method from the sidebar to get started.
      </PrimerBlankslate.Description>
    </PrimerBlankslate>
  );
}
