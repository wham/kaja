import { describe, expect, it } from "bun:test";
import { Script } from "./apps";
import { VariableSource, WorkspaceApp } from "./server/api";
import { appVariableUses, missingByApp, missingVariables, missingVariableSentence, orderReferences, scannedAgo, scriptReferenceLabel } from "./variableUsage";

function grpcApp(name: string, url: string, headers: { [key: string]: string } = {}): WorkspaceApp {
  return { name, app: { oneofKind: "grpc", grpc: { url, protoDir: "", headers, reflection: "", auth: "" } } } as unknown as WorkspaceApp;
}

describe("appVariableUses", () => {
  it("names the parameter a reference sits in", () => {
    const uses = appVariableUses([grpcApp("theatre", "${HOST}")]);
    expect(uses.get("HOST")).toEqual([{ app: "theatre", field: "url" }]);
  });

  it("calls a header reference a header, whichever header it is", () => {
    const uses = appVariableUses([grpcApp("theatre", "localhost:9000", { Authorization: "Bearer ${TOKEN}" })]);
    expect(uses.get("TOKEN")).toEqual([{ app: "theatre", field: "header" }]);
  });

  it("counts one app naming a variable twice in one field once", () => {
    const uses = appVariableUses([grpcApp("theatre", "${HOST}/${HOST}")]);
    expect(uses.get("HOST")).toHaveLength(1);
  });

  it("lists an app once per field that names the variable", () => {
    const uses = appVariableUses([grpcApp("theatre", "${TOKEN}", { Authorization: "${TOKEN}" })]);
    expect(uses.get("TOKEN")).toEqual([
      { app: "theatre", field: "url" },
      { app: "theatre", field: "header" },
    ]);
  });

  it("holds a name no variable defines, which is how the screen reports one", () => {
    const uses = appVariableUses([grpcApp("theatre", "${MISSING}")]);
    expect([...uses.keys()]).toEqual(["MISSING"]);
  });
});

describe("scriptReferenceLabel", () => {
  const scripts: Script[] = [{ path: "/w/scripts/reports/churn.ts", name: "churn.ts", folder: "reports" }];

  it("names a file the way the sidebar names it", () => {
    expect(scriptReferenceLabel({ path: "/w/scripts/reports/churn.ts", count: 1 }, scripts)).toBe("reports/churn.ts");
  });

  it("falls back to the last segment of a path the sidebar doesn't know", () => {
    expect(scriptReferenceLabel({ path: "/w/scripts/gone.ts", count: 1 }, scripts)).toBe("gone.ts");
  });
});

describe("orderReferences", () => {
  it("puts the most-referenced file first, then orders by name", () => {
    const ordered = orderReferences(
      [
        { path: "/w/scripts/b.ts", count: 1 },
        { path: "/w/scripts/a.ts", count: 1 },
        { path: "/w/scripts/c.ts", count: 4 },
      ],
      [],
    );
    expect(ordered.map((reference) => reference.path)).toEqual(["/w/scripts/c.ts", "/w/scripts/a.ts", "/w/scripts/b.ts"]);
  });
});

describe("scannedAgo", () => {
  const at = 1_000_000_000_000;

  it("says just now within the minute", () => expect(scannedAgo(at, at + 59_000)).toBe("Scanned just now"));
  it("counts minutes", () => expect(scannedAgo(at, at + 120_000)).toBe("Scanned 2 minutes ago"));
  it("counts hours", () => expect(scannedAgo(at, at + 3 * 3_600_000)).toBe("Scanned 3 hours ago"));
});

describe("missingVariables", () => {
  const apps = [grpcApp("theatre", "${HOST}", { Authorization: "Bearer ${TOKEN}" }), grpcApp("box", "${HOST}")];
  const uses = appVariableUses(apps);

  it("names a variable kaja.json defines and this machine holds nothing for", () => {
    const status = [
      { name: "HOST", source: VariableSource.FILE, envName: "" },
      { name: "TOKEN", source: VariableSource.UNSET, envName: "KAJA_TOKEN" },
    ];
    expect(missingVariables({ HOST: "localhost", TOKEN: "${secret}" }, status, uses)).toEqual([{ name: "TOKEN", defined: true, apps: ["theatre"] }]);
  });

  it("names a reference no variable defines", () => {
    const status = [{ name: "HOST", source: VariableSource.FILE, envName: "" }];
    expect(missingVariables({ HOST: "localhost" }, status, uses)).toEqual([{ name: "TOKEN", defined: false, apps: ["theatre"] }]);
  });

  it("says nothing about a defined variable whose status hasn't arrived", () => {
    expect(missingVariables({ HOST: "localhost", TOKEN: "${secret}" }, [], uses)).toEqual([]);
  });

  it("leaves out a variable nothing uses", () => {
    const status = [{ name: "UNUSED", source: VariableSource.UNSET, envName: "KAJA_UNUSED" }];
    expect(missingVariables({ HOST: "x", TOKEN: "y", UNUSED: "${secret}" }, status, uses)).toEqual([]);
  });

  it("lists each app once, and every app using it", () => {
    const status = [{ name: "HOST", source: VariableSource.UNSET, envName: "HOST" }];
    const missing = missingVariables({ HOST: "${env:HOST}", TOKEN: "t" }, status, uses);
    expect(missing).toEqual([{ name: "HOST", defined: true, apps: ["theatre", "box"] }]);
    expect(
      missingByApp(missing)
        .get("box")
        ?.map((variable) => variable.name),
    ).toEqual(["HOST"]);
  });

  it("says which of the two fixes it is", () => {
    expect(missingVariableSentence({ name: "TOKEN", defined: true })).toBe("${TOKEN} has no value on this machine");
    expect(missingVariableSentence({ name: "TOKEN", defined: false })).toBe("${TOKEN} isn't defined");
  });
});
