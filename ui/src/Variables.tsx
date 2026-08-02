import { Braces, Check, Copy, Ellipsis, KeyRound, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert } from "./components/alert";
import { Blankslate } from "./components/blankslate";
import { Button } from "./components/button";
import { ConfirmationDialog } from "./components/confirmation-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./components/dropdown-menu";
import { FormControl } from "./components/form-control";
import { IconButton } from "./components/icon-button";
import { Input } from "./components/input";
import { SimpleTooltip } from "./components/tooltip";
import { VariableSource, VariableStatus } from "./server/api";
import { SECRET_SOURCE, storedEnvName, variableKind, variableNameError, variableValueError } from "./variableExpansion";

interface VariableRow {
  key: string;
  value: string;
  // Value typed for a stored variable, waiting to be written to the store on
  // save. It is never read back, so it only ever lives here.
  pending?: string;
}

// VariablesSave is everything one Save does: the configuration, plus the value
// changes that don't belong in it.
export interface VariablesSave {
  variables: { [key: string]: string };
  stored: { name: string; value: string }[];
  cleared: string[];
}

interface VariablesProps {
  variables: { [key: string]: string };
  // Where each variable's value came from, as the server resolved it.
  status: VariableStatus[];
  // Whether this machine has anywhere to store a value outside kaja.json.
  storeAvailable: boolean;
  // App names referencing each variable, and the references no variable defines.
  usage: { [name: string]: string[] };
  readOnly?: boolean;
  onSave: (save: VariablesSave) => Promise<void>;
  onDirtyChange?: (dirty: boolean) => void;
}

// toRows lists the variables by name. The configuration is a JSON map, whose key
// order doesn't survive a round trip, so sorting is what keeps a row where the
// user last saw it.
function toRows(variables: { [key: string]: string }): VariableRow[] {
  return Object.entries(variables)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => ({ key, value }));
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

