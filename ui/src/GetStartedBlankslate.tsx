import { Blankslate } from "./components/blankslate";
import { Rocket } from "lucide-react";

export function GetStartedBlankslate() {
  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, justifyContent: "center" }}>
      <Blankslate>
        <Blankslate.Visual>
          <Rocket size={24} />
        </Blankslate.Visual>
        <Blankslate.Heading>Welcome to Kaja</Blankslate.Heading>
        <Blankslate.Description>Select a method from the sidebar to get started.</Blankslate.Description>
      </Blankslate>
    </div>
  );
}
