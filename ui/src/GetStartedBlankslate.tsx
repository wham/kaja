import { RocketIcon } from "@primer/octicons-react";
import { Blankslate } from "@primer/react/experimental";
import { LayoutColumn } from "./Layout";

export function GetStartedBlankslate() {
  return (
    <LayoutColumn style={{ alignItems: "center", justifyContent: "center" }}>
      <Blankslate>
      <Blankslate.Visual>
        <RocketIcon size="medium" />
      </Blankslate.Visual>
      <Blankslate.Heading>Welcome to Kaja</Blankslate.Heading>
      <Blankslate.Description>
        Select a method from the sidebar to get started.
      </Blankslate.Description>
      </Blankslate>
    </LayoutColumn>
  );
}
