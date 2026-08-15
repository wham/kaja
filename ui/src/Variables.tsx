import { Braces, Check, ChevronDown, CircleAlert, Copy, Info, Plus, Trash2 } from "lucide-react";
import * as monaco from "monaco-editor";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert } from "./components/alert";
import { Blankslate } from "./components/blankslate";
import { Button } from "./components/button";
import { cn } from "./cn";
import { ConfirmationDialog } from "./components/confirmation-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./components/dropdown-menu";
import { FormControl } from "./components/form-control";
import { IconButton } from "./components/icon-button";
import { Input } from "./components/input";
import { SimpleTooltip } from "./components/tooltip";
import { formatJson } from "./formatter";
import { codeFontSize } from "./monacoTheme";
import { VARIABLES_JSON_URI } from "./jsonSchemas";
import { VariableSource, VariableStatus } from "./server/api";
import { SECRET_SOURCE, VariableKind, environmentReferences, storedEnvName, variableKind, variableNameError, variableValueError } from "./variableExpansion";
import { describeJsonMarker, parseVariablesJson } from "./variablesJson";

export type VariablesEditMode = "table" | "json";

interface VariableRow {
  key: string;
  value: string;
}

// VariablesSave is everything one Save writes: the configuration, plus the
// stored values a variable that stopped being stored leaves behind. Values going
// the other way don't wait for a save - they are written to the machine's store
// the moment they are entered.
export interface VariablesSave {
  variables: { [key: string]: string };
  cleared: string[];
}

