import { Braces, Check, ChevronDown, CircleHelp, Copy, KeyRound, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert } from "./components/alert";
import { Blankslate } from "./components/blankslate";
import { Button } from "./components/button";
import { cn } from "./cn";
import { ConfirmationDialog } from "./components/confirmation-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./components/dropdown-menu";
import { IconButton } from "./components/icon-button";
import { Input } from "./components/input";
import { Popover, PopoverContent, PopoverTrigger } from "./components/popover";
import { SimpleTooltip } from "./components/tooltip";
import { VariableSource, VariableStatus } from "./server/api";
import { SECRET_SOURCE, VariableKind, environmentReferences, storedEnvName, variableKind, variableNameError, variableValueError } from "./variableExpansion";

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

// The source is the one decision on every row, so it is named on the row rather
// than inferred from what the value cell happens to render.
const SOURCE_LABEL: Record<VariableKind, string> = {
  value: "Value",
  stored: "Keychain",
  environment: "Environment",
};

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

// environmentName is the environment variable a row reads: the one its value
// references, or the one it would reference if it were switched over.
function environmentName(row: VariableRow): string {
  return environmentReferences(row.value)[0] || row.key.trim() || "NAME";
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
    setReplacing(new Set());
  };

  // Switching a row's source rewrites its value, because the value is what says
  // where it comes from. Only the machine's store needs a word first: it drops
  // the value from kaja.json, and with no store to put it in that value would
  // just be lost, so it is shown once with the environment variable to paste it
  // into.
  const setSource = (index: number, kind: VariableKind) => {
    const row = rows[index];
    if (variableKind(row.value) === kind) return;
    if (kind === "stored") {
      if (!storeAvailable && row.value && variableKind(row.value) === "value") {
        setMovingToEnvironment({ index, name: row.key.trim(), value: row.value });
        return;
      }
      update(index, { value: SECRET_SOURCE, pending: undefined });
      return;
    }
    if (kind === "environment") {
      update(index, { value: "${env:" + environmentName(row) + "}", pending: undefined });
      return;
    }
    update(index, { value: "", pending: undefined });
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
    <div className="flex h-full flex-col bg-background">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2">
        <Braces size={16} className="text-muted-foreground" />
        <span className="font-semibold">Variables</span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <div className="max-w-[860px] p-4">
          {/* Say what a variable is for; where a value lives is said where it is
              chosen, in the source picker, and in full behind the ? for anyone
              who wants the model. The empty state carries the whole story, so
              this line only appears once there is something to explain it for. */}
          {(rows.length > 0 || readOnly) && (
            <div className="flex items-start gap-2">
              <p className="min-w-0 flex-1 text-sm text-muted-foreground">
                {readOnly ? (
                  <>
                    This configuration is read-only. Values come from the container environment — set <code>KAJA_&lt;NAME&gt;</code> to supply one.
                  </>
                ) : (
                  <>
                    Write <code>{"${NAME}"}</code> in any app field, or read <code>kaja.variables.NAME</code> in a script.
                  </>
                )}
              </p>
              <StorageHelp />
            </div>
          )}

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
              <Blankslate.Heading>No variables yet</Blankslate.Heading>
              <Blankslate.Description>
                A variable is a value you write once and reference as <code>{"${NAME}"}</code> in any app field or script. Keep it in kaja.json, or keep it on
                this machine only.
              </Blankslate.Description>
              {!readOnly && <Blankslate.PrimaryAction onClick={addRow}>Add variable</Blankslate.PrimaryAction>}
            </Blankslate>
          ) : (
            <>
              <div className="mb-1 mt-4 flex gap-2 text-xs text-muted-foreground">
                <span className="flex-1">Name</span>
                {readOnly && <span className="w-[104px]">Source</span>}
                <span className="flex-[2]">Value</span>
                <span className="w-[92px]" />
              </div>

              <div className="flex flex-col gap-2">
                {rows.map((row, index) =>
                  readOnly ? (
                    <VariableRowStatic key={index} row={row} status={statusByName.get(row.key.trim())} usedBy={usage[row.key.trim()]} />
                  ) : (
                    <VariableRowEditor
                      key={index}
                      row={row}
                      error={rowErrors[index]}
                      status={statusByName.get(row.key.trim())}
                      storeAvailable={storeAvailable}
                      replacing={replacing.has(index)}
                      usedBy={usage[row.key.trim()]}
                      onChange={(patch) => update(index, patch)}
                      onSource={(kind) => setSource(index, kind)}
                      onReplace={() => setReplacing((prev) => new Set(prev).add(index))}
                      onRemove={() => removeRow(index)}
                    />
                  ),
                )}
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

      {!readOnly && (
        <div className="flex items-center justify-end gap-3 border-t border-border p-4">
          {saved && (
            <span className="flex items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400">
              <Check size={14} />
              Saved
            </span>
          )}
          <Button variant="outline" onClick={revert} disabled={!dirty}>
            Cancel
          </Button>
          <Button onClick={save} disabled={invalid || !dirty}>
            Save Changes
          </Button>
        </div>
      )}

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

// StorageHelp is the whole storage model, one click away from the sentence that
// doesn't carry it.
function StorageHelp() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <IconButton icon={CircleHelp} aria-label="Where variable values live" variant="ghost" size="sm" tooltip={false} />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[380px] p-3">
        <div className="flex flex-col gap-2 text-sm text-muted-foreground">
          <p>
            A variable's value either is the value — written in kaja.json — or names where it lives outside the file: your keychain, or an environment variable.
          </p>
          <p>
            Values kept outside kaja.json are never written to the file and never shown here, so the file is safe to commit: it only names what a workspace
            needs.
          </p>
          <p>
            A reference to an environment variable can sit inside a longer value, as in <code>{"https://${env:HOST}/v1"}</code>.
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
}

