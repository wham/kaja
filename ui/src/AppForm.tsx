import { FileDirectoryIcon, FileIcon, LightBulbIcon } from "@primer/octicons-react";
import { ActionList, Button, Checkbox, FormControl, Link, SegmentedControl, Select, Stack, Text, TextInput } from "@primer/react";
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
  trailingAction?: React.ComponentProps<typeof TextInput>["trailingAction"];
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
      <TextInput
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
        block
        disabled={disabled}
        trailingAction={trailingAction}
      />
      {open && (
        // Keep focus in the input so a click on a suggestion isn't lost to blur.
        <div
          onMouseDown={(e) => e.preventDefault()}
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            minWidth: 320,
            zIndex: 10,
            marginTop: 4,
            background: "var(--overlay-bgColor)",
            border: "1px solid var(--borderColor-default)",
            borderRadius: 6,
            boxShadow: "var(--shadow-floating-small)",
            maxHeight: 240,
            overflowY: "auto",
          }}
        >
          <ActionList>
            {names.map((name, index) => (
              <ActionList.Item key={name} active={index === highlightIndex} onSelect={() => insert(name)}>
                {"${" + name + "}"}
                <ActionList.Description>{variables[name]}</ActionList.Description>
              </ActionList.Item>
            ))}
          </ActionList>
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

  const handleAppChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
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
      <style>{`
        .app-form select,
        .app-form span:has(> input:not([type="radio"]):not([type="checkbox"])),
        .app-form span:has(> select) {
          background-color: var(--bgColor-muted) !important;
        }
      `}</style>
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
          <Select value={selectedAppValue} onChange={handleAppChange} style={{ minWidth: 200 }}>
            <Select.Option value={NEW_APP_VALUE}>+ New</Select.Option>
            {allApps.length > 0 && (
              <Select.OptGroup label="Edit existing">
                {allApps.map((p) => (
                  <Select.Option key={p.name} value={p.name}>
                    {p.name}
                  </Select.Option>
                ))}
              </Select.OptGroup>
            )}
          </Select>
        </div>
        <SegmentedControl aria-label="Edit mode" onChange={handleModeChange}>
          <SegmentedControl.Button selected={editMode === "form"}>Form</SegmentedControl.Button>
          <SegmentedControl.Button selected={editMode === "json"}>JSON</SegmentedControl.Button>
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
            <Stack direction="vertical" gap="spacious">
              <FormControl disabled={readOnly}>
                <FormControl.Label>Name</FormControl.Label>
                <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="App name" block disabled={readOnly} />
                {duplicateName && <FormControl.Validation variant="error">An app with this name already exists</FormControl.Validation>}
              </FormControl>

              {(definition?.parameters ?? []).map((parameter) => (
                <FormControl key={parameter.key} disabled={readOnly}>
                  <FormControl.Label>{parameter.label}</FormControl.Label>
                  {parameter.type === "boolean" ? (
                    <Checkbox
                      checked={parameters[parameter.key] === "true"}
                      disabled={readOnly}
                      onChange={(e) => setParameters((prev) => ({ ...prev, [parameter.key]: e.target.checked ? "true" : "" }))}
                    />
                  ) : parameter.type === "upload" ? (
                    <Stack direction="horizontal" gap="condensed" align="center">
                      <Button as="label" leadingVisual={FileIcon} disabled={readOnly}>
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
                      </Button>
                      <Text style={{ fontSize: 12, color: "var(--fgColor-muted)" }}>
                        {uploadNames[parameter.key] ?? ((parameters[parameter.key] ?? "").trim() ? "Spec loaded" : "No file chosen")}
                      </Text>
                    </Stack>
                  ) : (
                    <VariableSuggestInput
                      value={parameters[parameter.key] ?? ""}
                      onValueChange={(value) => setParameters((prev) => ({ ...prev, [parameter.key]: value }))}
                      variables={variables}
                      placeholder={parameter.placeholder}
                      disabled={readOnly}
                      trailingAction={
                        (parameter.type === "file" || parameter.type === "folder") && isWailsEnvironment() ? (
                          <TextInput.Action
                            icon={parameter.type === "folder" ? FileDirectoryIcon : FileIcon}
                            aria-label={parameter.type === "folder" ? "Select folder" : "Select file"}
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
                <Link
                  as="button"
                  type="button"
                  onClick={fillDemo}
                  style={{ fontSize: 12, lineHeight: "18px", display: "inline-flex", alignItems: "center", gap: 4, alignSelf: "flex-start" }}
                >
                  <LightBulbIcon size={12} />
                  {demo.label}
                </Link>
              )}
            </Stack>
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
        <Button onClick={handleCancel}>{readOnly ? "Close" : "Cancel"}</Button>
        {!readOnly && (
          <Button variant="primary" onClick={handleSubmit} disabled={!isValid}>
            {submitLabel}
          </Button>
        )}
      </div>
    </div>
  );
}
