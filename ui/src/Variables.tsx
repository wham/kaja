import { Plus, Trash2 } from "lucide-react";
import { Button } from "./components/button";
import { FormControl } from "./components/form-control";
import { IconButton } from "./components/icon-button";
import { Input } from "./components/input";
import { useEffect, useState } from "react";

interface VariableRow {
  key: string;
  value: string;
}

interface VariablesProps {
  variables: { [key: string]: string };
  readOnly?: boolean;
  onSubmit: (variables: { [key: string]: string }) => void;
  onCancel: () => void;
}

function toRows(variables: { [key: string]: string }): VariableRow[] {
  return Object.entries(variables).map(([key, value]) => ({ key, value }));
}

// toVariables collapses the edited rows back into the on-disk map, trimming keys
// and dropping empty ones. Later rows win on duplicate keys.
function toVariables(rows: VariableRow[]): { [key: string]: string } {
  const variables: { [key: string]: string } = {};
  for (const row of rows) {
    const key = row.key.trim();
    if (key) variables[key] = row.value;
  }
  return variables;
}

export function Variables({ variables, readOnly = false, onSubmit, onCancel }: VariablesProps) {
  const [rows, setRows] = useState<VariableRow[]>(() => toRows(variables));

  useEffect(() => {
    setRows(toRows(variables));
  }, [variables]);

  const updateRow = (index: number, patch: Partial<VariableRow>) => {
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  const addRow = () => setRows((prev) => [...prev, { key: "", value: "" }]);
  const removeRow = (index: number) => setRows((prev) => prev.filter((_, i) => i !== index));

  const trimmedKeys = rows.map((row) => row.key.trim()).filter((key) => key !== "");
  const duplicateKey = trimmedKeys.some((key, i) => trimmedKeys.indexOf(key) !== i);

  return (
    <div className="flex h-full flex-col bg-muted">
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <span className="font-semibold">Variables</span>
      </div>

      {readOnly && (
        <div className="bg-amber-500/10 px-4 py-2 text-sm text-amber-600 dark:text-amber-400">
          Configuration is read-only. Contact your administrator for changes.
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        <div className="max-w-[720px] p-4">
          <FormControl.Caption>
            Reusable values for your scripts, read as <code>kaja.variables.&lt;name&gt;</code>, and for app configuration, referenced as{" "}
            <code>{"${name}"}</code> in any value or part of it (a URL, a token, a header). For non-sensitive values only — they are stored in plain text in
            kaja.json.
          </FormControl.Caption>

          {rows.length > 0 && (
            <div className="mb-1 mt-4 flex gap-2 text-xs text-muted-foreground">
              <span className="flex-1">Name</span>
              <span className="flex-[2]">Value</span>
              <span className="w-8" />
            </div>
          )}

          <div className="flex flex-col gap-2">
            {rows.map((row, index) => (
              <div key={index} className="flex items-center gap-2">
                <Input
                  value={row.key}
                  onChange={(e) => updateRow(index, { key: e.target.value })}
                  placeholder="API_BASE_URL"
                  disabled={readOnly}
                  className="flex-1"
                />
                <Input
                  value={row.value}
                  onChange={(e) => updateRow(index, { value: e.target.value })}
                  placeholder="https://api.example.com"
                  disabled={readOnly}
                  className="flex-[2]"
                />
                <IconButton icon={Trash2} aria-label="Remove variable" variant="ghost" onClick={() => removeRow(index)} disabled={readOnly} />
              </div>
            ))}
          </div>

          {duplicateKey && <div className="mt-2 text-xs text-destructive">Variable names must be unique.</div>}

          {!readOnly && (
            <div className="mt-3">
              <Button variant="ghost" onClick={addRow}>
                <Plus size={16} />
                Add variable
              </Button>
            </div>
          )}
        </div>
      </div>

      <div className="flex justify-end gap-2 border-t border-border p-4">
        <Button variant="outline" onClick={onCancel}>
          {readOnly ? "Close" : "Cancel"}
        </Button>
        {!readOnly && (
          <Button onClick={() => onSubmit(toVariables(rows))} disabled={duplicateKey}>
            Save Changes
          </Button>
        )}
      </div>
    </div>
  );
}
