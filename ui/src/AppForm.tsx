import { FileDirectoryIcon, FileIcon, LightBulbIcon } from "./components/icons";
import { Button, buttonVariants } from "./components/button";
import { Checkbox } from "./components/checkbox";
import { FormControl } from "./components/form-control";
import { IconButton } from "./components/icon-button";
import { Input } from "./components/input";
import { SegmentedControl } from "./components/segmented-control";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "./components/select";
import { cn } from "./lib/utils";
import * as monaco from "monaco-editor";
import { useState, useRef, useEffect, useCallback } from "react";
import { appHeaders, appParameters, appType, buildApp, getAppType } from "./appTypes";
import { ConfigurationApp } from "./server/api";
import { OpenDirectoryDialog, OpenFileDialog } from "./wailsjs/go/main/App";
import { formatJson } from "./formatter";
import { getVariables } from "./variableExpansion";
import { isWailsEnvironment } from "./wails";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const jsonDefaults = (monaco.languages as any).json.jsonDefaults;

type EditMode = "form" | "json";

// An app is { name, <type>: { ...params, headers } }, so the variant key is
// open-ended; validate only the stable part and require a name.
const appJsonSchema = {
  type: "object",
  properties: {
    name: { type: "string" },
  },
  required: ["name"],
  additionalProperties: true,
};

jsonDefaults.setDiagnosticsOptions({
  validate: true,
  schemas: [
    {
      uri: "http://kaja/app-schema.json",
      fileMatch: ["*"],
      schema: appJsonSchema,
    },
  ],
});

