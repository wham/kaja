import ts from "typescript";

export function runTask(code: string) {
  const file = ts.createSourceFile("task.ts", code, ts.ScriptTarget.Latest);

  file.statements.forEach((statement) => {
    if (ts.isImportDeclaration(statement)) {
      const importClause = statement.importClause;
      if (importClause && importClause.namedBindings && ts.isNamedImports(importClause.namedBindings)) {
        importClause.namedBindings.elements.forEach((importSpecifier) => {
          console.log(importSpecifier.name.text);
        })
      }
      console.log(statement.moduleSpecifier.getText(file));
    }
  });

  
}