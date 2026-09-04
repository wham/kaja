import { Braces, Check, ChevronDown, CircleAlert, Copy, Plus, Search, Trash2 } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Script } from "./apps";
import { copyText } from "./clipboard";
import { cn } from "./cn";
import { Alert } from "./components/alert";
import { Blankslate } from "./components/blankslate";
import { Button } from "./components/button";
import { Checkbox } from "./components/checkbox";
import { ConfirmationDialog } from "./components/confirmation-dialog";
import { Dialog } from "./components/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./components/dropdown-menu";
import { FormControl } from "./components/form-control";
import { IconButton } from "./components/icon-button";
import { Input } from "./components/input";
import { Popover, PopoverContent, PopoverTrigger } from "./components/popover";
import { Spinner } from "./components/spinner";
import { rpcErrorMessage } from "./rpcMessage";
import { VariableSource, VariableStatus } from "./server/api";
import { useVariableScan, VariableScan } from "./useVariableScan";
import { SECRET_SOURCE, VariableKind, environmentReferences, storedEnvName, variableKind, variableNameError, variableValueError } from "./variableExpansion";
import { orderReferences, pluralCount, scannedAgo, scriptReferenceLabel, VariableUse } from "./variableUsage";

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
  uses: Map<string, VariableUse[]>;
  scripts: Script[];
  // Whether this is the view on screen. The scan runs when it becomes one, which
  // is what makes coming back from a script the moment its references are re-read.
  active: boolean;
  readOnly?: boolean;
  onSave: (save: VariablesSave) => Promise<void>;
  onStoreValue: (name: string, value: string) => Promise<void>;
  onScriptSelect: (script: Script) => void;
  onRevealApp: (name: string) => void;
}

const SOURCE_LABEL: Record<VariableKind, string> = {
  value: "Value",
  stored: "Keychain",
  environment: "Environment",
};

const AUTOSAVE_MS = 600;