interface VariableRowEditorProps {
  row: VariableRow;
  error?: string;
  status?: VariableStatus;
  storeAvailable: boolean;
  replacing: boolean;
  usedBy?: string[];
  onChange: (patch: Partial<VariableRow>) => void;
  onSource: (kind: VariableKind) => void;
  onReplace: () => void;
  onRemove: () => void;
}

function VariableRowEditor({ row, error, status, storeAvailable, replacing, usedBy, onChange, onSource, onReplace, onRemove }: VariableRowEditorProps) {
  const kind = variableKind(row.value);
  const name = row.key.trim();
  const source = status?.source ?? VariableSource.UNSET;
  const storedEnv = status?.envName || storedEnvName(name || "NAME");
  // A keychain row on a machine with no store has nothing to take a value into:
  // it can only be supplied as KAJA_<NAME>, so the row says that under the field
  // instead of offering an input that goes nowhere.
  const needsEnvironment = kind === "stored" && !storeAvailable && source !== VariableSource.ENVIRONMENT;

  return (
    <div className="group flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <Input value={row.key} onChange={(e) => onChange({ key: e.target.value })} placeholder="API_BASE_URL" className="flex-1" />

        {/* The source picker is welded to the value it describes: one control
            that states the mode at rest and changes it in one click, and a field
            to its right that is whatever the mode needs. */}
        <div
          className={cn(
            "flex h-8 flex-[2] items-center overflow-hidden rounded-md border border-input bg-background shadow-sm focus-within:ring-2 focus-within:ring-ring",
            error && "border-destructive",
          )}
        >
          <SourcePicker kind={kind} name={name} environmentName={environmentName(row)} storeAvailable={storeAvailable} onSelect={onSource} />
          {kind === "stored" ? (
            <StoredValueCell
              storedEnv={storedEnv}
              source={source}
              storeAvailable={storeAvailable}
              pending={row.pending}
              replacing={replacing}
              onPendingChange={(pending) => onChange({ pending })}
              onReplace={onReplace}
            />
          ) : (
            <Input
              value={row.value}
              onChange={(e) => onChange({ value: e.target.value })}
              placeholder={kind === "environment" ? "${env:HOST}" : "https://api.example.com"}
              className="h-full rounded-none border-0 bg-transparent shadow-none focus-visible:ring-0"
            />
          )}
        </div>

        <div className="flex w-[92px] items-center justify-end gap-1">
          <UsedBy usedBy={usedBy} name={name} />
          {/* Delete isn't a mode, so it doesn't sit in the mode list. */}
          <IconButton
            icon={Trash2}
            aria-label={`Delete ${name || "this variable"}`}
            variant="ghost"
            size="sm"
            tooltip={false}
            className="opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
            onClick={onRemove}
          />
        </div>
      </div>

      {error && <div className="text-xs text-destructive">{error}</div>}
      {!error && kind === "environment" && <EnvironmentCaption status={status} />}
      {!error && needsEnvironment && (
        <div className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
          This machine has nowhere to store a value — define <code>{storedEnv}</code> in the environment.
          <CopyButton value={storedEnv + "="} label={`Copy ${storedEnv}=`} />
        </div>
      )}
    </div>
  );
}

