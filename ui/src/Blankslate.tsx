import { RocketIcon } from "@primer/octicons-react";
import { Blankslate } from "@primer/react/experimental";

export function GetStartedBlankslate() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
      }}
    >
      <Blankslate>
        <Blankslate.Visual>
          <RocketIcon size="medium" />
        </Blankslate.Visual>
        <Blankslate.Heading>Welcome to kaja</Blankslate.Heading>
        <Blankslate.Description>
          Select a method from the sidebar to get started.
        </Blankslate.Description>
      </Blankslate>
    </div>
  );
}