export function Variables({ variables, status, storeAvailable, usage, readOnly = false, onSave, onDirtyChange }: VariablesProps) {
  const [rows, setRows] = useState<VariableRow[]>(() => toRows(variables));
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | undefined>();
  // Rows whose stored value the user chose to replace, so the input shows again
  // for a variable that already has one.
  const [replacing, setReplacing] = useState<Set<number>>(new Set());
  // A row being switched to the machine's store where there is no store to put
  // it in: the value has to move to the environment, so it is shown once.
  const [movingToEnvironment, setMovingToEnvironment] = useState<{ index: number; name: string; value: string } | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const statusByName = useMemo(() => new Map(status.map((entry) => [entry.name, entry])), [status]);

  useEffect(() => {
    setRows(toRows(variables));
    setReplacing(new Set());
  }, [variables]);

  useEffect(() => () => clearTimeout(savedTimer.current), []);

  const dirty = useMemo(() => {
    if (rows.some((row) => row.pending)) return true;
    return JSON.stringify(toVariables(rows)) !== JSON.stringify(variables);
  }, [rows, variables]);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const update = useCallback((index: number, patch: Partial<VariableRow>) => {
    setSaved(false);
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }, []);

  const addRow = () => {
    setSaved(false);
    setRows((prev) => [...prev, { key: "", value: "" }]);
  };

  const removeRow = (index: number) => {
    setSaved(false);
    setRows((prev) => prev.filter((_, i) => i !== index));
  };

  // Switching a row to the machine's store drops its value from kaja.json. With
  // no store to put it in, that value would just be lost, so it is shown once
  // with the environment variable to paste it into.
  const storeOnThisMachine = (index: number) => {
    const row = rows[index];
    if (!storeAvailable && row.value && variableKind(row.value) === "value") {
      setMovingToEnvironment({ index, name: row.key.trim(), value: row.value });
      return;
    }
    update(index, { value: SECRET_SOURCE, pending: undefined });
  };

  const trimmedKeys = rows.map((row) => row.key.trim());
  const duplicateKey = trimmedKeys.some((key, i) => key !== "" && trimmedKeys.indexOf(key) !== i);
  const rowErrors = rows.map((row) => {
    const key = row.key.trim();
    if (key === "") return row.value === "" ? undefined : "Name a variable to give it a value.";
    return variableNameError(key) ?? variableValueError(row.value);
  });
  const invalid = duplicateKey || rowErrors.some(Boolean);

  // A ${NAME} an app uses that no variable defines. Requests send it literally.
  const undefinedReferences = Object.keys(usage)
    .filter((name) => !(name in variables))
    .sort();
  const unresolved = status.filter((entry) => entry.source === VariableSource.UNSET && entry.name in variables);

  const save = async () => {
    const stored: { name: string; value: string }[] = [];
    for (const row of rows) {
      const key = row.key.trim();
      if (key && row.pending) stored.push({ name: key, value: row.pending });
    }
    // A variable that stopped being stored - renamed, deleted, or switched back
    // to a value of its own - leaves nothing behind in the store.
    const nextVariables = toVariables(rows);
    const cleared = Object.keys(variables).filter(
      (name) => variableKind(variables[name]) === "stored" && (!(name in nextVariables) || variableKind(nextVariables[name]) !== "stored"),
    );

    setSaveError(undefined);
    try {
      await onSave({ variables: nextVariables, stored, cleared });
      setRows((prev) => prev.map((row) => ({ ...row, pending: undefined })));
      setReplacing(new Set());
      setSaved(true);
      clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setSaved(false), 3000);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    }
  };

  const revert = () => {
    setRows(toRows(variables));
    setReplacing(new Set());
    setSaved(false);
    setSaveError(undefined);
  };

  return (
    <div className="flex h-full flex-col bg-muted">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2">
        <Braces size={16} className="text-muted-foreground" />
        <span className="font-semibold">Variables</span>
      </div>

      {readOnly && (
        <div className="bg-amber-500/10 px-4 py-2 text-sm text-amber-600 dark:text-amber-400">
          Configuration is read-only. Contact your administrator for changes.
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        <div className="max-w-[860px] p-4">
          <FormControl.Caption>
            Reusable values for your apps and scripts. Reference one as <code>{"${NAME}"}</code> anywhere in an app's configuration — a URL, a token, a header —
            or read it in a script as <code>kaja.variables.&lt;name&gt;</code>.
            <br />
            Values are stored in plain text in kaja.json. A variable can instead take its value from this machine — your keychain, or an environment variable —
            and then it is never written to the file or shown here.
          </FormControl.Caption>

          {(undefinedReferences.length > 0 || unresolved.length > 0) && (
            <div className="mt-4 flex flex-col gap-2">
              {undefinedReferences.map((name) => (
                <Alert key={name} variant="warning" className="flex items-center justify-between gap-4">
                  <span>
                    <code>{"${" + name + "}"}</code> is used by {usage[name].join(", ")} but isn't defined.
                  </span>
                  {!readOnly && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setSaved(false);
                        setRows((prev) => [...prev, { key: name, value: "" }]);
                      }}
                    >
                      Define it
                    </Button>
                  )}
                </Alert>
              ))}
              {unresolved.map((entry) => (
                <Alert key={entry.name} variant="warning">
                  <code>{entry.name}</code> isn't set on this machine. Requests that use it will send <code>{"${" + entry.name + "}"}</code> literally.
                </Alert>
              ))}
            </div>
          )}

          {rows.length === 0 ? (
            <Blankslate>
              <Blankslate.Visual>
                <Braces size={32} />
              </Blankslate.Visual>
              <Blankslate.Heading>No variables</Blankslate.Heading>
              <Blankslate.Description>A base URL you reuse across apps, or a token you'd rather keep out of kaja.json.</Blankslate.Description>
              {!readOnly && <Blankslate.PrimaryAction onClick={addRow}>Add variable</Blankslate.PrimaryAction>}
            </Blankslate>
          ) : (
            <>
              <div className="mb-1 mt-4 flex gap-2 text-xs text-muted-foreground">
                <span className="flex-1 pl-5">Name</span>
                <span className="flex-[2]">Value</span>
                <span className="w-[104px]" />
              </div>

              <div className="flex flex-col gap-2">
                {rows.map((row, index) => (
                  <VariableRowEditor
                    key={index}
                    row={row}
                    error={rowErrors[index]}
                    status={statusByName.get(row.key.trim())}
                    storeAvailable={storeAvailable}
                    replacing={replacing.has(index)}
                    usedBy={usage[row.key.trim()]}
                    readOnly={readOnly}
                    onChange={(patch) => update(index, patch)}
                    onStore={() => storeOnThisMachine(index)}
                    onReplace={() => setReplacing((prev) => new Set(prev).add(index))}
                    onRemove={() => removeRow(index)}
                  />
                ))}
              </div>
            </>
          )}

          {duplicateKey && <div className="mt-2 text-xs text-destructive">Variable names must be unique.</div>}
          {saveError && (
            <Alert variant="danger" className="mt-3">
              {saveError}
            </Alert>
          )}

          {!readOnly && rows.length > 0 && (
            <div className="mt-3">
              <Button variant="ghost" onClick={addRow}>
                <Plus size={16} />
                Add variable
              </Button>
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center justify-end gap-3 border-t border-border p-4">
        {saved && (
          <span className="flex items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400">
            <Check size={14} />
            Saved
          </span>
        )}
        {!readOnly && (
          <>
            <Button variant="outline" onClick={revert} disabled={!dirty}>
              Cancel
            </Button>
            <Button onClick={save} disabled={invalid || !dirty}>
              Save Changes
            </Button>
          </>
        )}
      </div>

      {movingToEnvironment && (
        <ConfirmationDialog
          title="Move this value to the environment"
          confirmButtonContent="Remove from kaja.json"
          onClose={(gesture) => {
            if (gesture === "confirm") {
              update(movingToEnvironment.index, { value: SECRET_SOURCE, pending: undefined });
            }
            setMovingToEnvironment(null);
          }}
        >
          <span className="block">
            This machine has nowhere to store a value, so it will only be removed from kaja.json. Set{" "}
            <code>{storedEnvName(movingToEnvironment.name || "NAME")}</code> in the environment to supply it. This is the last time the value is shown:
          </span>
          <CopyableValue value={movingToEnvironment.value} />
        </ConfirmationDialog>
      )}
    </div>
  );
}

