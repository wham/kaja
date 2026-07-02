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

    const run = await runTaskCaptured(`return kaja.variables.API_BASE_URL + " / " + kaja.variables.TEAM_ID;`, kaja, []);

    expect(run.error).toBeUndefined();
    expect(run.result).toBe("https://api.example.com / 42");
  });

  it("reflects updates to variables on the shared kaja object", async () => {
    const kaja = makeKaja();
    kaja.variables = { TOKEN: "old" };
    let run = await runTaskCaptured(`return kaja.variables.TOKEN;`, kaja, []);
    expect(run.result).toBe("old");

    // Updating the same instance (as applyConfiguration does) is visible to the next run.
    kaja.variables = { TOKEN: "new" };
    run = await runTaskCaptured(`return kaja.variables.TOKEN;`, kaja, []);
    expect(run.result).toBe("new");
  });
});