// What the tab strip and the close gesture need to know about the editor's
// state, since both live outside it.
export interface VariablesState {
  dirty: boolean;
  canSave: boolean;
  save: () => Promise<void>;
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
  // Which view the tab is showing. The control that switches it lives in the tab
  // strip, so the tab owns the choice; Esc hands it back.
  editMode: VariablesEditMode;
  onEditModeChange: (editMode: VariablesEditMode) => void;
  // Whether the JSON parses, which decides if the view can be switched back.
  onJsonValidChange: (valid: boolean) => void;
  // Whether this is the tab in front: a hidden tab stays mounted, so its
  // keyboard shortcuts have to stand down.
  active: boolean;
  onSave: (save: VariablesSave) => Promise<void>;
  // Writing a value to the machine's store changes machine state rather than
  // file state, so it happens at once rather than on save.
  onStoreValue: (name: string, value: string) => Promise<void>;
  onStateChange?: (state: VariablesState) => void;
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

// sameVariables compares two variable maps by what they hold. Key order is an
// accident of how the map was built, so it can't be what says something changed.
function sameVariables(a: { [key: string]: string }, b: { [key: string]: string }): boolean {
  const names = Object.keys(a);
  return names.length === Object.keys(b).length && names.every((name) => name in b && a[name] === b[name]);
}

export function Variables({
  variables,
  status,
  storeAvailable,
  usage,
  readOnly = false,
  editMode,
  onEditModeChange,
  onJsonValidChange,
  active,
  onSave,
  onStoreValue,
  onStateChange,
}: VariablesProps) {
  const [rows, setRows] = useState<VariableRow[]>(() => toRows(variables));
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | undefined>();
  // Rows whose stored value is being entered, either for the first time or over
  // one this machine already holds.
  const [entering, setEntering] = useState<Set<number>>(new Set());
  // Names whose value was written to the store just now. The server reports
  // status for the variables kaja.json names, so a row that hasn't been saved
  // yet has no status to read its own write back from.
  const [justStored, setJustStored] = useState<Set<string>>(new Set());
  // A row being switched to the machine's store where there is no store to put
  // it in: the value has to move to the environment, so it is shown once.
  const [movingToEnvironment, setMovingToEnvironment] = useState<{ index: number; name: string; value: string } | null>(null);
  const [confirmRevert, setConfirmRevert] = useState(false);
  // The row whose name should take focus once it is on screen, after adding a
  // row or removing one with the keyboard.
  const [focusRow, setFocusRow] = useState<number | null>(null);
  const [jsonError, setJsonError] = useState<string | null>(null);
  // What the JSON view currently holds, so its edits count as unsaved the same
  // way the table's do. Null while it doesn't parse.
  const [jsonVariables, setJsonVariables] = useState<{ [key: string]: string } | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const nameInputs = useRef<Map<number, HTMLInputElement>>(new Map());

  const statusByName = useMemo(() => new Map(status.map((entry) => [entry.name, entry])), [status]);

  useEffect(() => {
    setRows(toRows(variables));
    setEntering(new Set());
  }, [variables]);

  useEffect(() => () => clearTimeout(savedTimer.current), []);

  useEffect(() => {
    if (focusRow === null) return;
    nameInputs.current.get(focusRow)?.focus();
    setFocusRow(null);
  }, [focusRow, rows.length]);

  // What a save would write: the rows, or the JSON view's text while it is the
  // one being edited. Undefined when the JSON doesn't parse, which is unsaved
  // work all the same.
  const edited = editMode === "json" ? (jsonVariables ?? undefined) : toVariables(rows);
  const dirty = edited === undefined || !sameVariables(edited, variables);

  const update = useCallback((index: number, patch: Partial<VariableRow>) => {
    setSaved(false);
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }, []);

  const addRow = () => {
    setSaved(false);
    // Clicking add again while a blank row is open refocuses it rather than
    // stacking a second one.
    const blank = rows.findIndex((row) => row.key.trim() === "" && row.value === "");
    if (blank !== -1) {
      setFocusRow(blank);
      return;
    }
    setRows((prev) => [...prev, { key: "", value: "" }]);
    setFocusRow(rows.length);
  };

  const removeRow = (index: number, focus?: number) => {
    setSaved(false);
    setRows((prev) => prev.filter((_, i) => i !== index));
    setEntering(new Set());
    if (focus !== undefined) setFocusRow(focus);
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

  // A ${NAME} an app uses that no variable defines. Requests send it literally.
  // Read from the rows rather than the file, so deleting a variable two apps use
  // says so at once instead of after the save.
  const defined = new Set(trimmedKeys.filter(Boolean));
  const undefinedReferences = Object.keys(usage)
    .filter((name) => usage[name].length > 0 && !defined.has(name))
    .sort();
  const unresolved = status.filter((entry) => entry.source === VariableSource.UNSET && entry.name in variables);

  // --- JSON view ---------------------------------------------------------

  const editorContainerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const modelRef = useRef<monaco.editor.ITextModel | null>(null);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  const validateJson = useCallback(() => {
    const text = modelRef.current?.getValue() ?? "";
    const parsed = parseVariablesJson(text);
    if (!parsed.error) {
      setJsonVariables(parsed.variables ?? {});
      setJsonError(null);
      onJsonValidChange(true);
      return;
    }
    setJsonVariables(null);
    // The editor's own diagnostic knows the line; the parser's message is the
    // better one for text that parses but isn't a variables block.
    const marker = parsed.syntax
      ? monaco.editor.getModelMarkers({ resource: VARIABLES_JSON_URI }).find((m) => m.severity === monaco.MarkerSeverity.Error)
      : undefined;
    setJsonError(marker ? describeJsonMarker(marker.startLineNumber, marker.message) : parsed.error);
    onJsonValidChange(false);
  }, [onJsonValidChange]);

  useEffect(() => {
    if (editMode !== "json" || !editorContainerRef.current) return;

    const text = JSON.stringify(toVariables(rowsRef.current), null, 2);
    monaco.editor.getModel(VARIABLES_JSON_URI)?.dispose();
    modelRef.current = monaco.editor.createModel(text, "json", VARIABLES_JSON_URI);
    editorRef.current = monaco.editor.create(editorContainerRef.current, {
      model: modelRef.current,
      automaticLayout: true,
      fontSize: codeFontSize(),
      padding: { top: 12, bottom: 12 },
      minimap: { enabled: false },
      lineNumbers: "off",
      // Gutter-less, but inset by the body's own padding so the text lines up
      // with the table it replaced.
      lineDecorationsWidth: 16,
      glyphMargin: false,
      folding: false,
      renderLineHighlight: "none",
      scrollBeyondLastLine: false,
      formatOnPaste: true,
      formatOnType: true,
      tabSize: 2,
      readOnly,
    });

    const subscriptions = [modelRef.current.onDidChangeContent(validateJson), monaco.editor.onDidChangeMarkers(validateJson)];
    validateJson();
    formatJson(text).then((formatted) => modelRef.current?.setValue(formatted));

    return () => {
      subscriptions.forEach((subscription) => subscription.dispose());
      editorRef.current?.dispose();
      editorRef.current = null;
      modelRef.current?.dispose();
      modelRef.current = null;
      setJsonError(null);
      setJsonVariables(null);
      // Nothing to be invalid once the editor is gone.
      onJsonValidChange(true);
    };
  }, [editMode, readOnly, validateJson, onJsonValidChange]);

  // Leaving the JSON view carries what was typed there back into the rows. The
  // control is disabled while the JSON is invalid, so this only has to handle
  // JSON that parses. Rows come back in the order they were written, so the two
  // views agree on what sits where.
  const leavingJsonRef = useRef(false);
  if (editMode === "table" && leavingJsonRef.current) {
    leavingJsonRef.current = false;
    const parsed = parseVariablesJson(editorRef.current?.getValue() ?? "");
    if (parsed.variables) {
      setRows(Object.entries(parsed.variables).map(([key, value]) => ({ key, value })));
      setSaved(false);
    }
  }
  if (editMode === "json") {
    leavingJsonRef.current = true;
  }

  // --- Saving ------------------------------------------------------------

  const canSave = !readOnly && dirty && edited !== undefined && (editMode === "json" ? !jsonError : !invalid);

  const save = async () => {
    if (!edited) return;

    // A variable that stopped being stored - renamed, deleted, or switched back
    // to a value of its own - leaves nothing behind in the store.
    const cleared = Object.keys(variables).filter(
      (name) => variableKind(variables[name]) === "stored" && (!(name in edited) || variableKind(edited[name]) !== "stored"),
    );

    setSaveError(undefined);
    try {
      await onSave({ variables: edited, cleared });
      setEntering(new Set());
      setSaved(true);
      clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setSaved(false), 3000);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    }
  };

  const revert = () => {
    setRows(toRows(variables));
    setEntering(new Set());
    setSaved(false);
    setSaveError(undefined);
    onEditModeChange("table");
  };

  const saveRef = useRef(save);
  saveRef.current = save;
  const invokeSave = useCallback(() => saveRef.current(), []);

  useEffect(() => {
    onStateChange?.({ dirty, canSave, save: invokeSave });
  }, [dirty, canSave, invokeSave, onStateChange]);

  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "s") {
        event.preventDefault();
        if (canSave) void saveRef.current();
        return;
      }
      if (event.key === "Escape" && editMode === "json" && !jsonError) {
        event.preventDefault();
        onEditModeChange("table");
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [active, canSave, editMode, jsonError, onEditModeChange]);