function toRows(variables: { [key: string]: string }): VariableRow[] {
  // A variable you just added stays where you added it because the rows are the
  // table's own state and a save is not re-adopted. This is what an *external*
  // change is read back in, and the order there is alphabetical rather than the
  // file's: a protobuf map does not carry one, so the wire's is arbitrary and a
  // reload would shuffle the table.
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

export function Variables({
  variables,
  status,
  storeAvailable,
  uses,
  scripts,
  active,
  readOnly = false,
  onSave,
  onStoreValue,
  onScriptSelect,
  onRevealApp,
}: VariablesProps) {
  const [rows, setRows] = useState<VariableRow[]>(() => toRows(variables));
  const [editVersion, setEditVersion] = useState(0);
  const [saving, setSaving] = useState(false);
  const [justStored, setJustStored] = useState<Set<string>>(new Set());
  const [keychainSheet, setKeychainSheet] = useState<{ index: number; name: string } | null>(null);
  const [deleting, setDeleting] = useState<{ index: number; name: string; apps: number; files: number; held: boolean } | null>(null);
  const [movingToEnvironment, setMovingToEnvironment] = useState<{ index: number; name: string; value: string } | null>(null);
  const [focusRow, setFocusRow] = useState<number | null>(null);
  const nameInputs = useRef<Map<number, HTMLInputElement>>(new Map());
  const variablesRef = useRef(variables);
  const editVersionRef = useRef(editVersion);
  const attemptedVersionRef = useRef(-1);
  const submittedVersionRef = useRef<number | undefined>(undefined);
  const submittedVariablesRef = useRef<{ [key: string]: string } | undefined>(undefined);
  const onSaveRef = useRef(onSave);
  // Names whose keychain entry the delete dialog was told to leave alone. Deleting
  // a variable otherwise takes the value it named with it.
  const retainStoredRef = useRef<Set<string>>(new Set());
  const storedWriteChainRef = useRef<Promise<void>>(Promise.resolve());
  editVersionRef.current = editVersion;
  onSaveRef.current = onSave;

  const statusByName = useMemo(() => new Map(status.map((entry) => [entry.name, entry])), [status]);
  const scannedNames = useMemo(() => Object.keys(variables), [variables]);
  const { scan, rescan } = useVariableScan(scannedNames, active);

  useEffect(() => {
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
  }, [variables]);

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

  // A ${NAME} an app uses that no variable defines; requests send it literally. It
  // has no row to be said in, which is why it is the one thing here reported over
  // the table rather than under a field. Read from the rows rather than the file,
  // so deleting a variable two apps use says so at once instead of after the save.
  const defined = new Set(trimmedKeys.filter(Boolean));
  const undefinedReferences = [...uses.keys()].filter((name) => !defined.has(name)).sort();

  useEffect(() => {
    if (readOnly || !dirty || invalid || saving || attemptedVersionRef.current === editVersion) return;

    const timer = setTimeout(() => {
      const version = editVersion;
      const snapshot = edited;
      attemptedVersionRef.current = version;
      submittedVersionRef.current = version;
      submittedVariablesRef.current = snapshot;
      setSaving(true);

      // A name that is back in the table is a variable again, so whatever the
      // delete dialog was told about the last one of that name no longer applies.
      for (const name of Object.keys(snapshot)) retainStoredRef.current.delete(name);
      const cleared = Object.keys(variables).filter(
        (name) =>
          variableKind(variables[name]) === "stored" &&
          !retainStoredRef.current.has(name) &&
          (!(name in snapshot) || variableKind(snapshot[name]) !== "stored"),
      );

      void onSaveRef
        .current({ variables: snapshot, cleared })
        .catch((error) => console.error(`Saving variables failed: ${rpcErrorMessage(error)}`))
        .finally(() => setSaving(false));
    }, AUTOSAVE_MS);

    return () => clearTimeout(timer);
  }, [dirty, editVersion, edited, invalid, readOnly, saving, variables]);

  const storeValue = async (name: string, value: string) => {
    if (!name) return;
    const write = storedWriteChainRef.current.then(() => onStoreValue(name, value));
    storedWriteChainRef.current = write.then(
      () => undefined,
      () => undefined,
    );
    try {
      await write;
      setJustStored((prev) => new Set(prev).add(name));
    } catch (error) {
      console.error(`Storing ${name} failed: ${rpcErrorMessage(error)}`);
    }
  };

  const held = (row: VariableRow) => {
    const name = row.key.trim();
    return statusByName.get(name)?.source === VariableSource.KEYCHAIN || justStored.has(name);
  };

  // Deleting a variable something reads breaks that reference, and deleting one the
  // keychain holds a value for throws the value away. Either is worth stating; a
  // variable that is neither goes on the click.
  const askToDelete = (index: number) => {
    const row = rows[index];
    const name = row.key.trim();
    const apps = uses.get(name)?.length ?? 0;
    const files = scan.status === "scanned" ? (scan.references.get(name)?.length ?? 0) : 0;
    const holdsValue = variableKind(row.value) === "stored" && held(row);
    if (!name || (apps === 0 && files === 0 && !holdsValue)) {
      removeRow(index);
      return;
    }
    setDeleting({ index, name, apps, files, held: holdsValue });
  };

  const body =
    rows.length === 0 ? (
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

        {undefinedReferences.length > 0 && (
          <div className="flex shrink-0 flex-col gap-2 pb-3">
            {undefinedReferences.map((name) => (
              <Alert key={name} variant="warning" className="flex items-center justify-between gap-4">
                <span>
                  <code>{"${" + name + "}"}</code> is used by {[...new Set(uses.get(name)?.map((use) => use.app))].join(", ")} but isn't defined.
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
          </div>
        )}

        <div className="flex h-[26px] shrink-0 items-center gap-3 px-1 text-xs text-muted-foreground">
          <span className="w-[168px]">Name</span>
          {readOnly && <span className="w-[104px]">Source</span>}
          <span className="flex-1">Value</span>
          <span className="w-[132px]">Used by</span>
          <span className="ml-1 w-6" />
        </div>

        {rows.map((row, index) => {
          const name = row.key.trim();
          const usedBy = (
            <UsedBy
              name={name}
              apps={uses.get(name) ?? []}
              scan={scan}
              scripts={scripts}
              onRescan={rescan}
              onScriptSelect={onScriptSelect}
              onRevealApp={onRevealApp}
            />
          );
          return readOnly ? (
            <VariableRowStatic key={index} row={row} status={statusByName.get(name)} usedBy={usedBy} />
          ) : (
            <VariableRowEditor
              key={index}
              index={index}
              row={row}
              error={rowErrors[index]}
              status={statusByName.get(name)}
              storeAvailable={storeAvailable}
              held={held(row)}
              usedBy={usedBy}
              nameRef={(element) => {
                if (element) nameInputs.current.set(index, element);
                else nameInputs.current.delete(index);
              }}
              onChange={(patch) => update(index, patch)}
              onSource={(kind) => setSource(index, kind)}
              onEnterValue={() => setKeychainSheet({ index, name })}
              onRemove={(focus) => (focus === undefined ? askToDelete(index) : removeRow(index, focus))}
              onAddRow={index === rows.length - 1 ? addRow : undefined}
              isLast={index === rows.length - 1}
            />
          );
        })}

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

      {keychainSheet && (
        <KeychainSheet
          name={keychainSheet.name}
          onClose={() => setKeychainSheet(null)}
          onSubmit={(value) => {
            setKeychainSheet(null);
            void storeValue(keychainSheet.name, value);
          }}
        />
      )}

      {deleting && (
        <DeleteDialog
          deleting={deleting}
          onClose={(gesture, clearStored) => {
            if (gesture === "confirm") {
              if (deleting.held && !clearStored) retainStoredRef.current.add(deleting.name);
              removeRow(deleting.index);
            }
            setDeleting(null);
          }}
        />
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
  // Counting one written just now for a variable the file doesn't name yet.
  held: boolean;
  usedBy: ReactNode;
  isLast: boolean;
  nameRef: (element: HTMLInputElement | null) => void;
  onChange: (patch: Partial<VariableRow>) => void;
  onSource: (kind: VariableKind) => void;
  onEnterValue: () => void;
  onRemove: (focus?: number) => void;
  onAddRow?: () => void;
}

function VariableRowEditor({
  index,
  row,
  error,
  status,
  storeAvailable,
  held,
  usedBy,
  isLast,
  nameRef,
  onChange,
  onSource,
  onEnterValue,
  onRemove,
  onAddRow,
}: VariableRowEditorProps) {
  const kind = variableKind(row.value);
  const name = row.key.trim();
  const source = status?.source ?? VariableSource.UNSET;
  const storedEnv = status?.envName || storedEnvName(name || "NAME");
  // A keychain row on a machine with no store has nothing to take a value into: it can
  // only be supplied as KAJA_<NAME>, so the row says that instead of offering a sheet
  // that writes nowhere.
  const needsEnvironment = kind === "stored" && !storeAvailable && source !== VariableSource.ENVIRONMENT;
  // Nothing about one row is reported outside it: the field goes amber and the
  // consequence sits under it, rather than a banner above the table naming a row the
  // eye then has to go find.
  const unset =
    Boolean(name) &&
    !error &&
    ((kind === "stored" && !held && source === VariableSource.UNSET) || (kind === "environment" && status?.source === VariableSource.UNSET));

  return (
    <div className="group flex min-h-[44px] shrink-0 flex-col justify-center gap-1.5 border-t border-border px-1 py-1.5 transition-colors hover:bg-muted/40">
      <div className="flex items-center gap-3">
        {/* Three bordered boxes across a row is more frame than content, so the
            name is plain text until the pointer or the focus is on it. */}
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
          className="w-[168px] shrink-0 border-transparent bg-transparent px-2.5 font-mono text-xs shadow-none hover:border-input focus-visible:border-input"
        />

        {/* The source picker is welded to the value it describes: one control
            that states the mode at rest and changes it in one click, and a field
            to its right that is whatever the mode needs. */}
        <div className="flex min-w-0 flex-1 items-center">
          <SourcePicker kind={kind} name={name} environmentName={environmentName(row)} storeAvailable={storeAvailable} onSelect={onSource} />
          <ValueField
            warn={unset}
            error={Boolean(error)}
            clickable={kind === "stored" && storeAvailable}
            onClick={kind === "stored" && storeAvailable ? onEnterValue : undefined}
          >
            {kind === "stored" ? (
              <StoredValueCell storedEnv={storedEnv} source={source} held={held} storeAvailable={storeAvailable} />
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
                      "pointer-events-none shrink-0 pr-2.5 text-xs",
                      status.source === VariableSource.UNSET ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400",
                    )}
                  >
                    {status.source === VariableSource.UNSET ? "not set" : "resolved"}
                  </span>
                )}
              </>
            )}
          </ValueField>
        </div>

        <span className="w-[132px] shrink-0">{usedBy}</span>
        {/* Delete isn't a mode, so it doesn't sit in the mode list. Twice the
            column gap from the count beside it, so it reads as the row's. */}
        <span className="ml-1 flex w-6 shrink-0 justify-center">
          <IconButton
            icon={Trash2}
            aria-label="Delete variable"
            variant="ghost"
            size="sm"
            className="h-6 w-6 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 [&_svg]:size-3.5"
            onClick={() => onRemove()}
          />
        </span>
      </div>

      {error && <FormControl.Validation>{error}</FormControl.Validation>}
      {!error && needsEnvironment && (
        <RowCaption>
          This machine has nowhere to store a value. Define <code>{storedEnv}</code> in the environment.{" "}
          <span className="inline-flex align-middle">
            <CopyButton value={storedEnv + "="} label={`Copy ${storedEnv}=`} />
          </span>
        </RowCaption>
      )}
    </div>
  );
}

// A caption sits under the field it is about, left edge aligned to the value
// column, which is what says it belongs to that field rather than to the row.
function RowCaption({ children }: { children: ReactNode }) {
  return (
    <div className="text-xs text-muted-foreground" style={{ paddingLeft: 180 }}>
      {children}
    </div>
  );
}

// The whole field is one hit target, so its action can sit next to the state it
// acts on rather than pinned to the far edge of a wide window.
function ValueField({
  warn,
  error,
  clickable,
  onClick,
  children,
}: {
  warn: boolean;
  error: boolean;
  clickable: boolean;
  onClick?: () => void;
  children: ReactNode;
}) {
  const className = cn(
    "group/value -ml-px flex h-8 min-w-0 flex-1 items-center rounded-r-md border shadow-sm focus-within:relative focus-within:ring-2 focus-within:ring-ring",
    error ? "border-destructive bg-background" : warn ? "border-amber-500/40 bg-amber-500/10" : "border-input bg-background",
    clickable && "cursor-pointer text-left transition-colors hover:border-ring focus-visible:relative focus-visible:ring-2 focus-visible:ring-ring",
  );
  if (!clickable) return <div className={className}>{children}</div>;
  return (
    <button type="button" className={className} onClick={onClick}>
      {children}
    </button>
  );
}

// bg-muted rather than a button surface, so it reads as part of the field.
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
      <DropdownMenuContent align="start" className="w-[288px]">
        <div className="flex h-6 items-center px-2 text-xs text-muted-foreground">Where the value comes from</div>
        <SourceItem selected={kind === "value"} label="Value" description="Written in kaja.json" onSelect={() => onSelect("value")} />
        <SourceItem
          selected={kind === "stored"}
          label="Keychain"
          description={storeAvailable ? "Stored on this Mac" : `Read from ${storedEnvName(name || "NAME")}`}
          onSelect={() => onSelect("stored")}
        />
        <SourceItem
          selected={kind === "environment"}
          label="Environment"
          description={`Read from ${environmentName}`}
          onSelect={() => onSelect("environment")}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SourceItem({ selected, label, description, onSelect }: { selected: boolean; label: string; description: string; onSelect: () => void }) {
  return (
    <DropdownMenuItem className="items-start py-[5px]" onSelect={onSelect}>
      <span className="flex w-3.5 shrink-0 justify-center pt-0.5">{selected && <Check size={14} />}</span>
      <span className="flex min-w-0 flex-col">
        <span className="text-xs">{label}</span>
        <span className="text-xs text-muted-foreground">{description}</span>
      </span>
    </DropdownMenuItem>
  );
}

// StoredValueCell never shows the value: it says whether there is one, and names the
// action that changes it right beside that.
function StoredValueCell({ storedEnv, source, held, storeAvailable }: { storedEnv: string; source: VariableSource; held: boolean; storeAvailable: boolean }) {
  const action = (
    <span className="shrink-0 text-xs font-medium text-muted-foreground transition-colors group-hover/value:text-foreground">
      {held ? "Replace" : "Set value"}
    </span>
  );

  if (!held && source === VariableSource.ENVIRONMENT) {
    return (
      <span className="flex min-w-0 flex-1 items-center gap-2 px-2.5">
        <span className="truncate text-xs text-muted-foreground">
          Read from <code>{storedEnv}</code>
        </span>
        {storeAvailable && action}
      </span>
    );
  }

  if (!held) {
    return (
      <span className="flex min-w-0 flex-1 items-center gap-2 px-2.5">
        <CircleAlert size={12} className="shrink-0 text-amber-600 dark:text-amber-400" />
        <span className="truncate text-xs text-amber-600 dark:text-amber-400">Not set</span>
        {storeAvailable && action}
      </span>
    );
  }

  return (
    <span className="flex min-w-0 flex-1 items-center gap-2 px-2.5">
      <span className="truncate text-xs text-muted-foreground">Stored on this Mac</span>
      {action}
    </span>
  );
}

// The one place a value is typed. It is a sheet rather than an inline field because
// what it writes is machine state: it lands the moment it is confirmed, outside the
// file's own save.
function KeychainSheet({ name, onClose, onSubmit }: { name: string; onClose: () => void; onSubmit: (value: string) => void }) {
  const [value, setValue] = useState("");
  const input = useRef<HTMLInputElement>(null);

  return (
    <Dialog
      title={`Set ${name}`}
      width="sm"
      onClose={onClose}
      initialFocusRef={input}
      footerButtons={[
        { content: "Cancel", onClick: onClose },
        { content: "Set value", variant: "default", disabled: value === "", onClick: () => value && onSubmit(value) },
      ]}
    >
      <div className="flex flex-col gap-2 py-2">
        <Input
          ref={input}
          type="password"
          autoComplete="off"
          placeholder="Paste value"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && value) {
              e.preventDefault();
              onSubmit(value);
            }
          }}
        />
        <p className="text-xs text-muted-foreground">Stored in this Mac keychain.</p>
      </div>
    </Dialog>
  );
}

