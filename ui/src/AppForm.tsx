import { ChevronDown, ChevronRight, Folder, FileIcon, Lightbulb, Plus, Trash2 } from "lucide-react";
import { Button, buttonVariants } from "./components/button";
import { Checkbox } from "./components/checkbox";
import { FormControl } from "./components/form-control";
import { IconButton } from "./components/icon-button";
import { Input } from "./components/input";
import { cn } from "./cn";
import * as monaco from "monaco-editor";
import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { appHeaders, appParameters, appType, buildApp, getAppType, typeForwardsHeaders } from "./appTypes";
import { AppNameField } from "./AppNameField";
import { OpenApiForm } from "./OpenApiForm";
import { VariableSuggestInput } from "./VariableSuggestInput";
import { ConfigurationApp, OpenApiDocument } from "./server/api";
import { OpenDirectoryDialog, OpenFileDialog } from "./wailsjs/go/main/App";
import { formatJson } from "./formatter";
import { APP_CONFIG_JSON_URI } from "./jsonSchemas";
import { getVariables } from "./variableExpansion";
import { isWailsEnvironment } from "./wails";

type EditMode = "form" | "json";

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

// A header the app sends with every request. Kept as a list rather than a map so
// a name stays where it is while it is being typed.
interface HeaderEntry {
  name: string;
  value: string;
}

interface AppFormProps {
  mode: "create" | "edit";
  initialData?: ConfigurationApp;
  allApps: ConfigurationApp[];
  // Configured variables, usable in parameter values as ${NAME} and offered as
  // suggestions when "${" is typed.
  variables: { [key: string]: string };
  readOnly?: boolean;
  // Which view the tab is showing. The control that switches it lives in the tab
  // strip, so the tab owns the choice.
  editMode: EditMode;
  onSubmit: (app: ConfigurationApp, originalName?: string) => void;
  onCancel: () => void;
  // The user has started working here, so the tab should stop being a preview.
  // Whether the JSON parses, which decides if the view can be switched back.
  onJsonValidChange: (valid: boolean) => void;
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

function operations(count: number): string {
  return `${count} operation${count === 1 ? "" : "s"}`;
}

interface AdvancedSectionProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  headers: HeaderEntry[];
  onHeadersChange: (update: (previous: HeaderEntry[]) => HeaderEntry[]) => void;
  variables: { [key: string]: string };
  readOnly: boolean;
}

