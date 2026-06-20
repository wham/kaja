import { FileDirectoryIcon, FileIcon, LightBulbIcon } from "@primer/octicons-react";
import { Button, Checkbox, FormControl, Link, SegmentedControl, Select, Stack, TextInput } from "@primer/react";
import * as monaco from "monaco-editor";
import { useState, useRef, useEffect, useCallback } from "react";
import { appHeaders, appParameters, appType, buildApp, getAppType } from "./appTypes";
import { ConfigurationApp } from "./server/api";
import { OpenDirectoryDialog, OpenFileDialog } from "./wailsjs/go/main/App";
import { formatJson } from "./formatter";
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

const NEW_APP_VALUE = "__new__";

interface AppFormProps {
  mode: "create" | "edit";
  initialData?: ConfigurationApp;
  allApps: ConfigurationApp[];
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
// app's type defines but the form leaves empty, or undefined if all are set.
function missingRequiredParameter(type: string, parameters: Record<string, string>): string | undefined {
  const definition = getAppType(type);
  if (!definition) return undefined;
  for (const parameter of definition.parameters) {
    if (parameter.optional) continue;
    if (!(parameters[parameter.key] ?? "").trim()) return parameter.label;
  }
  return undefined;
}

export function AppForm({ mode, initialData, allApps, readOnly = false, onSubmit, onCancel, onAppSelect }: AppFormProps) {
  const [editMode, setEditMode] = useState<EditMode>("form");
  const [name, setName] = useState("");
  const [type, setType] = useState("grpc");
  const [parameters, setParameters] = useState<Record<string, string>>({});
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
                  ) : (
                    <TextInput
                      value={parameters[parameter.key] ?? ""}
                      onChange={(e) => setParameters((prev) => ({ ...prev, [parameter.key]: e.target.value }))}
                      placeholder={parameter.placeholder}
                      block
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