function DeleteDialog({
  deleting,
  onClose,
}: {
  deleting: { name: string; apps: number; files: number; held: boolean };
  onClose: (gesture: "confirm" | "cancel", clearStored: boolean) => void;
}) {
  const [clearStored, setClearStored] = useState(true);
  const referenced = [deleting.apps > 0 && pluralCount(deleting.apps, "app"), deleting.files > 0 && pluralCount(deleting.files, "script")].filter(Boolean);

  return (
    <ConfirmationDialog
      title={`Delete ${deleting.name}?`}
      confirmButtonContent="Delete variable"
      confirmButtonType="danger"
      onClose={(gesture) => onClose(gesture, clearStored)}
    >
      {referenced.length > 0 && <span className="block">{referenced.join(" and ")} reference it. They will send the text as written.</span>}
      {deleting.held && (
        <span className="mt-3 flex items-center gap-2">
          <Checkbox checked={clearStored} onCheckedChange={(checked) => setClearStored(checked === true)} id="clear-stored" />
          <label htmlFor="clear-stored" className="cursor-pointer text-sm text-foreground">
            Also clear the value stored on this Mac
          </label>
        </span>
      )}
    </ConfirmationDialog>
  );
}

// A read-only configuration can't be edited into shape, so the row is the wiring
// information instead: the name, where the value comes from, and whether it arrived.
function VariableRowStatic({ row, status, usedBy }: { row: VariableRow; status?: VariableStatus; usedBy: ReactNode }) {
  const kind = variableKind(row.value);
  const source = status?.source ?? VariableSource.UNSET;
  const envName = status?.envName || (kind === "stored" ? storedEnvName(row.key) : environmentName(row));

  return (
    <div className="flex h-11 shrink-0 items-center gap-3 border-t border-border px-1 text-xs">
      <span className="w-[168px] shrink-0 truncate px-2.5 font-mono">{row.key}</span>
      <span className="w-[104px] shrink-0 text-muted-foreground">{SOURCE_LABEL[kind]}</span>
      <span className="min-w-0 flex-1 truncate">
        {kind === "value" ? (
          <span className="font-mono">{row.value}</span>
        ) : source === VariableSource.UNSET ? (
          <span className="text-amber-600 dark:text-amber-400">
            <code>{envName}</code> not set
          </span>
        ) : source === VariableSource.KEYCHAIN ? (
          <span className="text-muted-foreground">Stored on this Mac</span>
        ) : (
          <span className="text-muted-foreground">
            Read from <code>{envName}</code>
          </span>
        )}
      </span>
      <span className="w-[132px] shrink-0">{usedBy}</span>
      <span className="ml-1 w-6 shrink-0" />
    </div>
  );
}

