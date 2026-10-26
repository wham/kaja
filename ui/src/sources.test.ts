import { describe, it, expect } from "bun:test";
import { remapEditorCode } from "./sources";

describe("remapEditorCode", () => {
  it("follows the bare app name, which is how an import names an app", () => {
    const code = 'import { Customers } from "OpenMeter";\nimport { kaja } from "kaja";\n';
    expect(remapEditorCode(code, "OpenMeter", "OpenMeterDev")).toBe('import { Customers } from "OpenMeterDev";\nimport { kaja } from "kaja";\n');
  });

  it("follows a module path under the app", () => {
    const code = 'import { Quirks } from "quirks/v1/quirks";\n';
    expect(remapEditorCode(code, "quirks", "quirks-dev")).toBe('import { Quirks } from "quirks-dev/v1/quirks";\n');
  });

  it("rewrites every import of the app in one pass", () => {
    const code = 'import { A } from "app";\nimport { B } from "app/v2/b";\n';
    expect(remapEditorCode(code, "app", "renamed")).toBe('import { A } from "renamed";\nimport { B } from "renamed/v2/b";\n');
  });

  it("leaves a specifier that merely starts with the same letters", () => {
    const code = 'import { A } from "OpenMeterCloud";\nimport { B } from "OpenMeter";\n';
    expect(remapEditorCode(code, "OpenMeter", "Metering")).toBe('import { A } from "OpenMeterCloud";\nimport { B } from "Metering";\n');
  });

  it("leaves the app's name where it is not a module", () => {
    const code = 'import { Repos } from "github";\nconst label = "github";\n// github\nawait Repos.github({});\n';
    expect(remapEditorCode(code, "github", "gh")).toBe('import { Repos } from "gh";\nconst label = "github";\n// github\nawait Repos.github({});\n');
  });

  it("keeps the author's quote style and the text around the import", () => {
    const code = "import   { Repos }   from 'github' ;\n";
    expect(remapEditorCode(code, "github", "gh")).toBe("import   { Repos }   from 'gh' ;\n");
  });

  it("follows a type-only import, a re-export and a dynamic one", () => {
    const code = 'import type { Repo } from "github";\nexport { Repos } from "github";\nconst m = await import("github/service");\n';
    expect(remapEditorCode(code, "github", "gh")).toBe('import type { Repo } from "gh";\nexport { Repos } from "gh";\nconst m = await import("gh/service");\n');
  });

  it("leaves a script naming no app alone", () => {
    const code = 'import { kaja } from "kaja";\nkaja.text("hello");\n';
    expect(remapEditorCode(code, "github", "gh")).toBe(code);
  });
});