  const storeValue = async (index: number, value: string) => {
    const name = rows[index].key.trim();
    if (!name) return;
    setEntering((prev) => {
      const next = new Set(prev);
      next.delete(index);
      return next;
    });
    try {
      await onStoreValue(name, value);
      setJustStored((prev) => new Set(prev).add(name));
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    }
  };

  const body =
    editMode === "json" ? (
      <div className="flex min-h-0 flex-1 flex-col">
        {/* Which file, and which block of it: config-versus-document is the
            confusion an editor on a tab invites. */}
        <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border px-4">
          <Info size={12} className="shrink-0 text-muted-foreground" />
          <span className="truncate text-xs text-muted-foreground">
            The <code>variables</code> block of kaja.json. Keychain values appear as <code>{SECRET_SOURCE}</code> and are not editable here.
          </span>
        </div>
        <div ref={editorContainerRef} className="min-h-0 flex-1 bg-background" />
        {jsonError && (
          <div className="flex h-[34px] shrink-0 items-center gap-2 border-t border-destructive/40 bg-destructive/10 px-4">
            <CircleAlert size={13} className="shrink-0 text-destructive" />
            <span className="truncate text-xs text-destructive">{jsonError}. Save is unavailable until this parses.</span>
          </div>
        )}
      </div>
    ) : rows.length === 0 ? (
      // Centred in the body band rather than the whole pane: the footer below it
      // is chrome the blankslate has to sit clear of.
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

      {saveError && (
        <Alert variant="danger" className="mx-4 mb-3 shrink-0">
          {saveError}
        </Alert>
      )}

      {!readOnly && (
        <div className="flex h-[52px] shrink-0 items-center justify-end gap-2 border-t border-border px-4">
          {saved && (
            <span className="mr-1 flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
              <Check size={14} />
              Saved
            </span>
          )}
          <Button variant="outline" onClick={() => (dirty ? setConfirmRevert(true) : revert())} disabled={!dirty}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!canSave}>
            Save Changes
          </Button>
        </div>
      )}

      {confirmRevert && (
        <ConfirmationDialog
          title="Discard variable changes?"
          confirmButtonContent="Discard"
          confirmButtonType="danger"
          onClose={(gesture) => {
            setConfirmRevert(false);
            if (gesture === "confirm") revert();
          }}
        >
          The rows go back to what kaja.json holds. Values already written to this machine's keychain stay where they are.
        </ConfirmationDialog>
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
  // Whether this machine holds a value for the row, counting one written just
  // now for a variable the file doesn't name yet.
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
  // A keychain row on a machine with no store has nothing to take a value into:
  // it can only be supplied as KAJA_<NAME>, so the row says that under the field
  // instead of offering an input that goes nowhere.
  const needsEnvironment = kind === "stored" && !storeAvailable && source !== VariableSource.ENVIRONMENT;
  // Deleting a variable an app reads breaks that reference, so the count says so
  // while the gesture that would do it is under the pointer.
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
          {name ? "Press ⏎ to write it to this machine's keychain. Keychain values are stored at once, not on Save." : "Name the variable first."}
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

// SourcePicker states where the value comes from, and is where it is changed. It
// is bg-muted rather than a button surface so it reads as part of the field.
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

// StoredValueCell stands in for the value of a variable this machine holds. It
// never shows one: it says whether there is one, and offers to replace it.
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
// information instead: the name, where the value comes from, and whether it
// arrived.
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
