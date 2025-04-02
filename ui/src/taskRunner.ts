import ts from "typescript";
import { Kaja } from "./kaja";
import { Client, Project } from "./project";

export function runTask(code: string, kaja: Kaja, projects: Project[]) {
  const file = ts.createSourceFile("task.ts", code, ts.ScriptTarget.Latest);
  const args: { [key: string]: Client | Object } = {};

  file.statements.forEach((statement) => {
    if (ts.isImportDeclaration(statement)) {
      // slice(1, -1) - remove quotes
      const path = statement.moduleSpecifier.getText(file).slice(1, -1)
      const project = projects.find((project) => path.includes(project.name));
      if (!project) {
        return;
      }
      const source = project.sources.find((source) => source.importPath === path);
      if (!source) {
        return;
      }

      const importClause = statement.importClause;
      if (importClause && importClause.namedBindings && ts.isNamedImports(importClause.namedBindings)) {
        importClause.namedBindings.elements.forEach((importSpecifier) => {
          const alias = importSpecifier.name.text;
          const name = importSpecifier.propertyName ? importSpecifier.propertyName.text : alias;
          if (project.clients[name]) {
            project.clients[name].kaja = kaja;
            args[alias] = project.clients[name].methods;
          } else if (source.enums[name]) {
            args[alias] = source.enums[name].object;
          }
        });
      }
    }
  });

  let lines = code.split("\n"); // split the code into lines

  let isInImport = false;
  // remove import statements
  while (lines.length > 0 && (lines[0].startsWith("import ") || isInImport)) {
    isInImport = !lines[0].endsWith(";");
    lines.shift();
  }

  // Wrap the user's code in an async function so async keyword can be used
  const func = new Function(
    ...Object.keys(args),
    "kaja",
    `
    return (async function() {
      ${lines.join("\n")}
    })();
  `,
  );

  func(...Object.values(args), kaja);
}
