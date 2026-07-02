import { PlusIcon, TrashIcon } from "@primer/octicons-react";
import { Button, FormControl, IconButton, TextInput } from "@primer/react";
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
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--bgColor-muted)" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "8px 16px",
          borderBottom: "1px solid var(--borderColor-default)",
        }}
      >
        <span style={{ fontWeight: 600 }}>Variables</span>
      </div>

      {readOnly && (
        <div style={{ padding: "8px 16px", background: "var(--bgColor-attention-muted)", color: "var(--fgColor-attention)", fontSize: 14 }}>
          Configuration is read-only. Contact your administrator for changes.
        </div>
      )}

      <div style={{ flex: 1, overflow: "auto", minHeight: 0 }}>
        <div style={{ maxWidth: 720, padding: 16 }}>
          <FormControl.Caption>
            Reusable values for your scripts, read as <code>kaja.variables.&lt;name&gt;</code>, and for app configuration, referenced as{" "}
            <code>{"${name}"}</code> in any value or part of it (a URL, a token, a header). For non-sensitive values only — they are stored in plain text in
            kaja.json.
          </FormControl.Caption>

          {rows.length > 0 && (
            <div style={{ display: "flex", gap: 8, marginTop: 16, marginBottom: 4, fontSize: 12, color: "var(--fgColor-muted)" }}>
              <span style={{ flex: 1 }}>Name</span>
              <span style={{ flex: 2 }}>Value</span>
              <span style={{ width: 32 }} />
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {rows.map((row, index) => (
              <div key={index} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <TextInput
                  value={row.key}
                  onChange={(e) => updateRow(index, { key: e.target.value })}
                  placeholder="API_BASE_URL"
                  disabled={readOnly}
                  style={{ flex: 1 }}
                />
                <TextInput
                  value={row.value}
                  onChange={(e) => updateRow(index, { value: e.target.value })}
                  placeholder="https://api.example.com"
                  disabled={readOnly}
                  style={{ flex: 2 }}
                />
                <IconButton icon={TrashIcon} aria-label="Remove variable" variant="invisible" onClick={() => removeRow(index)} disabled={readOnly} />
              </div>
            ))}
          </div>

          {duplicateKey && <div style={{ marginTop: 8, color: "var(--fgColor-danger)", fontSize: 12 }}>Variable names must be unique.</div>}

          {!readOnly && (
            <div style={{ marginTop: 12 }}>
              <Button leadingVisual={PlusIcon} variant="invisible" onClick={addRow}>
                Add variable
              </Button>
            </div>
          )}
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", padding: 16, borderTop: "1px solid var(--borderColor-default)" }}>
        <Button onClick={onCancel}>{readOnly ? "Close" : "Cancel"}</Button>
        {!readOnly && (
          <Button variant="primary" onClick={() => onSubmit(toVariables(rows))} disabled={duplicateKey}>
            Save Changes
          </Button>
        )}
      </div>
    </div>
  );
}
