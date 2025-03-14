import ts from "typescript";
import { Kaja } from "./kaja";
import { Client, Project } from "./project";

export function runTask(code: string, kaja: Kaja, projects: Project[]) {
  const file = ts.createSourceFile("task.ts", code, ts.ScriptTarget.Latest);
  const clients: { [key: string]: Client } = {};

  file.statements.forEach((statement) => {
    if (ts.isImportDeclaration(statement)) {
      const path = statement.moduleSpecifier.getText(file);
      const project = projects.find((project) => path.includes(project.name));
      if (!project) {
        return;
      }

      const importClause = statement.importClause;
      if (importClause && importClause.namedBindings && ts.isNamedImports(importClause.namedBindings)) {
        importClause.namedBindings.elements.forEach((importSpecifier) => {
          const name = importSpecifier.name.text;
          if (project.clients[name]) {
            clients[name] = project.clients[name];
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

  for (const client of Object.values(clients)) {
    client.kaja = kaja;
  }

  // Wrap the user's code in an async function so async keyword can be used
  const func = new Function(
    ...Object.keys(clients),
    "kaja",
    `
    return (async function() {
      ${lines.join("\n")}
    })();
  `,
  );

  func(...Object.values(clients).map((client) => client.methods), kaja);
}