interface VariableRowEditorProps {
  row: VariableRow;
  error?: string;
  status?: VariableStatus;
  storeAvailable: boolean;
  replacing: boolean;
  usedBy?: string[];
  readOnly: boolean;
  onChange: (patch: Partial<VariableRow>) => void;
  onStore: () => void;
  onReplace: () => void;
  onRemove: () => void;
}

function VariableRowEditor({
  row,
  error,
  status,
  storeAvailable,
  replacing,
  usedBy,
  readOnly,
  onChange,
  onStore,
  onReplace,
  onRemove,
}: VariableRowEditorProps) {
  const kind = variableKind(row.value);
  const name = row.key.trim();

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <div className="flex flex-1 items-center gap-1.5">
          {/* Fixed slot so every name field starts at the same edge, marked or not. */}
          <span className="flex w-3.5 shrink-0 justify-center">{kind === "stored" && <KeyRound size={14} className="text-muted-foreground" />}</span>
          <Input value={row.key} onChange={(e) => onChange({ key: e.target.value })} placeholder="API_BASE_URL" disabled={readOnly} className="flex-1" />
        </div>

        <div className="flex-[2]">
          {kind === "stored" ? (
            <StoredValueCell
              name={name}
              status={status}
              storeAvailable={storeAvailable}
              pending={row.pending}
              replacing={replacing}
              readOnly={readOnly}
              onPendingChange={(pending) => onChange({ pending })}
              onReplace={onReplace}
            />
          ) : (
            <Input
              value={row.value}
              onChange={(e) => onChange({ value: e.target.value })}
              placeholder="https://api.example.com"
              disabled={readOnly}
              className="w-full"
            />
          )}
        </div>

        <div className="flex w-[104px] items-center justify-end gap-1">
          <UsedBy usedBy={usedBy} name={name} />
          {!readOnly && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton icon={Ellipsis} aria-label={`Options for ${name || "this variable"}`} variant="ghost" size="sm" tooltip={false} />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {kind !== "stored" && <DropdownMenuItem onSelect={onStore}>Store on this machine</DropdownMenuItem>}
                {kind !== "environment" && (
                  <DropdownMenuItem onSelect={() => onChange({ value: "${env:" + (name || "NAME") + "}", pending: undefined })}>
                    Read from an environment variable
                  </DropdownMenuItem>
                )}
                {kind !== "value" && <DropdownMenuItem onSelect={() => onChange({ value: "", pending: undefined })}>Use a plain value</DropdownMenuItem>}
                <DropdownMenuItem onSelect={onRemove}>Delete</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {error && <div className="pl-[2px] text-xs text-destructive">{error}</div>}
      {!error && kind === "environment" && <EnvironmentCaption status={status} />}
    </div>
  );
}

