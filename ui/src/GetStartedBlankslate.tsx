import { RocketIcon } from "@primer/octicons-react";
import { Blankslate } from "@primer/react/experimental";

export function GetStartedBlankslate() {
  return (
    <Blankslate
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
      }}
    >
      <Blankslate.Visual>
        <RocketIcon size="medium" />
      </Blankslate.Visual>
      <Blankslate.Heading>Welcome to Kaja</Blankslate.Heading>
      <Blankslate.Description>
        Select a method from the sidebar to get started.
      </Blankslate.Description>
    </Blankslate>
  );
}
