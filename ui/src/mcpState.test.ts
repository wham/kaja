import { describe, expect, test } from "bun:test";
import { mcpDotClass, mcpStatus, type McpConditions } from "./mcpState";

const running: McpConditions = { enabled: true, listening: true, attached: true, onDuty: true, active: false };

describe("mcpStatus", () => {
  test("the switch is what off means", () => {
    expect(mcpStatus({ ...running, enabled: false }).state).toBe("off");
  });

  test("on, but nothing answering yet, is starting", () => {
    expect(mcpStatus({ ...running, listening: false }).state).toBe("starting");
    expect(mcpStatus({ ...running, attached: false }).state).toBe("starting");
  });

  test("a server that couldn't start says so wherever the switch is", () => {
    const status = mcpStatus({ ...running, enabled: false, error: "Port 41521 is in use." });
    expect(status.state).toBe("error");
    expect(status.note).toBe("Port 41521 is in use.");
    expect(status.tone).toBe("destructive");
  });

  test("a call in flight outranks idle, and takes the note with it", () => {
    const status = mcpStatus({ ...running, active: true });
    expect(status.state).toBe("active");
    expect(status.headline).toBe("Running");
    expect(status.note).toBeUndefined();
  });

  test("the only thing worth a line about a running server is not being on duty", () => {
    expect(mcpStatus(running).note).toBe("no client attached");
    expect(mcpStatus({ ...running, onDuty: false }).note).toBe("another window of yours is on duty");
  });

  test("the dot goes out under the glow, so the two never say the same thing", () => {
    expect(mcpDotClass("active")).toBeUndefined();
    expect(mcpDotClass("running")).toBeDefined();
  });
});