// SourcePicker states where the value comes from, and is where it is changed.
function SourcePicker({
  kind,
  name,
  environmentName,
  storeAvailable,
  onSelect,
}: {
  kind: VariableKind;
  name: string;
  environmentName: string;
  storeAvailable: boolean;
  onSelect: (kind: VariableKind) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Source for ${name || "this variable"}: ${SOURCE_LABEL[kind]}`}
          className="flex h-full shrink-0 items-center gap-1 border-r border-input bg-secondary px-2 text-xs text-secondary-foreground outline-none transition-colors hover:bg-secondary/70"
        >
          {kind === "stored" && <KeyRound size={12} className="text-muted-foreground" />}
          {SOURCE_LABEL[kind]}
          <ChevronDown size={12} className="text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[300px]">
        <div className="px-2 py-1.5 text-xs text-muted-foreground">Where does this value come from?</div>
        <SourceItem selected={kind === "value"} label="Value" note="written in kaja.json" onSelect={() => onSelect("value")} />
        <SourceItem
          selected={kind === "stored"}
          label="Keychain"
          note={storeAvailable ? "stays on this machine" : `reads ${storedEnvName(name || "NAME")}`}
          onSelect={() => onSelect("stored")}
        />
        <SourceItem selected={kind === "environment"} label="Environment" note={environmentName} onSelect={() => onSelect("environment")} />
        <div className="mt-1 border-t border-border px-2 pb-0.5 pt-1.5 text-xs text-muted-foreground">
          Keychain and environment values never reach kaja.json.
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SourceItem({ selected, label, note, onSelect }: { selected: boolean; label: string; note: string; onSelect: () => void }) {
  return (
    <DropdownMenuItem onSelect={onSelect}>
      <span className="flex w-3.5 shrink-0 justify-center">{selected && <Check size={12} />}</span>
      <span className="min-w-0">
        {label} <span className="text-muted-foreground">— {note}</span>
      </span>
    </DropdownMenuItem>
  );
}

// StoredValueCell stands in for the value of a variable this machine holds. It
// never shows one: it says whether there is one, and offers to replace it.
function StoredValueCell({
  storedEnv,
  source,
  storeAvailable,
  pending,
  replacing,
  onPendingChange,
  onReplace,
}: {
  storedEnv: string;
  source: VariableSource;
  storeAvailable: boolean;
  pending?: string;
  replacing: boolean;
  onPendingChange: (value: string) => void;
  onReplace: () => void;
}) {
  if (source === VariableSource.ENVIRONMENT) {
    return (
      <span className="min-w-0 flex-1 truncate px-2 text-sm text-muted-foreground">
        From <code>{storedEnv}</code>
      </span>
    );
  }

  if (!storeAvailable) {
    return <span className="min-w-0 flex-1 truncate px-2 text-sm text-muted-foreground">Not set</span>;
  }

  if (source === VariableSource.KEYCHAIN && !replacing && pending === undefined) {
    return (
      <span className="flex min-w-0 flex-1 items-center gap-1 px-2 text-sm text-muted-foreground">
        Set ·
        <Button variant="link" size="sm" className="h-auto p-0" onClick={onReplace}>
          Replace
        </Button>
      </span>
    );
  }

  return (
    <Input
      type="password"
      value={pending ?? ""}
      onChange={(e) => onPendingChange(e.target.value)}
      placeholder="Paste value"
      className="h-full rounded-none border-0 bg-transparent shadow-none focus-visible:ring-0"
      autoComplete="off"
    />
  );
}

// A read-only configuration can't be edited into shape, so the row is the wiring
// information instead: the name, where the value comes from, and whether it
// arrived.
function VariableRowStatic({ row, status, usedBy }: { row: VariableRow; status?: VariableStatus; usedBy?: string[] }) {
  const kind = variableKind(row.value);
  const source = status?.source ?? VariableSource.UNSET;
  const envName = status?.envName || (kind === "stored" ? storedEnvName(row.key) : environmentName(row));

  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="min-w-0 flex-1 truncate font-mono text-xs">{row.key}</span>
      <span className="w-[104px] shrink-0 text-xs text-muted-foreground">{SOURCE_LABEL[kind]}</span>
      <span className="min-w-0 flex-[2] truncate">
        {kind === "value" ? (
          <span className="font-mono text-xs">{row.value}</span>
        ) : source === VariableSource.UNSET ? (
          <span className="text-xs text-amber-600 dark:text-amber-400">
            <code>{envName}</code> not set
          </span>
        ) : source === VariableSource.KEYCHAIN ? (
          <span className="text-xs text-muted-foreground">Stored in your keychain</span>
        ) : (
          <span className="text-xs text-muted-foreground">
            From <code>{envName}</code>
          </span>
        )}
      </span>
      <span className="flex w-[92px] justify-end">
        <UsedBy usedBy={usedBy} name={row.key} />
      </span>
    </div>
  );
}

function EnvironmentCaption({ status }: { status?: VariableStatus }) {
  if (!status || !status.envName) return null;
  if (status.source === VariableSource.UNSET) {
    return (
      <div className="text-xs text-amber-600 dark:text-amber-400">
        <code>{status.envName}</code> is not set in the environment.
      </div>
    );
  }
  return (
    <div className="text-xs text-muted-foreground">
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
      size="xs"
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