// Suggest ${NAME} variable references while editing the app JSON (the only
// place headers are edited). Values are read from the registry at completion
// time so the list is always current.
monaco.languages.registerCompletionItemProvider("json", {
  triggerCharacters: ["$", "{"],
  provideCompletionItems: (model, position) => {
    if (model.uri.path !== "/app-config.json") {
      return { suggestions: [] };
    }
    const line = model.getValueInRange({
      startLineNumber: position.lineNumber,
      startColumn: 1,
      endLineNumber: position.lineNumber,
      endColumn: position.column,
    });
    const match = /\$\{?([A-Za-z0-9_]*)$/.exec(line);
    if (!match) {
      return { suggestions: [] };
    }
    const range = new monaco.Range(position.lineNumber, position.column - match[0].length, position.lineNumber, position.column);
    return {
      suggestions: Object.entries(getVariables()).map(([name, value]) => ({
        label: "${" + name + "}",
        kind: monaco.languages.CompletionItemKind.Variable,
        detail: value,
        insertText: "${" + name + "}",
        range,
      })),
    };
  },
});

// matchVariableReferencePrefix finds an unfinished ${NAME reference ending at
// the caret, returning where it starts and the name typed so far.
function matchVariableReferencePrefix(value: string, caret: number): { start: number; query: string } | null {
  const match = /\$\{([A-Za-z0-9_]*)$/.exec(value.slice(0, caret));
  return match ? { start: caret - match[0].length, query: match[1] } : null;
}

interface VariableSuggestInputProps {
  value: string;
  onValueChange: (value: string) => void;
  variables: { [key: string]: string };
  placeholder?: string;
  disabled?: boolean;
  trailingAction?: React.ReactNode;
}

// A TextInput that suggests the configured variables once the user types "${",
// completing the reference to ${NAME}.
function VariableSuggestInput({ value, onValueChange, variables, placeholder, disabled, trailingAction }: VariableSuggestInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [suggestion, setSuggestion] = useState<{ start: number; query: string } | null>(null);
  const [highlightIndex, setHighlightIndex] = useState(0);

  const names = suggestion ? Object.keys(variables).filter((name) => name.toLowerCase().startsWith(suggestion.query.toLowerCase())) : [];
  const open = names.length > 0;

  const refreshSuggestion = () => {
    const input = inputRef.current;
    if (!input) return;
    const next = matchVariableReferencePrefix(input.value, input.selectionStart ?? 0);
    setSuggestion((prev) => {
      if (prev?.start !== next?.start || prev?.query !== next?.query) {
        setHighlightIndex(0);
        return next;
      }
      return prev;
    });
  };

  const insert = (name: string) => {
    const input = inputRef.current;
    if (!input || !suggestion) return;
    const caret = input.selectionStart ?? input.value.length;
    // Replace the unfinished ${query with ${name}, consuming a closing brace
    // the user may already have typed.
    let rest = value.slice(caret);
    if (rest.startsWith("}")) rest = rest.slice(1);
    onValueChange(value.slice(0, suggestion.start) + "${" + name + "}" + rest);
    setSuggestion(null);
    const position = suggestion.start + name.length + 3;
    requestAnimationFrame(() => inputRef.current?.setSelectionRange(position, position));
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIndex((prev) => (prev + (e.key === "ArrowDown" ? 1 : names.length - 1)) % names.length);
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      insert(names[highlightIndex]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setSuggestion(null);
    }
  };

  return (
    <div style={{ position: "relative" }}>
      <div className="relative">
        <Input
          ref={inputRef}
          value={value}
          onChange={(e) => {
            onValueChange(e.target.value);
            refreshSuggestion();
          }}
          onSelect={refreshSuggestion}
          onKeyDown={onKeyDown}
          onBlur={() => setSuggestion(null)}
          placeholder={placeholder}
          disabled={disabled}
          className={trailingAction ? "pr-9" : undefined}
        />
        {trailingAction && <div className="absolute right-1 top-1/2 -translate-y-1/2">{trailingAction}</div>}
      </div>
      {open && (
        // Keep focus in the input so a click on a suggestion isn't lost to blur.
        <div
          onMouseDown={(e) => e.preventDefault()}
          className="absolute left-0 top-full z-10 mt-1 max-h-60 min-w-80 overflow-y-auto rounded-md border border-border bg-popover shadow-md"
        >
          {names.map((name, index) => (
            <button
              key={name}
              type="button"
              onClick={() => insert(name)}
              className={cn(
                "flex w-full flex-col items-start gap-0.5 px-3 py-1.5 text-left text-sm",
                index === highlightIndex ? "bg-accent text-accent-foreground" : "hover:bg-accent/50",
              )}
            >
              <span className="font-mono">{"${" + name + "}"}</span>
              <span className="text-xs text-muted-foreground">{variables[name]}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const NEW_APP_VALUE = "__new__";

interface AppFormProps {
  mode: "create" | "edit";
  initialData?: ConfigurationApp;
  allApps: ConfigurationApp[];
  // Configured variables, usable in parameter values as ${NAME} and offered as
  // suggestions when "${" is typed.
  variables: { [key: string]: string };
  readOnly?: boolean;
  onSubmit: (app: ConfigurationApp, originalName?: string) => void;
  onCancel: () => void;
  onAppSelect: (appName: string | null) => void;
}

function createEmptyApp(): ConfigurationApp {
  return buildApp("", "grpc", {}, {});
}

// appToJson renders an app as the on-disk shape: { name, <type>: { ...params, headers } }.
function appToJson(app: ConfigurationApp): object {
  const kind = app.app.oneofKind;
  const variant = kind ? (app.app as Record<string, unknown>)[kind] : undefined;
  return { name: app.name, ...(kind ? { [kind]: variant ?? {} } : {}) };
}

// jsonToApp parses that shape back into a typed app, treating the one key that
// isn't name as the app type and its object as the typed block.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function jsonToApp(json: any): ConfigurationApp {
  const type = Object.keys(json ?? {}).find((key) => key !== "name") ?? "";
  const variant = (json?.[type] as Record<string, unknown>) ?? {};
  return {
    name: json?.name || "",
    app: type ? ({ oneofKind: type, [type]: variant } as unknown as ConfigurationApp["app"]) : { oneofKind: undefined },
  };
}

// missingRequiredParameter returns the label of the first required parameter the
// app's type defines but the form leaves empty, or undefined if all are set. It
// also enforces requireOneOf groups, where at least one of a set of parameters
// must be provided.
function missingRequiredParameter(type: string, parameters: Record<string, string>): string | undefined {
  const definition = getAppType(type);
  if (!definition) return undefined;
  for (const parameter of definition.parameters) {
    if (parameter.optional) continue;
    if (!(parameters[parameter.key] ?? "").trim()) return parameter.label;
  }
  for (const group of definition.requireOneOf ?? []) {
    if (group.every((key) => !(parameters[key] ?? "").trim())) {
      const first = definition.parameters.find((parameter) => parameter.key === group[0]);
      return first?.label ?? group[0];
    }
  }
  return undefined;
}

export function AppForm({ mode, initialData, allApps, variables, readOnly = false, onSubmit, onCancel, onAppSelect }: AppFormProps) {
  const [editMode, setEditMode] = useState<EditMode>("form");
  const [name, setName] = useState("");
  const [type, setType] = useState("grpc");
  const [parameters, setParameters] = useState<Record<string, string>>({});
  // Names of files chosen for "upload" parameters, shown next to the picker. The
  // parameter value itself holds the file's text content.
  const [uploadNames, setUploadNames] = useState<Record<string, string>>({});
  const [jsonError, setJsonError] = useState<string | null>(null);
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const monacoModelRef = useRef<monaco.editor.ITextModel | null>(null);

  const getCurrentApp = useCallback((): ConfigurationApp => {
    const definition = getAppType(type);
    const params: Record<string, string> = {};
    for (const parameter of definition?.parameters ?? []) {
      const value = (parameters[parameter.key] ?? "").trim();
      if (value) params[parameter.key] = value;
    }
    return buildApp(name, type, params, initialData ? appHeaders(initialData) : {});
  }, [name, type, parameters, initialData]);

  const updateFormFromApp = useCallback((app: ConfigurationApp) => {
    setName(app.name);
    setType(appType(app) || "grpc");
    setParameters(appParameters(app));
    setUploadNames({});
  }, []);

  const handleUpload = useCallback((key: string, file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setParameters((prev) => ({ ...prev, [key]: String(reader.result ?? "") }));
      setUploadNames((prev) => ({ ...prev, [key]: file.name }));
    };
    reader.readAsText(file);
  }, []);

  useEffect(() => {
    // In create mode initialData carries just the type picked in the New dialog;
    // in edit mode it is the full app. Either way the form reflects it.
    updateFormFromApp(initialData ?? createEmptyApp());
  }, [mode, initialData, updateFormFromApp]);

  // Track which app is currently loaded in the JSON editor
  const loadedAppNameRef = useRef<string | null>(null);

  const getJsonAppData = useCallback((): ConfigurationApp => {
    if (mode === "edit" && initialData) {
      return initialData;
    }
    return createEmptyApp();
  }, [mode, initialData]);

  useEffect(() => {
    if (editMode === "json" && editorContainerRef.current) {
      const appData = getJsonAppData();
      const currentAppKey = mode === "edit" ? initialData?.name : "__new__";

      if (!editorRef.current) {
        loadedAppNameRef.current = currentAppKey ?? null;
        const jsonStr = JSON.stringify(appToJson(appData), null, 2);

        const modelUri = monaco.Uri.file("/app-config.json");
        const existingModel = monaco.editor.getModel(modelUri);
        if (existingModel) {
          existingModel.dispose();
        }
        monacoModelRef.current = monaco.editor.createModel(jsonStr, "json", modelUri);

        editorRef.current = monaco.editor.create(editorContainerRef.current, {
          model: monacoModelRef.current,
          automaticLayout: true,
          padding: { top: 16, bottom: 16 },
          minimap: { enabled: false },
          renderLineHighlight: "none",
          formatOnPaste: true,
          formatOnType: true,
          tabSize: 2,
          readOnly,
        });

        formatJson(jsonStr).then((formatted) => {
          if (monacoModelRef.current) {
            monacoModelRef.current.setValue(formatted);
          }
        });
      } else if (loadedAppNameRef.current !== currentAppKey) {
        loadedAppNameRef.current = currentAppKey ?? null;
        const jsonStr = JSON.stringify(appToJson(appData), null, 2);

        formatJson(jsonStr).then((formatted) => {
          if (monacoModelRef.current) {
            monacoModelRef.current.setValue(formatted);
          }
        });
      }
    }

    return () => {
      if (editMode !== "json") {
        editorRef.current?.dispose();
        editorRef.current = null;
        monacoModelRef.current?.dispose();
        monacoModelRef.current = null;
        loadedAppNameRef.current = null;
      }
    };
  }, [editMode, mode, initialData, getJsonAppData, readOnly]);

  const handleModeChange = async (index: number) => {
    const newMode = index === 0 ? "form" : "json";

    if (newMode === "json" && editMode === "form") {
      setEditMode(newMode);
      setJsonError(null);
    } else if (newMode === "form" && editMode === "json") {
      if (editorRef.current) {
        const jsonValue = editorRef.current.getValue();
        try {
          const parsed = JSON.parse(jsonValue);
          updateFormFromApp(jsonToApp(parsed));
          setJsonError(null);
          editorRef.current?.dispose();
          editorRef.current = null;
          monacoModelRef.current?.dispose();
          monacoModelRef.current = null;
          setEditMode(newMode);
        } catch {
          setJsonError("Invalid JSON. Fix errors before switching to Form mode.");
        }
      } else {
        setEditMode(newMode);
      }
    }
  };

  const handleSubmit = () => {
    let appToSubmit: ConfigurationApp;

    if (editMode === "json" && editorRef.current) {
      const jsonValue = editorRef.current.getValue();
      try {
        const parsed = JSON.parse(jsonValue);
        appToSubmit = jsonToApp(parsed);
      } catch {
        setJsonError("Invalid JSON. Please fix errors before saving.");
        return;
      }
    } else {
      appToSubmit = getCurrentApp();
    }

    if (appToSubmit.name && appType(appToSubmit)) {
      editorRef.current?.dispose();
      editorRef.current = null;
      monacoModelRef.current?.dispose();
      monacoModelRef.current = null;
      onSubmit(appToSubmit, mode === "edit" ? initialData?.name : undefined);
    }
  };

  const handleCancel = () => {
    editorRef.current?.dispose();
    editorRef.current = null;
    monacoModelRef.current?.dispose();
    monacoModelRef.current = null;
    onCancel();
  };

  const submitLabel = mode === "edit" ? "Save Changes" : "Add App";

  const originalName = mode === "edit" ? initialData?.name : undefined;
  const duplicateName = name.trim() !== "" && allApps.some((p) => p.name === name.trim() && p.name !== originalName);

  const isValid = editMode === "form" ? Boolean(name && type && !missingRequiredParameter(type, parameters) && !duplicateName) : !jsonError;

  const selectedAppValue = mode === "edit" && initialData?.name ? initialData.name : NEW_APP_VALUE;

  const handleAppChange = (value: string) => {
    setJsonError(null);
    onAppSelect(value === NEW_APP_VALUE ? null : value);
  };

  const definition = getAppType(type);
  const demo = definition?.demo;

  const fillDemo = () => {
    if (!demo) return;
    setName(demo.name);
    setParameters({ ...demo.parameters });
  };

  return (
    <div className="app-form" style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--bgColor-muted)" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "8px 16px",
          borderBottom: "1px solid var(--borderColor-default)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Select value={selectedAppValue} onValueChange={(value) => value != null && handleAppChange(value)}>
            <SelectTrigger className="min-w-[200px]">
              <SelectValue>{(value) => (value === NEW_APP_VALUE ? "+ New" : (value as string))}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NEW_APP_VALUE}>+ New</SelectItem>
              {allApps.length > 0 && (
                <SelectGroup>
                  <SelectLabel>Edit existing</SelectLabel>
                  {allApps.map((p) => (
                    <SelectItem key={p.name} value={p.name}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              )}
            </SelectContent>
          </Select>
        </div>
        <SegmentedControl aria-label="Edit mode">
          <SegmentedControl.Button selected={editMode === "form"} onClick={() => handleModeChange(0)}>
            Form
          </SegmentedControl.Button>
          <SegmentedControl.Button selected={editMode === "json"} onClick={() => handleModeChange(1)}>
            JSON
          </SegmentedControl.Button>
        </SegmentedControl>
      </div>

      {readOnly && (
        <div style={{ padding: "8px 16px", background: "var(--bgColor-attention-muted)", color: "var(--fgColor-attention)", fontSize: 14 }}>
          Configuration is read-only. Contact your administrator for changes.
        </div>
      )}

      {jsonError && (
        <div style={{ padding: "8px 16px", background: "var(--bgColor-danger-muted)", color: "var(--fgColor-danger)", fontSize: 14 }}>{jsonError}</div>
      )}

      <div style={{ flex: 1, overflow: "auto", minHeight: 0 }}>
        {editMode === "form" ? (
          <div style={{ maxWidth: 600, padding: 16 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
              <FormControl>
                <FormControl.Label>Name</FormControl.Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="App name" disabled={readOnly} />
                {duplicateName && <FormControl.Validation variant="error">An app with this name already exists</FormControl.Validation>}
              </FormControl>

              {(definition?.parameters ?? []).map((parameter) => (
                <FormControl key={parameter.key}>
                  <FormControl.Label>{parameter.label}</FormControl.Label>
                  {parameter.type === "boolean" ? (
                    <Checkbox
                      checked={parameters[parameter.key] === "true"}
                      disabled={readOnly}
                      onCheckedChange={(checked) => setParameters((prev) => ({ ...prev, [parameter.key]: checked === true ? "true" : "" }))}
                    />
                  ) : parameter.type === "upload" ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <label className={cn(buttonVariants({ variant: "outline" }), "cursor-pointer", readOnly && "pointer-events-none opacity-50")}>
                        <FileIcon size={16} />
                        {(parameters[parameter.key] ?? "").trim() ? "Change file" : "Choose file"}
                        <input
                          type="file"
                          accept=".json,.yaml,.yml,application/json,application/yaml,text/yaml,text/plain"
                          hidden
                          disabled={readOnly}
                          onChange={(e) => {
                            handleUpload(parameter.key, e.target.files?.[0]);
                            e.target.value = "";
                          }}
                        />
                      </label>
                      <span style={{ fontSize: 12, color: "var(--fgColor-muted)" }}>
                        {uploadNames[parameter.key] ?? ((parameters[parameter.key] ?? "").trim() ? "Spec loaded" : "No file chosen")}
                      </span>
                    </div>
                  ) : (
                    <VariableSuggestInput
                      value={parameters[parameter.key] ?? ""}
                      onValueChange={(value) => setParameters((prev) => ({ ...prev, [parameter.key]: value }))}
                      variables={variables}
                      placeholder={parameter.placeholder}
                      disabled={readOnly}
                      trailingAction={
                        (parameter.type === "file" || parameter.type === "folder") && isWailsEnvironment() ? (
                          <IconButton
                            icon={parameter.type === "folder" ? FileDirectoryIcon : FileIcon}
                            aria-label={parameter.type === "folder" ? "Select folder" : "Select file"}
                            variant="invisible"
                            size="small"
                            tooltip={false}
                            onClick={async () => {
                              const path = parameter.type === "folder" ? await OpenDirectoryDialog() : await OpenFileDialog();
                              if (path) {
                                setParameters((prev) => ({ ...prev, [parameter.key]: path }));
                              }
                            }}
                            disabled={readOnly}
                          />
                        ) : undefined
                      }
                    />
                  )}
                  {parameter.caption && <FormControl.Caption>{parameter.caption}</FormControl.Caption>}
                </FormControl>
              ))}

              {demo && !readOnly && (
                <button
                  type="button"
                  onClick={fillDemo}
                  className="inline-flex items-center gap-1 self-start text-xs leading-[18px] text-primary hover:underline"
                >
                  <LightBulbIcon size={12} />
                  {demo.label}
                </button>
              )}
            </div>
          </div>
        ) : (
          <>
            <style>{`
              .app-form-editor .monaco-editor,
              .app-form-editor .monaco-editor-background,
              .app-form-editor .monaco-editor .margin {
                background-color: var(--bgColor-muted) !important;
              }
            `}</style>
            <div ref={editorContainerRef} className="app-form-editor" style={{ height: "100%", minHeight: 300, backgroundColor: "var(--bgColor-muted)" }} />
          </>
        )}
      </div>

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", padding: 16, borderTop: "1px solid var(--borderColor-default)" }}>
        <Button variant="outline" onClick={handleCancel}>
          {readOnly ? "Close" : "Cancel"}
        </Button>
        {!readOnly && (
          <Button onClick={handleSubmit} disabled={!isValid}>
            {submitLabel}
          </Button>
        )}
      </div>
    </div>
  );
}
