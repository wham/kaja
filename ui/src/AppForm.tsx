import { ChevronDown, ChevronRight, Folder, FileIcon, Lightbulb, Plus, Trash2 } from "lucide-react";
import { Button, buttonVariants } from "./components/button";
import { Checkbox } from "./components/checkbox";
import { FormControl } from "./components/form-control";
import { IconButton } from "./components/icon-button";
import { Input } from "./components/input";
import { cn } from "./cn";
import { useState, useRef, useEffect, useCallback, useMemo, type ComponentType } from "react";
import { AppSurface, CustomFormProps, appHeaders, appParameters, appType, buildApp, getAppType, typeForwardsHeaders } from "./appTypes";
import { deriveGenericName, uniqueAppName } from "./appForms";
import { FormHints, FormHintsContext, FormSection } from "./FormSection";
import { AppNameField } from "./AppNameField";
import { GrpcForm } from "./GrpcForm";
import { McpForm } from "./McpForm";
import { OpenAiForm } from "./OpenAiForm";
import { OpenApiForm } from "./OpenApiForm";
import { ReadOnlyBanner } from "./ReadOnlyBanner";
import { AgentNotes } from "./agentHints";
import { VariableSuggestInput } from "./VariableSuggestInput";
import { WorkspaceApp } from "./server/api";
import { desktop, isWailsEnvironment } from "./wails";
import { PHONE_QUERY } from "./phone";
import { useMediaQuery } from "./useMediaQuery";

const CUSTOM_FORMS: Record<string, ComponentType<CustomFormProps>> = { grpc: GrpcForm, openai: OpenAiForm, mcp: McpForm, openapi: OpenApiForm };

// Kept as a list rather than a map so a name stays where it is while it is typed.
interface HeaderEntry {
  name: string;
  value: string;
}

interface AppFormProps {
  mode: "create" | "edit";
  initialData?: WorkspaceApp;
  allApps: WorkspaceApp[];
  // Usable in parameter values as ${NAME}, and offered when "${" is typed.
  variables: { [key: string]: string };
  readOnly?: boolean;
  // A phone draws no footer: Save is handed to the header, where iOS keeps it.
  onSaveControlChange?: (control: AppFormSaveControl | undefined) => void;
  onSubmit: (app: WorkspaceApp, originalName?: string) => void;
  onCancel: () => void;
  // A phone has no row menu to hold Delete, so the form carries it there.
  onDelete?: (appName: string) => void;
  // What the agent that opened the form read up on about the API.
  agentNotes?: AgentNotes;
  kaja?: CustomFormProps["kaja"];
}

export interface AppFormSaveControl {
  label: string;
  disabled: boolean;
  onSave: () => void;
}

function createEmptyApp(): WorkspaceApp {
  return buildApp("", "grpc", {}, {});
}

// missingRequiredParameter returns the label of the first required parameter left
// empty, or undefined if all are set. It also enforces requireOneOf groups.
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

interface AdvancedSectionProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  headers: HeaderEntry[];
  onHeadersChange: (update: (previous: HeaderEntry[]) => HeaderEntry[]) => void;
  variables: { [key: string]: string };
  readOnly: boolean;
}

// AdvancedSection holds what the app's own configuration can't derive: the headers it
// sends with every request.
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