// The column is never a dead number: it states a finding, or shows the scan running,
// or offers to run it again. App references are read from the configuration, so they
// are there on load; script references are the scan's.
function UsedBy({
  name,
  apps,
  scan,
  scripts,
  onRescan,
  onScriptSelect,
  onRevealApp,
}: {
  name: string;
  apps: VariableUse[];
  scan: VariableScan;
  scripts: Script[];
  onRescan: () => void;
  onScriptSelect: (script: Script) => void;
  onRevealApp: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  if (!name) return null;

  const appCount = apps.length > 0 ? <span className="text-xs text-foreground">{pluralCount(apps.length, "app")}</span> : null;

  if (scan.status === "scanning") {
    return (
      <span className="flex items-center gap-1.5">
        <Spinner className="size-3" />
        <span className="text-xs text-muted-foreground">{apps.length > 0 ? `${pluralCount(apps.length, "app")}, scanning` : "Scanning"}</span>
      </span>
    );
  }

  if (scan.status === "failed") {
    return (
      <span className="flex items-center gap-1.5">
        {appCount}
        <span className="text-xs text-muted-foreground">Scan failed</span>
        <IconButton icon={Search} aria-label="Scan scripts again" variant="ghost" size="xs" className="[&_svg]:size-3" onClick={onRescan} />
      </span>
    );
  }

  const files = orderReferences(scan.references.get(name) ?? [], scripts);
  if (apps.length === 0 && files.length === 0) {
    return <span className="text-xs text-muted-foreground/60">Unused</span>;
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className="flex items-center gap-1.5 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {appCount}
          {files.length > 0 && <span className="text-xs text-muted-foreground">{pluralCount(files.length, "file")}</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[272px] p-1">
        {apps.length > 0 && <UsedByGroup label="Apps" />}
        {apps.map((use, index) => (
          <UsedByRow
            key={`${use.app} ${use.field} ${index}`}
            label={use.app}
            trailing={use.field}
            onSelect={() => {
              setOpen(false);
              onRevealApp(use.app);
            }}
          />
        ))}
        {files.length > 0 && <UsedByGroup label="Files" />}
        {files.map((reference) => {
          const script = scripts.find((candidate) => candidate.path === reference.path);
          return (
            <UsedByRow
              key={reference.path}
              mono
              label={scriptReferenceLabel(reference, scripts)}
              trailing={String(reference.count)}
              onSelect={
                script
                  ? () => {
                      setOpen(false);
                      onScriptSelect(script);
                    }
                  : undefined
              }
            />
          );
        })}
        <div className="my-1 border-t border-border" />
        <div className="flex h-6 items-center justify-between px-2">
          <span className="text-xs text-muted-foreground">{scan.truncated ? "Scan stopped short" : scannedAgo(scan.at, Date.now())}</span>
          <button
            type="button"
            className="rounded-sm text-xs text-foreground outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
            onClick={onRescan}
          >
            Rescan
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function UsedByGroup({ label }: { label: string }) {
  return (
    <div className="flex h-[22px] items-center px-2">
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

function UsedByRow({ label, trailing, mono, onSelect }: { label: string; trailing: string; mono?: boolean; onSelect?: () => void }) {
  return (
    <button
      type="button"
      disabled={!onSelect}
      onClick={onSelect}
      className="flex h-[26px] w-full items-center justify-between gap-2 rounded-sm px-2 text-left outline-none transition-colors enabled:hover:bg-accent enabled:hover:text-accent-foreground focus-visible:bg-accent"
    >
      <span className={cn("min-w-0 truncate text-xs", mono && "font-mono")}>{label}</span>
      <span className="shrink-0 text-xs text-muted-foreground">{trailing}</span>
    </button>
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
      tooltip="native"
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
