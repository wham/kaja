import { Braces, Check, ChevronDown, CircleAlert, Copy, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { copyText } from "./clipboard";
import { Alert } from "./components/alert";
import { Blankslate } from "./components/blankslate";
import { Button } from "./components/button";
import { cn } from "./cn";
import { ConfirmationDialog } from "./components/confirmation-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./components/dropdown-menu";
import { FormControl } from "./components/form-control";
import { IconButton } from "./components/icon-button";
import { Input } from "./components/input";
import { Spinner } from "./components/spinner";
import { SimpleTooltip } from "./components/tooltip";
import { VariableSource, VariableStatus } from "./server/api";
import { SECRET_SOURCE, VariableKind, environmentReferences, storedEnvName, variableKind, variableNameError, variableValueError } from "./variableExpansion";
import { rpcErrorMessage } from "./rpcMessage";

interface VariableRow {
  key: string;
  value: string;
}

export interface VariablesSave {
  variables: { [key: string]: string };
  cleared: string[];
}

interface VariablesProps {
  variables: { [key: string]: string };
  status: VariableStatus[];
  storeAvailable: boolean;
  usage: { [name: string]: string[] };
  readOnly?: boolean;
  onSave: (save: VariablesSave) => Promise<void>;
  onStoreValue: (name: string, value: string) => Promise<void>;
}

const SOURCE_LABEL: Record<VariableKind, string> = {
  value: "Value",
  stored: "Keychain",
  environment: "Environment",
};

const AUTOSAVE_MS = 600;

function toRows(variables: { [key: string]: string }): VariableRow[] {
  return Object.entries(variables)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => ({ key, value }));
}

function toVariables(rows: VariableRow[]): { [key: string]: string } {
  const variables: { [key: string]: string } = {};
  for (const row of rows) {
    const key = row.key.trim();
    if (key) variables[key] = row.value;
  }
  return variables;
}

function environmentName(row: VariableRow): string {
  return environmentReferences(row.value)[0] || row.key.trim() || "NAME";
}

function sameVariables(a: { [key: string]: string }, b: { [key: string]: string }): boolean {
  const names = Object.keys(a);
  return names.length === Object.keys(b).length && names.every((name) => name in b && a[name] === b[name]);
}

export function shouldAdoptIncomingVariables(
  current: { [key: string]: string },
  previous: { [key: string]: string },
  incoming: { [key: string]: string },
  submitted: { [key: string]: string } | undefined,
  editedSinceSubmission: boolean,
): boolean {
  const acknowledgingSubmission = submitted !== undefined && sameVariables(incoming, submitted);
  return sameVariables(current, previous) && !(editedSinceSubmission && acknowledgingSubmission);
}