export function AppForm({
  mode,
  initialData,
  allApps,
  variables,
  readOnly = false,
  onSaveControlChange,
  onSubmit,
  onCancel,
  onDelete,
  agentNotes,
  kaja,
}: AppFormProps) {
  const phone = useMediaQuery(PHONE_QUERY);
  const [name, setName] = useState("");
  const [type, setType] = useState("grpc");
  const [parameters, setParameters] = useState<Record<string, string>>({});
  const [headers, setHeaders] = useState<HeaderEntry[]>([]);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  // The parameter value itself holds the file's text content.
  const [uploadNames, setUploadNames] = useState<Record<string, string>>({});
  // What a custom form last read, and whether it holds enough to create the app.
  const [surface, setSurface] = useState<AppSurface | undefined>(undefined);
  const [customReady, setCustomReady] = useState(false);

  const getCurrentApp = useCallback(
    (appName: string): WorkspaceApp => {
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
      return buildApp(appName, type, params, headerMap);
    },
    [type, parameters, headers],
  );

  const updateFormFromApp = useCallback((app: WorkspaceApp) => {
    setName(app.name);
    setType(appType(app) || "grpc");
    setParameters(appParameters(app));
    setHeaders(Object.entries(appHeaders(app)).map(([headerName, value]) => ({ name: headerName, value })));
    setUploadNames({});
    setSurface(undefined);
    setCustomReady(false);
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

  // In create mode initialData carries just the type picked in the New dialog; in edit
  // mode it is the full app. This runs during render rather than in an effect so the
  // fields are already the new app's when a keyed custom form below mounts — otherwise
  // it would mount against the previous app's parameters and read the wrong document.
  const [loaded, setLoaded] = useState<{ mode: string; app?: WorkspaceApp; generation: number } | null>(null);
  if (loaded?.mode !== mode || loaded?.app !== initialData) {
    setLoaded({ mode, app: initialData, generation: (loaded?.generation ?? 0) + 1 });
    updateFormFromApp(initialData ?? createEmptyApp());
  }

  const submitLabel = mode === "edit" ? "Save" : "Add app";

  const originalName = mode === "edit" ? initialData?.name : undefined;
  const duplicateName = name.trim() !== "" && allApps.some((p) => p.name === name.trim() && p.name !== originalName);
  const takenNames = useMemo(() => allApps.map((app) => app.name).filter((appName) => appName !== originalName), [allApps, originalName]);

  const definition = getAppType(type);
  const customForm = Boolean(definition?.customForm);
  const CustomForm = CUSTOM_FORMS[type] ?? OpenApiForm;

  // A new app is named for what it describes, so its form has no Name field. A custom
  // form derives the name from what it read; a plain one from its fields here, and a
  // type's own name is what is left where neither says anything. The field comes back
  // where the name can't be used, which is a name an agent handed over that is taken.
  const nameField = mode === "edit" || duplicateName;
  const appName = name.trim() || (mode === "create" ? uniqueAppName((customForm ? "" : deriveGenericName(type, parameters)) || type, takenNames) : "");

  const handleSubmit = () => {
    const app = getCurrentApp(appName);
    if (app.name && appType(app)) onSubmit(app, mode === "edit" ? initialData?.name : undefined);
  };
  const handleSubmitRef = useRef(handleSubmit);
  handleSubmitRef.current = handleSubmit;

  const handleCancel = () => onCancel();

  const isValid = Boolean(appName && type && !missingRequiredParameter(type, parameters) && !duplicateName && (!customForm || customReady));

  // The margin is for an agent's notes, which a phone has no room for and has no agent to write.
  const hinted = Boolean(agentNotes && !readOnly && !phone && Object.keys(agentNotes.hints).length > 0);
  const formHints = useMemo<FormHints | undefined>(
    () =>
      hinted && agentNotes
        ? { notes: agentNotes, parameters, known: new Set((getAppType(type)?.parameters ?? []).map((parameter) => parameter.key)) }
        : undefined,
    [hinted, agentNotes, parameters, type],
  );

  // Read rather than depended on: the caller hands a new function every render.
  const onSaveControlChangeRef = useRef(onSaveControlChange);
  onSaveControlChangeRef.current = onSaveControlChange;
  useEffect(() => {
    if (!phone || readOnly) return;
    onSaveControlChangeRef.current?.({ label: submitLabel, disabled: !isValid, onSave: () => handleSubmitRef.current() });
    return () => onSaveControlChangeRef.current?.(undefined);
  }, [phone, readOnly, submitLabel, isValid]);

  const demo = definition?.demo;

  const fillDemo = () => {
    if (!demo) return;
    setName(demo.name);
    setParameters({ ...demo.parameters });
  };

  return (
    <div className="flex h-full flex-col bg-background">
      {readOnly && <ReadOnlyBanner>Apps are configured in kaja.json.</ReadOnlyBanner>}

      <div className="@container min-h-0 flex-1 overflow-auto">
        <FormHintsContext.Provider value={formHints}>
          <div className={cn(formHints ? "max-w-[1000px]" : "max-w-[640px]", phone ? "px-4 py-5" : "px-6 py-7")}>
            <div className={cn("flex flex-col", phone ? "gap-5" : "gap-7")}>
              {customForm ? (
                // Keyed by the app being loaded: switching apps in the sidebar, or picking a type
                // in the New dialog again, starts the form over rather than reading the next
                // server behind the previous one's transport and credentials.
                <CustomForm
                  key={loaded?.generation}
                  nameField={nameField}
                  name={name}
                  onNameChange={setName}
                  duplicateName={duplicateName}
                  takenNames={takenNames}
                  parameters={parameters}
                  onParametersChange={setParameters}
                  variables={variables}
                  readOnly={readOnly}
                  onSurfaceChange={setSurface}
                  onReadyChange={setCustomReady}
                  kaja={readOnly ? undefined : kaja}
                />
              ) : (
                <>
                  {nameField && (
                    <FormSection>
                      <AppNameField id="app-name" name={name} onNameChange={setName} duplicate={duplicateName} readOnly={readOnly} />
                    </FormSection>
                  )}

                  {(definition?.parameters ?? []).map((parameter, index) => {
                    // A picked parameter names a folder outside the workspace, which the
                    // desktop is granted by the picker alone, so there the field states
                    // what was picked rather than taking a path on trust.
                    const picked = isWailsEnvironment() ? parameter.picked : undefined;
                    const pick = async () => {
                      const app = await desktop();
                      const path = parameter.type === "folder" ? await app.OpenDirectoryDialog() : await app.OpenFileDialog();
                      if (path) setParameters((prev) => ({ ...prev, [parameter.key]: path }));
                    };
                    const caption = picked?.caption ?? parameter.caption;
                    return (
                      <FormSection key={parameter.key} fields={[parameter.key]} lead={index === 0}>
                        <FormControl>
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
                              placeholder={picked ? picked.placeholder : parameter.placeholder}
                              disabled={readOnly}
                              readOnly={!!picked}
                              onClick={picked && !readOnly ? pick : undefined}
                              trailingAction={
                                (parameter.type === "file" || parameter.type === "folder") && isWailsEnvironment() ? (
                                  <IconButton
                                    icon={parameter.type === "folder" ? Folder : FileIcon}
                                    aria-label={parameter.type === "folder" ? "Select folder" : "Select file"}
                                    variant="ghost"
                                    size="sm"
                                    tooltip="native"
                                    onClick={pick}
                                    disabled={readOnly}
                                  />
                                ) : undefined
                              }
                            />
                          )}
                          {caption && <FormControl.Caption>{caption}</FormControl.Caption>}
                        </FormControl>
                      </FormSection>
                    );
                  })}

                  {demo && !readOnly && (
                    <FormSection>
                      <button
                        type="button"
                        onClick={fillDemo}
                        className="inline-flex items-center gap-1 self-start text-xs leading-[18px] text-primary hover:underline"
                      >
                        <Lightbulb size={12} />
                        {demo.label}
                      </button>
                    </FormSection>
                  )}
                </>
              )}

              {typeForwardsHeaders(type) && (!customForm || surface) && (
                <FormSection>
                  <AdvancedSection
                    open={advancedOpen}
                    onOpenChange={setAdvancedOpen}
                    headers={headers}
                    onHeadersChange={setHeaders}
                    variables={variables}
                    readOnly={readOnly}
                  />
                </FormSection>
              )}

              {phone && mode === "edit" && !readOnly && onDelete && initialData && (
                <Button variant="outline" className="mt-4 h-10 text-destructive hover:text-destructive" onClick={() => onDelete(initialData.name)}>
                  <Trash2 size={16} />
                  Delete app
                </Button>
              )}
            </div>
          </div>
        </FormHintsContext.Provider>
      </div>

      {!phone && (
        <div className="flex items-center justify-end gap-2 border-t border-border p-4">
          <Button variant="outline" onClick={handleCancel}>
            {readOnly ? "Close" : "Cancel"}
          </Button>
          {!readOnly && (
            <Button onClick={handleSubmit} disabled={!isValid}>
              {submitLabel}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