// AdvancedSection holds what the app's own configuration can't derive: the
// headers it sends with every request. Collapsed by default, with a count when
// there is something inside.
function AdvancedSection({ open, onOpenChange, headers, onHeadersChange, variables, readOnly }: AdvancedSectionProps) {
  const configured = headers.filter((header) => header.name.trim()).length;

  return (
    <div className="flex flex-col gap-4">
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        className="flex items-center gap-1.5 self-start text-sm text-muted-foreground hover:text-foreground"
        aria-expanded={open}
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span>Advanced</span>
        {configured > 0 && <span className="rounded-sm bg-muted px-1.5 py-0.5 text-xs">{configured} changed</span>}
      </button>

      {open && (
        <div className="flex flex-col gap-2">
          <span className="text-sm text-foreground">Headers sent with every request</span>
          {headers.map((header, index) => (
            <div key={index} className="flex items-center gap-2">
              <Input
                className="w-48"
                value={header.name}
                placeholder="X-Tenant-Id"
                disabled={readOnly}
                onChange={(event) => onHeadersChange((previous) => previous.map((entry, i) => (i === index ? { ...entry, name: event.target.value } : entry)))}
              />
              <div className="flex-1">
                <VariableSuggestInput
                  value={header.value}
                  onValueChange={(value) => onHeadersChange((previous) => previous.map((entry, i) => (i === index ? { ...entry, value } : entry)))}
                  variables={variables}
                  placeholder="Value"
                  disabled={readOnly}
                />
              </div>
              <IconButton
                icon={Trash2}
                aria-label="Remove header"
                variant="ghost"
                size="sm"
                disabled={readOnly}
                onClick={() => onHeadersChange((previous) => previous.filter((_, i) => i !== index))}
              />
            </div>
          ))}
          {!readOnly && (
            <button
              type="button"
              onClick={() => onHeadersChange((previous) => [...previous, { name: "", value: "" }])}
              className="flex items-center gap-1.5 self-start text-xs text-muted-foreground hover:text-foreground"
            >
              <Plus size={12} />
              <span>Add header</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function AppForm({ mode, initialData, allApps, variables, readOnly = false, editMode, onSubmit, onCancel, onJsonValidChange }: AppFormProps) {
  const [name, setName] = useState("");
  const [type, setType] = useState("grpc");
  const [parameters, setParameters] = useState<Record<string, string>>({});
  const [headers, setHeaders] = useState<HeaderEntry[]>([]);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  // Names of files chosen for "upload" parameters, shown next to the picker. The
  // parameter value itself holds the file's text content.
  const [uploadNames, setUploadNames] = useState<Record<string, string>>({});
  const [jsonError, setJsonError] = useState<string | null>(null);
  // What the OpenAPI form last read, for the receipt in the footer, and whether
  // it holds enough to create the app.
  const [openApiDocument, setOpenApiDocument] = useState<OpenApiDocument | undefined>(undefined);
  const [openApiReady, setOpenApiReady] = useState(false);
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
    const headerMap: Record<string, string> = {};
    for (const header of headers) {
      const headerName = header.name.trim();
      if (headerName) headerMap[headerName] = header.value;
    }
    return buildApp(name, type, params, headerMap);
  }, [name, type, parameters, headers]);

  const updateFormFromApp = useCallback((app: ConfigurationApp) => {
    setName(app.name);
    setType(appType(app) || "grpc");
    setParameters(appParameters(app));
    setHeaders(Object.entries(appHeaders(app)).map(([headerName, value]) => ({ name: headerName, value })));
    setUploadNames({});
    setOpenApiDocument(undefined);
    setOpenApiReady(false);
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

  // In create mode initialData carries just the type picked in the New dialog;
  // in edit mode it is the full app. Either way the form reflects it. This runs
  // during render rather than in an effect so the fields are already the new
  // app's when a keyed custom form below mounts - otherwise it would mount
  // against the previous app's parameters and read the wrong document first.
  const [loaded, setLoaded] = useState<{ mode: string; app?: ConfigurationApp } | null>(null);
  if (loaded?.mode !== mode || loaded?.app !== initialData) {
    setLoaded({ mode, app: initialData });
    updateFormFromApp(initialData ?? createEmptyApp());
  }

  // Track which app is currently loaded in the JSON editor
  const loadedAppNameRef = useRef<string | null>(null);

  // The JSON editor opens on what the form currently holds, so switching between
  // the two views doesn't drop what was filled in on either side.
  const getJsonAppData = getCurrentApp;

  useEffect(() => {
    if (editMode === "json" && editorContainerRef.current) {
      const appData = getJsonAppData();
      const currentAppKey = mode === "edit" ? initialData?.name : "__new__";

      if (!editorRef.current) {
        loadedAppNameRef.current = currentAppKey ?? null;
        const jsonStr = JSON.stringify(appToJson(appData), null, 2);

        const modelUri = APP_CONFIG_JSON_URI;
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

        // The editor opens on what the form holds, so it parses; say so, in case
        // another tab left the shared flag reporting otherwise.
        onJsonValidChange(true);

        monacoModelRef.current.onDidChangeContent(() => {
          const value = monacoModelRef.current?.getValue() ?? "";
          let valid = true;
          try {
            JSON.parse(value);
          } catch {
            valid = false;
          }
          setJsonError(valid ? null : "Invalid JSON. Fix it to go back to the form or save.");
          onJsonValidChange(valid);
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
        // Nothing to be invalid once the editor is gone.
        onJsonValidChange(true);
      }
    };
  }, [editMode, mode, initialData, getJsonAppData, readOnly, onJsonValidChange]);

  // Leaving the JSON view carries what was typed there back into the fields. The
  // control is disabled while the JSON is invalid, so this only has to handle
  // JSON that parses.
  const leavingJsonRef = useRef(false);
  if (editMode === "form" && leavingJsonRef.current) {
    leavingJsonRef.current = false;
    const jsonValue = editorRef.current?.getValue();
    if (jsonValue) {
      try {
        updateFormFromApp(jsonToApp(JSON.parse(jsonValue)));
        setJsonError(null);
      } catch {
        setJsonError("Invalid JSON. The fields still hold what was there before.");
      }
    }
  }
  if (editMode === "json") {
    leavingJsonRef.current = true;
  }

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

  const submitLabel = mode === "edit" ? "Save" : "Add app";

  const originalName = mode === "edit" ? initialData?.name : undefined;
  const duplicateName = name.trim() !== "" && allApps.some((p) => p.name === name.trim() && p.name !== originalName);
  const takenNames = useMemo(() => allApps.map((app) => app.name).filter((appName) => appName !== originalName), [allApps, originalName]);

  const definition = getAppType(type);
  const customForm = Boolean(definition?.customForm);

  const isValid =
    editMode === "form" ? Boolean(name && type && !missingRequiredParameter(type, parameters) && !duplicateName && (!customForm || openApiReady)) : !jsonError;

  const demo = definition?.demo;

  const fillDemo = () => {
    if (!demo) return;
    setName(demo.name);
    setParameters({ ...demo.parameters });
  };

  return (
    <div className="flex h-full flex-col bg-background">
      {readOnly && (
        <div className="bg-amber-500/10 px-4 py-2 text-sm text-amber-600 dark:text-amber-400">
          Configuration is read-only. Contact your administrator for changes.
        </div>
      )}

      {jsonError && <div className="bg-destructive/10 px-4 py-2 text-sm text-destructive">{jsonError}</div>}

      <div className="min-h-0 flex-1 overflow-auto">
        {editMode === "form" ? (
          <div className="max-w-[640px] p-6">
            <div className="flex flex-col gap-6">
              {customForm ? (
                // Keyed by the app being edited: switching apps in the picker
                // starts the form over rather than reading the next document
                // behind the previous one's servers and credentials.
                <OpenApiForm
                  key={initialData?.name || "__new__"}
                  name={name}
                  onNameChange={setName}
                  duplicateName={duplicateName}
                  takenNames={takenNames}
                  parameters={parameters}
                  onParametersChange={setParameters}
                  variables={variables}
                  readOnly={readOnly}
                  onDocumentChange={setOpenApiDocument}
                  onReadyChange={setOpenApiReady}
                />
              ) : (
                <>
                  <AppNameField id="app-name" name={name} onNameChange={setName} duplicate={duplicateName} readOnly={readOnly} />

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
                          <span className="text-xs text-muted-foreground">
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
                                icon={parameter.type === "folder" ? Folder : FileIcon}
                                aria-label={parameter.type === "folder" ? "Select folder" : "Select file"}
                                variant="ghost"
                                size="sm"
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
                      <Lightbulb size={12} />
                      {demo.label}
                    </button>
                  )}
                </>
              )}

              {typeForwardsHeaders(type) && (!customForm || openApiDocument) && (
                <AdvancedSection
                  open={advancedOpen}
                  onOpenChange={setAdvancedOpen}
                  headers={headers}
                  onHeadersChange={setHeaders}
                  variables={variables}
                  readOnly={readOnly}
                />
              )}
            </div>
          </div>
        ) : (
          <div ref={editorContainerRef} className="h-full min-h-[300px] bg-background" />
        )}
      </div>

      <div className="flex items-center justify-between gap-4 border-t border-border p-4">
        {/* The receipt: what clicking the button will add, counted from the document. */}
        <p className="text-xs text-muted-foreground">
          {openApiDocument && name.trim() && editMode === "form"
            ? mode === "edit"
              ? `${name.trim()} exposes ${operations(openApiDocument.operationCount)}.`
              : `Adds ${operations(openApiDocument.operationCount)} under ${name.trim()} in the sidebar.`
            : ""}
        </p>
        <div className="flex shrink-0 gap-2">
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
    </div>
  );
}