// StoredValueCell stands in for the value of a variable this machine holds. It
// never shows one: it says where the value came from, and offers to replace it.
function StoredValueCell({
  name,
  status,
  storeAvailable,
  pending,
  replacing,
  readOnly,
  onPendingChange,
  onReplace,
}: {
  name: string;
  status?: VariableStatus;
  storeAvailable: boolean;
  pending?: string;
  replacing: boolean;
  readOnly: boolean;
  onPendingChange: (value: string) => void;
  onReplace: () => void;
}) {
  const source = status?.source ?? VariableSource.UNSET;
  const envName = status?.envName || storedEnvName(name || "NAME");

  if (source === VariableSource.ENVIRONMENT) {
    return (
      <span className="flex h-9 items-center gap-1.5 text-sm text-muted-foreground">
        <KeyRound size={14} />
        From <code>{envName}</code>
      </span>
    );
  }

  if (source === VariableSource.KEYCHAIN && !replacing && pending === undefined) {
    return (
      <span className="flex h-9 items-center gap-1.5 text-sm text-muted-foreground">
        <KeyRound size={14} />
        Stored in your keychain
        {!readOnly && (
          <Button variant="link" size="sm" className="h-auto p-0" onClick={onReplace}>
            Replace
          </Button>
        )}
      </span>
    );
  }

  if (!storeAvailable) {
    return (
      <span className="flex h-9 items-center gap-1.5 text-sm text-muted-foreground">
        Not set — define <code>{envName}</code> in the environment
        <CopyButton value={envName + "="} label={`Copy ${envName}=`} />
      </span>
    );
  }

  return (
    <Input
      type="password"
      value={pending ?? ""}
      onChange={(e) => onPendingChange(e.target.value)}
      placeholder="Paste value"
      disabled={readOnly}
      className="w-full"
      autoComplete="off"
    />
  );
}

function EnvironmentCaption({ status }: { status?: VariableStatus }) {
  if (!status || !status.envName) return null;
  if (status.source === VariableSource.UNSET) {
    return (
      <div className="pl-[2px] text-xs text-amber-600 dark:text-amber-400">
        <code>{status.envName}</code> is not set in the environment.
      </div>
    );
  }
  return (
    <div className="pl-[2px] text-xs text-muted-foreground">
      From <code>{status.envName}</code>
    </div>
  );
}

function UsedBy({ usedBy, name }: { usedBy?: string[]; name: string }) {
  if (!name) return null;
  if (!usedBy || usedBy.length === 0) {
    return <span className="text-xs text-muted-foreground/60">Unused</span>;
  }
  return (
    <SimpleTooltip text={`${usedBy.join(", ")}. Scripts aren't scanned.`}>
      <span className="cursor-default text-xs text-muted-foreground">
        {usedBy.length} app{usedBy.length === 1 ? "" : "s"}
      </span>
    </SimpleTooltip>
  );
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <IconButton
      icon={copied ? Check : Copy}
      aria-label={label}
      variant="ghost"
      size="sm"
      tooltip={false}
      onClick={() => {
        navigator.clipboard?.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    />
  );
}

function CopyableValue({ value }: { value: string }) {
  return (
    <span className="mt-2 flex items-center gap-1 rounded border border-border bg-muted px-2 py-1 font-mono text-xs text-foreground">
      <span className="min-w-0 flex-1 break-all">{value}</span>
      <CopyButton value={value} label="Copy value" />
    </span>
  );
}