export function Variables({ variables, status, storeAvailable, usage, readOnly = false, onSave, onStoreValue }: VariablesProps) {
  const [rows, setRows] = useState<VariableRow[]>(() => toRows(variables));
  const [editVersion, setEditVersion] = useState(0);
  const [saving, setSaving] = useState(false);
  const [pendingStoredWrites, setPendingStoredWrites] = useState(0);
  const [configurationError, setConfigurationError] = useState<string>();
  const [storedValueError, setStoredValueError] = useState<string>();
  const [entering, setEntering] = useState<Set<number>>(new Set());
  const [justStored, setJustStored] = useState<Set<string>>(new Set());
  const [movingToEnvironment, setMovingToEnvironment] = useState<{ index: number; name: string; value: string } | null>(null);
  const [focusRow, setFocusRow] = useState<number | null>(null);
  const nameInputs = useRef<Map<number, HTMLInputElement>>(new Map());
  const variablesRef = useRef(variables);
  const editVersionRef = useRef(editVersion);
  const attemptedVersionRef = useRef(-1);
  const submittedVersionRef = useRef<number | undefined>(undefined);
  const submittedVariablesRef = useRef<{ [key: string]: string } | undefined>(undefined);
  const onSaveRef = useRef(onSave);
  const storedWriteChainRef = useRef<Promise<void>>(Promise.resolve());
  editVersionRef.current = editVersion;
  onSaveRef.current = onSave;

  const statusByName = useMemo(() => new Map(status.map((entry) => [entry.name, entry])), [status]);

  useEffect(() => {
    if (entering.size > 0) return;
    const previous = variablesRef.current;
    variablesRef.current = variables;
    const submittedVersion = submittedVersionRef.current;
    const editedSinceSubmission = submittedVersion !== undefined && editVersionRef.current > submittedVersion;
    const submittedVariables = submittedVariablesRef.current;
    setRows((current) =>
      shouldAdoptIncomingVariables(toVariables(current), previous, variables, submittedVariables, editedSinceSubmission) ? toRows(variables) : current,
    );
    if (submittedVariables !== undefined && sameVariables(variables, submittedVariables)) {
      submittedVersionRef.current = undefined;
      submittedVariablesRef.current = undefined;
    }
  }, [entering.size, variables]);

  useEffect(() => {
    if (focusRow === null) return;
    nameInputs.current.get(focusRow)?.focus();
    setFocusRow(null);
  }, [focusRow, rows.length]);

  const edited = useMemo(() => toVariables(rows), [rows]);
  const dirty = !sameVariables(edited, variables);

  const markEdited = useCallback(() => {
    setEditVersion((version) => {
      editVersionRef.current = version + 1;
      return version + 1;
    });
  }, []);

  const update = useCallback(
    (index: number, patch: Partial<VariableRow>) => {
      markEdited();
      setRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
    },
    [markEdited],
  );

  const addRow = () => {
    const blank = rows.findIndex((row) => row.key.trim() === "" && row.value === "");
    if (blank !== -1) {
      setFocusRow(blank);
      return;
    }
    markEdited();
    setRows((prev) => [...prev, { key: "", value: "" }]);
    setFocusRow(rows.length);
  };

  const removeRow = (index: number, focus?: number) => {
    markEdited();
    setRows((prev) => prev.filter((_, i) => i !== index));
    setEntering(new Set());
    if (focus !== undefined) setFocusRow(focus);
  };

  const setSource = (index: number, kind: VariableKind) => {
    const row = rows[index];
    if (variableKind(row.value) === kind) return;
    if (kind === "stored") {
      if (!storeAvailable && row.value && variableKind(row.value) === "value") {
        setMovingToEnvironment({ index, name: row.key.trim(), value: row.value });
        return;
      }
      update(index, { value: SECRET_SOURCE });
      return;
    }
    if (kind === "environment") {
      update(index, { value: "${env:" + environmentName(row) + "}" });
      return;
    }
    update(index, { value: "" });
  };

  const trimmedKeys = rows.map((row) => row.key.trim());
  const duplicateKey = trimmedKeys.some((key, i) => key !== "" && trimmedKeys.indexOf(key) !== i);
  const rowErrors = rows.map((row) => {
    const key = row.key.trim();
    if (key === "") return row.value === "" ? undefined : "Name a variable to give it a value.";
    return variableNameError(key) ?? variableValueError(row.value);
  });
  const invalid = duplicateKey || rowErrors.some(Boolean);

  // A ${NAME} an app uses that no variable defines; requests send it literally. Read
  // from the rows rather than the file, so deleting a variable two apps use says so at
  // once instead of after the save.
  const defined = new Set(trimmedKeys.filter(Boolean));
  const undefinedReferences = Object.keys(usage)
    .filter((name) => usage[name].length > 0 && !defined.has(name))
    .sort();
  const unresolved = status.filter((entry) => entry.source === VariableSource.UNSET && entry.name in variables);

  useEffect(() => {
    if (readOnly || !dirty || invalid || saving || attemptedVersionRef.current === editVersion) return;

    const timer = setTimeout(() => {
      const version = editVersion;
      const snapshot = edited;
      attemptedVersionRef.current = version;
      submittedVersionRef.current = version;
      submittedVariablesRef.current = snapshot;
      setSaving(true);
      setConfigurationError(undefined);

      const cleared = Object.keys(variables).filter(
        (name) => variableKind(variables[name]) === "stored" && (!(name in snapshot) || variableKind(snapshot[name]) !== "stored"),
      );

      void onSaveRef
        .current({ variables: snapshot, cleared })
        .catch((error) => setConfigurationError(rpcErrorMessage(error)))
        .finally(() => setSaving(false));
    }, AUTOSAVE_MS);

    return () => clearTimeout(timer);
  }, [dirty, editVersion, edited, invalid, readOnly, saving, variables]);

  const storeValue = async (index: number, value: string) => {
    const name = rows[index].key.trim();
    if (!name) return;
    setEntering((prev) => {
      const next = new Set(prev);
      next.delete(index);
      return next;
    });
    setPendingStoredWrites((count) => count + 1);
    setStoredValueError(undefined);
    const write = storedWriteChainRef.current.then(() => onStoreValue(name, value));
    storedWriteChainRef.current = write.then(
      () => undefined,
      () => undefined,
    );
    try {
      await write;
      setStoredValueError(undefined);
      setJustStored((prev) => new Set(prev).add(name));
    } catch (error) {
      setStoredValueError(rpcErrorMessage(error));
    } finally {
      setPendingStoredWrites((count) => count - 1);
    }
  };

  const body =
    rows.length === 0 ? (
      // Centred in the body band rather than the whole pane: the footer below it is chrome
      // the blankslate has to sit clear of.
      <div className="flex min-h-0 flex-1 items-center justify-center px-4">
        <Blankslate className="max-w-[340px] py-0">
          <Blankslate.Visual>
            <Braces size={24} />
          </Blankslate.Visual>
          <Blankslate.Heading>No variables yet</Blankslate.Heading>
          <Blankslate.Description>
            {readOnly ? (
              <>
                This configuration is read-only, and it names no variables. Values come from the container environment, under <code>KAJA_&lt;NAME&gt;</code>.
              </>
            ) : (
              <>
                A variable is a value you write once and reference as <code>{"${NAME}"}</code> in any app field or script. Keep it in kaja.json, or keep it on
                this machine only.
              </>
            )}
          </Blankslate.Description>
          {!readOnly && (
            <Blankslate.PrimaryAction onClick={addRow}>
              <Plus size={14} />
              Add variable
            </Blankslate.PrimaryAction>
          )}
        </Blankslate>
      </div>
    ) : (
      <div className="flex min-h-0 flex-1 flex-col overflow-auto px-4 pt-3.5">
        {/* A read-only configuration can't be edited into shape, so the screen
            says what to do instead of offering controls that do nothing. */}
        {readOnly && (
          <p className="pb-3 text-xs text-muted-foreground">
            Values come from the container environment. Set <code>KAJA_&lt;NAME&gt;</code> to supply one.
          </p>
        )}

        {(undefinedReferences.length > 0 || unresolved.length > 0) && (
          <div className="flex shrink-0 flex-col gap-2 pb-3">
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
                      markEdited();
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

        <div className="flex h-[26px] shrink-0 items-center gap-3 px-1 text-xs text-muted-foreground">
          <span className="w-[168px]">Name</span>
          {readOnly && <span className="w-[104px]">Source</span>}
          <span className="flex-1">Value</span>
          <span className="w-16">Used by</span>
          <span className="w-5" />
        </div>

        {rows.map((row, index) =>
          readOnly ? (
            <VariableRowStatic key={index} row={row} status={statusByName.get(row.key.trim())} usedBy={usage[row.key.trim()]} />
          ) : (
            <VariableRowEditor
              key={index}
              index={index}
              row={row}
              error={rowErrors[index]}
              status={statusByName.get(row.key.trim())}
              storeAvailable={storeAvailable}
              entering={entering.has(index)}
              justStored={justStored.has(row.key.trim())}
              usedBy={usage[row.key.trim()]}
              nameRef={(element) => {
                if (element) nameInputs.current.set(index, element);
                else nameInputs.current.delete(index);
              }}
              onChange={(patch) => update(index, patch)}
              onSource={(kind) => setSource(index, kind)}
              onEnterValue={() => setEntering((prev) => new Set(prev).add(index))}
              onStoreValue={(value) => storeValue(index, value)}
              onCancelValue={() =>
                setEntering((prev) => {
                  const next = new Set(prev);
                  next.delete(index);
                  return next;
                })
              }
              onRemove={(focus) => removeRow(index, focus)}
              onAddRow={index === rows.length - 1 ? addRow : undefined}
              isLast={index === rows.length - 1}
            />
          ),
        )}

        {/* The add row sits where the new row will appear, inside the table. */}
        {!readOnly && (
          <button
            type="button"
            onClick={addRow}
            className="flex h-9 shrink-0 items-center gap-1.5 border-t border-border px-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <Plus size={13} />
            Add variable
          </button>
        )}

        {duplicateKey && <FormControl.Validation className="mt-2 px-1">Variable names must be unique.</FormControl.Validation>}
      </div>
    );

  return (
    <div className="flex h-full flex-col bg-background">
      {body}

      {!readOnly && (
        <div className="flex h-[52px] shrink-0 items-center justify-end gap-2 border-t border-border px-4">
          {saving || pendingStoredWrites > 0 ? (
            <>
              <Spinner className="size-[13px]" />
              <span className="text-xs text-muted-foreground">Saving…</span>
            </>
          ) : configurationError || storedValueError ? (
            <SimpleTooltip
              text={storedValueError ?? configurationError ?? ""}
              contentClassName="max-w-[300px] whitespace-normal break-words font-mono leading-5"
            >
              <span className="flex cursor-default items-center gap-2 text-xs text-destructive underline decoration-dotted underline-offset-4">
                <CircleAlert size={13} />
                Not saved
              </span>
            </SimpleTooltip>
          ) : (
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              <Check size={13} />
              Saved
            </span>
          )}
        </div>
      )}

      {movingToEnvironment && (
        <ConfirmationDialog
          title="Move this value to the environment"
          confirmButtonContent="Remove from kaja.json"
          onClose={(gesture) => {
            if (gesture === "confirm") {
              update(movingToEnvironment.index, { value: SECRET_SOURCE });
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
  index: number;
  row: VariableRow;
  error?: string;
  status?: VariableStatus;
  storeAvailable: boolean;
  entering: boolean;
  // Counting one written just now for a variable the file doesn't name yet.
  justStored: boolean;
  usedBy?: string[];
  isLast: boolean;
  nameRef: (element: HTMLInputElement | null) => void;
  onChange: (patch: Partial<VariableRow>) => void;
  onSource: (kind: VariableKind) => void;
  onEnterValue: () => void;
  onStoreValue: (value: string) => void;
  onCancelValue: () => void;
  onRemove: (focus?: number) => void;
  onAddRow?: () => void;
}

function VariableRowEditor({
  index,
  row,
  error,
  status,
  storeAvailable,
  entering,
  justStored,
  usedBy,
  isLast,
  nameRef,
  onChange,
  onSource,
  onEnterValue,
  onStoreValue,
  onCancelValue,
  onRemove,
  onAddRow,
}: VariableRowEditorProps) {
  const kind = variableKind(row.value);
  const name = row.key.trim();
  const source = status?.source ?? VariableSource.UNSET;
  const storedEnv = status?.envName || storedEnvName(name || "NAME");
  // A keychain row on a machine with no store has nothing to take a value into: it can
  // only be supplied as KAJA_<NAME>, so the row says that instead of offering an input
  // that goes nowhere.
  const needsEnvironment = kind === "stored" && !storeAvailable && source !== VariableSource.ENVIRONMENT;
  // Deleting a variable an app reads breaks that reference, so the count says so while
  // the gesture that would do it is under the pointer.
  const [deleteHovered, setDeleteHovered] = useState(false);

  return (
    <div className="group flex min-h-[44px] shrink-0 flex-col justify-center gap-1 border-t border-border px-1 py-1.5">
      <div className="flex items-center gap-3">
        <Input
          ref={nameRef}
          value={row.key}
          onChange={(e) => onChange({ key: e.target.value })}
          onKeyDown={(e) => {
            // An empty new row is undone by the key that emptied it.
            if (e.key === "Backspace" && row.key === "" && row.value === "") {
              e.preventDefault();
              onRemove(Math.max(0, index - 1));
            }
          }}
          placeholder="API_BASE_URL"
          className="w-[168px] shrink-0 font-mono text-xs"
        />

        {/* The source picker is welded to the value it describes: one control
            that states the mode at rest and changes it in one click, and a field
            to its right that is whatever the mode needs. */}
        <div className="flex min-w-0 flex-1 items-center">
          <SourcePicker kind={kind} name={name} environmentName={environmentName(row)} storeAvailable={storeAvailable} onSelect={onSource} />
          <div
            className={cn(
              "-ml-px flex h-8 min-w-0 flex-1 items-center rounded-r-md border border-input bg-background shadow-sm focus-within:relative focus-within:ring-2 focus-within:ring-ring",
              error && "border-destructive",
            )}
          >
            {kind === "stored" ? (
              <StoredValueCell
                storedEnv={storedEnv}
                source={source}
                held={source === VariableSource.KEYCHAIN || justStored}
                storeAvailable={storeAvailable}
                named={Boolean(name)}
                entering={entering}
                onEnter={onEnterValue}
                onStore={onStoreValue}
                onCancel={onCancelValue}
              />
            ) : (
              <>
                <Input
                  value={row.value}
                  onChange={(e) => onChange({ value: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && isLast && onAddRow) {
                      e.preventDefault();
                      onAddRow();
                    }
                  }}
                  placeholder={kind === "environment" ? "${env:HOST}" : "https://api.example.com"}
                  className="h-full rounded-none border-0 bg-transparent px-2.5 font-mono text-xs shadow-none focus-visible:ring-0"
                />
                {kind === "environment" && status && (
                  <span
                    className={cn(
                      "shrink-0 pr-2.5 text-xs",
                      status.source === VariableSource.UNSET ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400",
                    )}
                  >
                    {status.source === VariableSource.UNSET ? "not set" : "resolved"}
                  </span>
                )}
              </>
            )}
          </div>
        </div>

        <span className="w-16 shrink-0">
          <UsedBy usedBy={usedBy} name={name} warn={deleteHovered} />
        </span>
        {/* Delete isn't a mode, so it doesn't sit in the mode list. */}
        <span className="flex w-5 shrink-0 justify-center">
          <IconButton
            icon={Trash2}
            aria-label={`Delete ${name || "this variable"}`}
            variant="ghost"
            size="xs"
            tooltip={false}
            className="opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
            onMouseEnter={() => setDeleteHovered(true)}
            onMouseLeave={() => setDeleteHovered(false)}
            onFocus={() => setDeleteHovered(true)}
            onBlur={() => setDeleteHovered(false)}
            onClick={() => onRemove()}
          />
        </span>
      </div>

      {error && <FormControl.Validation>{error}</FormControl.Validation>}
      {!error && entering && storeAvailable && (
        <FormControl.Caption>
          {name ? "Press ⏎ to write it to this machine's keychain. Keychain values are stored at once." : "Name the variable first."}
        </FormControl.Caption>
      )}
      {!error && needsEnvironment && (
        <span className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
          This machine has nowhere to store a value — define <code>{storedEnv}</code> in the environment.
          <CopyButton value={storedEnv + "="} label={`Copy ${storedEnv}=`} />
        </span>
      )}
    </div>
  );
}

// `bg-muted` rather than a button surface, so it reads as part of the field.
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
          className="flex h-8 shrink-0 items-center gap-1 rounded-l-md border border-input bg-muted px-2 text-xs text-muted-foreground outline-none transition-colors hover:bg-accent focus-visible:relative focus-visible:ring-2 focus-visible:ring-ring"
        >
          {SOURCE_LABEL[kind]}
          <ChevronDown size={11} />
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

// StoredValueCell never shows the value: it says whether there is one, and offers to
// replace it.
function StoredValueCell({
  storedEnv,
  source,
  held,
  storeAvailable,
  named,
  entering,
  onEnter,
  onStore,
  onCancel,
}: {
  storedEnv: string;
  source: VariableSource;
  held: boolean;
  storeAvailable: boolean;
  named: boolean;
  entering: boolean;
  onEnter: () => void;
  onStore: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState("");

  if (entering && storeAvailable) {
    return (
      <Input
        type="password"
        value={value}
        autoFocus
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && value && named) {
            e.preventDefault();
            onStore(value);
            setValue("");
          }
          if (e.key === "Escape") {
            e.preventDefault();
            setValue("");
            onCancel();
          }
        }}
        onBlur={() => {
          if (value && named) {
            onStore(value);
            setValue("");
          } else {
            onCancel();
          }
        }}
        placeholder="Paste value"
        className="h-full rounded-none border-0 bg-transparent px-2.5 text-xs shadow-none focus-visible:ring-0"
        autoComplete="off"
      />
    );
  }

  if (!held && source === VariableSource.ENVIRONMENT) {
    return (
      <span className="min-w-0 flex-1 truncate px-2.5 text-xs text-muted-foreground">
        From <code>{storedEnv}</code>
      </span>
    );
  }

  if (!storeAvailable) {
    return <span className="min-w-0 flex-1 truncate px-2.5 text-xs text-muted-foreground">Not set</span>;
  }

  return (
    <span className="flex min-w-0 flex-1 items-center justify-between gap-2 px-2.5">
      <span className="truncate text-xs text-muted-foreground">{held ? "Held on this machine" : "Not set"}</span>
      <Button variant="link" size="sm" className="h-auto shrink-0 p-0 text-xs" onClick={onEnter}>
        {held ? "Replace" : "Set"}
      </Button>
    </span>
  );
}

// A read-only configuration can't be edited into shape, so the row is the wiring
// information instead: the name, where the value comes from, and whether it arrived.
function VariableRowStatic({ row, status, usedBy }: { row: VariableRow; status?: VariableStatus; usedBy?: string[] }) {
  const kind = variableKind(row.value);
  const source = status?.source ?? VariableSource.UNSET;
  const envName = status?.envName || (kind === "stored" ? storedEnvName(row.key) : environmentName(row));

  return (
    <div className="flex h-11 shrink-0 items-center gap-3 border-t border-border px-1 text-xs">
      <span className="w-[168px] shrink-0 truncate font-mono">{row.key}</span>
      <span className="w-[104px] shrink-0 text-muted-foreground">{SOURCE_LABEL[kind]}</span>
      <span className="min-w-0 flex-1 truncate">
        {kind === "value" ? (
          <span className="font-mono">{row.value}</span>
        ) : source === VariableSource.UNSET ? (
          <span className="text-amber-600 dark:text-amber-400">
            <code>{envName}</code> not set
          </span>
        ) : source === VariableSource.KEYCHAIN ? (
          <span className="text-muted-foreground">Stored in your keychain</span>
        ) : (
          <span className="text-muted-foreground">
            From <code>{envName}</code>
          </span>
        )}
      </span>
      <span className="w-16 shrink-0">
        <UsedBy usedBy={usedBy} name={row.key} />
      </span>
      <span className="w-5 shrink-0" />
    </div>
  );
}

function UsedBy({ usedBy, name, warn }: { usedBy?: string[]; name: string; warn?: boolean }) {
  if (!name) return null;
  if (!usedBy || usedBy.length === 0) {
    return <span className="text-xs text-muted-foreground/60">Unused</span>;
  }
  return (
    <SimpleTooltip text={`${usedBy.join(", ")}. Scripts aren't scanned.`}>
      <span className={cn("cursor-default text-xs", warn ? "text-destructive" : "text-muted-foreground")}>
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
        void copyText(value).then((landed) => {
          if (!landed) return;
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
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
