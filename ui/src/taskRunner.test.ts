import { describe, it, expect } from "bun:test";
import { Kaja } from "./kaja";
import { runTaskCaptured } from "./taskRunner";

function makeKaja(): Kaja {
  return new Kaja(
    () => {},
    async () => "",
  );
}

describe("kaja.variables injection", () => {
  it("exposes configured variables to scripts", async () => {
    const kaja = makeKaja();
    kaja.variables = { API_BASE_URL: "https://api.example.com", TEAM_ID: "42" };

    const run = await runTaskCaptured(`import { kaja } from "kaja";\nreturn kaja.variables.API_BASE_URL + " / " + kaja.variables.TEAM_ID;`, kaja, []);

    expect(run.error).toBeUndefined();
    expect(run.result).toBe("https://api.example.com / 42");
  });

  it("reflects updates to variables on the shared kaja object", async () => {
    const kaja = makeKaja();
    kaja.variables = { TOKEN: "old" };
    let run = await runTaskCaptured(`import { kaja } from "kaja";\nreturn kaja.variables.TOKEN;`, kaja, []);
    expect(run.result).toBe("old");

    // Updating the same instance (as applyConfiguration does) is visible to the next run.
    kaja.variables = { TOKEN: "new" };
    run = await runTaskCaptured(`import { kaja } from "kaja";\nreturn kaja.variables.TOKEN;`, kaja, []);
    expect(run.result).toBe("new");
  });
});

describe("kaja.uuid", () => {
  it("generates a version 4 UUID from scripts", async () => {
    const kaja = makeKaja();

    const run = await runTaskCaptured(`import { kaja } from "kaja";\nreturn kaja.uuid.v4();`, kaja, []);

    expect(run.error).toBeUndefined();
    expect(run.result).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("generates unique values", () => {
    const kaja = makeKaja();
    expect(kaja.uuid.v4()).not.toBe(kaja.uuid.v4());
  });
});
