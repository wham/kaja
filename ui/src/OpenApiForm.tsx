import {
  ArrowRight,
  CircleAlert,
  CircleCheck,
  CircleX,
  FileIcon,
  Info,
  Key,
  Link as LinkIcon,
  Lock,
  Pencil,
  RefreshCw,
  Server as ServerIcon,
  Shield,
  Sparkles,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, buttonVariants } from "./components/button";
import { IconButton } from "./components/icon-button";
import { Input } from "./components/input";
import { SegmentedControl } from "./components/segmented-control";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./components/select";
import { Spinner } from "./components/spinner";
import { VariableSuggestInput } from "./VariableSuggestInput";
import { buildApp, getAppType } from "./appTypes";
import { cn } from "./cn";
import {
  NO_CREDENTIALS,
  credentialNote,
  credentialPlaceholder,
  defaultSecurityScheme,
  defaultVariableValues,
  isAbsoluteHttpUrl,
  isBasicScheme,
  isUsableBaseUrl,
  matchServerUrl,
  resolveServerUrl,
  schemeIdentity,
  schemeLabel,
} from "./openApiDocument";
import { OpenApiDocument, OpenApiProblem, OpenApiProblemKind, OpenApiSecurityScheme } from "./server/api";
import { getApiClient } from "./server/connection";

// Where the document comes from. The value itself lives in specUrl (URL) or
// specContent (file, paste); switching mode clears it but keeps everything the
// document filled in, since people often re-point at a local copy of the same API.
type SourceMode = "url" | "file" | "paste";

type ReadState =
  { status: "idle" } | { status: "reading" } | { status: "read"; document: OpenApiDocument; readAt: number } | { status: "problem"; problem: OpenApiProblem };

const READ_DEBOUNCE_MS = 600;
const PASTE_DEBOUNCE_MS = 400;

interface OpenApiFormProps {
  name: string;
  onNameChange: (name: string) => void;
  duplicateName: boolean;
  parameters: Record<string, string>;
  onParametersChange: (update: (previous: Record<string, string>) => Record<string, string>) => void;
  variables: { [key: string]: string };
  readOnly: boolean;
  // The document the form last read, for the receipt in the footer.
  onDocumentChange: (document: OpenApiDocument | undefined) => void;
  // Whether the app can be created from what the form holds.
  onReadyChange: (ready: boolean) => void;
}

// OpenApiForm is the New/Edit form for an OpenAPI app. It asks for one thing -
// the document - and everything after it is a choice between things the document
// already declared.
export function OpenApiForm({
  name,
  onNameChange,
  duplicateName,
  parameters,
  onParametersChange,
  variables,
  readOnly,
  onDocumentChange,
  onReadyChange,
}: OpenApiFormProps) {
  const [sourceMode, setSourceMode] = useState<SourceMode>(() => ((parameters.specContent ?? "").trim() ? "paste" : "url"));
  const [state, setState] = useState<ReadState>({ status: "idle" });
  const [uploadName, setUploadName] = useState("");
  const [serverChoice, setServerChoice] = useState<number | "custom">(0);
  const [serverVariables, setServerVariables] = useState<Record<number, Record<string, string>>>({});
  const [customServerUrl, setCustomServerUrl] = useState("");

  const parametersRef = useRef(parameters);
  parametersRef.current = parameters;
  // Only the latest read may write to state; anything older is discarded.
  const readIdRef = useRef(0);
  const nameTouchedRef = useRef(Boolean(name));
  // Credentials typed for a scheme, kept while another scheme is selected so
  // flipping back and forth doesn't lose typing.
  const credentialsRef = useRef<Record<string, Credentials>>({});

  const specUrl = parameters.specUrl ?? "";
  const specContent = parameters.specContent ?? "";
  const source = sourceMode === "url" ? specUrl : specContent;
  const document = state.status === "read" ? state.document : undefined;

  const read = useCallback(async () => {
    const readId = ++readIdRef.current;
    setState({ status: "reading" });
    try {
      const app = buildApp("", "openapi", parametersRef.current, {});
      const openapi = app.app.oneofKind === "openapi" ? app.app.openapi : undefined;
      const { response } = await getApiClient().inspectOpenApi({ openapi });
      if (readId !== readIdRef.current) return;
      if (response.document) {
        setState({ status: "read", document: response.document, readAt: Date.now() });
      } else {
        setState({
          status: "problem",
          problem: response.problem ?? { kind: OpenApiProblemKind.OPEN_API_PROBLEM_UNKNOWN, message: "Couldn't read the document", detail: "" },
        });
      }
    } catch (error) {
      if (readId !== readIdRef.current) return;
      setState({
        status: "problem",
        problem: {
          kind: OpenApiProblemKind.OPEN_API_PROBLEM_UNKNOWN,
          message: "Couldn't read the document",
          detail: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }, []);

  // Read the document once the source settles: on a pause in typing for a URL
  // that parses, on a pause in a pasted document, and immediately for a file or
  // for whatever an existing app was configured with.
  const firstRunRef = useRef(true);
  useEffect(() => {
    const immediate = firstRunRef.current || sourceMode === "file";
    firstRunRef.current = false;

    if (!source.trim() || (sourceMode === "url" && !isAbsoluteHttpUrl(source))) {
      readIdRef.current++;
      setState({ status: "idle" });
      return;
    }
    if (immediate) {
      read();
      return;
    }
    const timer = setTimeout(read, sourceMode === "paste" ? PASTE_DEBOUNCE_MS : READ_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [source, sourceMode, read]);

  useEffect(() => onDocumentChange(document), [document, onDocumentChange]);

  // Take the name from the document's title until the user types one.
  useEffect(() => {
    if (document && !nameTouchedRef.current && document.title) {
      onNameChange(document.title);
    }
  }, [document, onNameChange]);

  // Restore the server and credentials the app was configured with, matching them
  // against what the document declares now. A choice that has vanished falls back
  // rather than silently pointing somewhere else.
  useEffect(() => {
    if (!document) return;
    const baseUrl = (parametersRef.current.baseUrl ?? "").trim();
    const defaults: Record<number, Record<string, string>> = {};
    document.servers.forEach((server, index) => {
      defaults[index] = defaultVariableValues(server);
    });

    let matched: number | undefined;
    document.servers.forEach((server, index) => {
      const values = matchServerUrl(server, baseUrl);
      if (values && matched === undefined) {
        matched = index;
        defaults[index] = values;
      }
    });

    setServerVariables(defaults);
    if (matched !== undefined) {
      setServerChoice(matched);
    } else if (baseUrl && document.servers.length > 0) {
      setServerChoice("custom");
    } else {
      setServerChoice(0);
    }
    setCustomServerUrl(baseUrl || (document.servers[0] ? resolveServerUrl(document.servers[0], defaults[0]) : ""));

    if (!parametersRef.current.securityScheme) {
      onParametersChange((previous) => ({ ...previous, securityScheme: defaultSecurityScheme(document) }));
    }
  }, [document, onParametersChange]);

  const resolvedServerUrl = useMemo(() => {
    if (!document || document.servers.length === 0) return (parameters.baseUrl ?? "").trim();
    if (serverChoice === "custom") return customServerUrl.trim();
    const server = document.servers[serverChoice];
    return server ? resolveServerUrl(server, serverVariables[serverChoice] ?? {}) : "";
  }, [document, serverChoice, serverVariables, customServerUrl, parameters.baseUrl]);

  // Requests go where the form says they go, so the choice is written out as the
  // app's base URL rather than re-derived from the document later.
  useEffect(() => {
    if (!document || document.servers.length === 0) return;
    onParametersChange((previous) => (previous.baseUrl === resolvedServerUrl ? previous : { ...previous, baseUrl: resolvedServerUrl }));
  }, [document, resolvedServerUrl, onParametersChange]);

  useEffect(() => {
    const ready = document ? isUsableBaseUrl(resolvedServerUrl) : Boolean((parameters.baseUrl ?? "").trim() && source.trim() && state.status !== "reading");
    onReadyChange(ready);
  }, [document, resolvedServerUrl, parameters.baseUrl, source, state.status, onReadyChange]);

  const setParameter = (key: string, value: string) => onParametersChange((previous) => ({ ...previous, [key]: value }));

  const switchSourceMode = (mode: SourceMode) => {
    if (mode === sourceMode) return;
    setSourceMode(mode);
    setUploadName("");
    onParametersChange((previous) => ({ ...previous, specUrl: "", specContent: "" }));
  };

  const upload = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setUploadName(file.name);
      setParameter("specContent", String(reader.result ?? ""));
    };
    reader.readAsText(file);
  };

  const demo = getAppType("openapi")?.demo;
  const selectedScheme = (parameters.securityScheme ?? "").trim() || (document ? defaultSecurityScheme(document) : NO_CREDENTIALS);

  const selectScheme = (key: string) => {
    credentialsRef.current[selectedScheme] = {
      token: parametersRef.current.token ?? "",
      username: parametersRef.current.username ?? "",
      password: parametersRef.current.password ?? "",
    };
    const restored = credentialsRef.current[key] ?? { token: "", username: "", password: "" };
    onParametersChange((previous) => ({ ...previous, securityScheme: key, ...restored }));
  };

  return (
    <div className="flex max-w-[640px] flex-col gap-6">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-foreground" htmlFor="openapi-source">
            OpenAPI document
          </label>
          <SegmentedControl aria-label="Document source">
            {(["url", "file", "paste"] as SourceMode[]).map((mode) => (
              <SegmentedControl.Button key={mode} selected={sourceMode === mode} disabled={readOnly} onClick={() => switchSourceMode(mode)}>
                {mode === "url" ? "URL" : mode === "file" ? "File" : "Paste"}
              </SegmentedControl.Button>
            ))}
          </SegmentedControl>
        </div>

        {sourceMode === "url" && (
          <VariableSuggestInput
            id="openapi-source"
            value={specUrl}
            onValueChange={(value) => setParameter("specUrl", value)}
            variables={variables}
            placeholder="https://example.com/openapi.json"
            disabled={readOnly}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                if (isAbsoluteHttpUrl(specUrl)) read();
              }
            }}
          />
        )}

        {sourceMode === "file" && (
          <div className="flex items-center gap-2">
            <label className={cn(buttonVariants({ variant: "outline" }), "cursor-pointer", readOnly && "pointer-events-none opacity-50")}>
              <FileIcon size={14} />
              {specContent.trim() ? "Change file" : "Choose file"}
              <input
                type="file"
                accept=".json,.yaml,.yml,application/json,application/yaml,text/yaml,text/plain"
                hidden
                disabled={readOnly}
                onChange={(event) => {
                  upload(event.target.files?.[0]);
                  event.target.value = "";
                }}
              />
            </label>
            <span className="text-xs text-muted-foreground">{uploadName || (specContent.trim() ? "Document loaded" : "No file chosen")}</span>
          </div>
        )}

        {sourceMode === "paste" && (
          <textarea
            id="openapi-source"
            value={specContent}
            onChange={(event) => setParameter("specContent", event.target.value)}
            disabled={readOnly}
            spellCheck={false}
            placeholder="Paste the OpenAPI document (JSON or YAML)"
            className="min-h-40 w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          />
        )}

        <SourceStatus
          state={state}
          parameters={parameters}
          readOnly={readOnly}
          demoLabel={demo?.label}
          onDemo={
            demo
              ? () => {
                  setSourceMode("url");
                  onParametersChange((previous) => ({ ...previous, ...demo.parameters, specContent: "" }));
                }
              : undefined
          }
          onCancel={() => {
            readIdRef.current++;
            setState({ status: "idle" });
          }}
          onRefresh={read}
          onUploadInstead={() => switchSourceMode("file")}
          onSpecHeaderChange={setParameter}
          onRetry={read}
        />
      </div>

      {document && (
        <>
          <div className="h-px bg-border" />

          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium text-foreground" htmlFor="openapi-name">
              Name
            </label>
            <Input
              id="openapi-name"
              value={name}
              disabled={readOnly}
              onChange={(event) => {
                nameTouchedRef.current = true;
                onNameChange(event.target.value);
              }}
            />
            {duplicateName ? (
              <p className="text-xs text-destructive">An app with this name already exists</p>
            ) : (
              <p className="text-xs text-muted-foreground">From the document's title. Rename if you'd rather.</p>
            )}
          </div>

          <ServerSection
            document={document}
            readOnly={readOnly}
            choice={serverChoice}
            onChoice={setServerChoice}
            variableValues={serverVariables}
            onVariableChange={(index, variable, value) =>
              setServerVariables((previous) => ({ ...previous, [index]: { ...previous[index], [variable]: value } }))
            }
            customUrl={customServerUrl}
            onCustomUrlChange={setCustomServerUrl}
            baseUrl={parameters.baseUrl ?? ""}
            onBaseUrlChange={(value) => setParameter("baseUrl", value)}
          />

          <AuthenticationSection
            document={document}
            readOnly={readOnly}
            selected={selectedScheme}
            onSelect={selectScheme}
            parameters={parameters}
            onParameterChange={setParameter}
          />
        </>
      )}
    </div>
  );
}

interface Credentials {
  token: string;
  username: string;
  password: string;
}

interface SourceStatusProps {
  state: ReadState;
  parameters: Record<string, string>;
  readOnly: boolean;
  demoLabel?: string;
  onDemo?: () => void;
  onCancel: () => void;
  onRefresh: () => void;
  onUploadInstead: () => void;
  onSpecHeaderChange: (key: string, value: string) => void;
  onRetry: () => void;
}

// SourceStatus is the one slot under the source field that carries every state:
// the caption, the read in progress, the document that was read, and each way
// reading it can fail. All of them name the next move.
function SourceStatus({
  state,
  parameters,
  readOnly,
  demoLabel,
  onDemo,
  onCancel,
  onRefresh,
  onUploadInstead,
  onSpecHeaderChange,
  onRetry,
}: SourceStatusProps) {
  if (state.status === "idle") {
    return (
      <div className="flex items-center gap-1.5">
        <p className="text-xs text-muted-foreground">Kaja reads it and fills in the rest.</p>
        {demoLabel && onDemo && !readOnly && (
          <>
            <span className="text-xs text-muted-foreground">·</span>
            <button type="button" onClick={onDemo} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
              <Sparkles size={11} />
              {demoLabel}
            </button>
          </>
        )}
      </div>
    );
  }

  if (state.status === "reading") {
    return (
      <div className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2">
        <Spinner size="sm" />
        <span className="text-sm text-muted-foreground">Reading the document…</span>
        <Button variant="ghost" size="sm" className="ml-auto" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    );
  }

  if (state.status === "read") {
    return <DocumentSummary document={state.document} readAt={state.readAt} onRefresh={onRefresh} />;
  }

  return (
    <ProblemBanner
      problem={state.problem}
      parameters={parameters}
      readOnly={readOnly}
      onUploadInstead={onUploadInstead}
      onSpecHeaderChange={onSpecHeaderChange}
      onRetry={onRetry}
    />
  );
}

function DocumentSummary({ document, readAt, onRefresh }: { document: OpenApiDocument; readAt: number; onRefresh: () => void }) {
  const missing: string[] = [];
  if (document.servers.length === 0) missing.push("servers");
  if (document.securitySchemes.length === 0) missing.push("securitySchemes");

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2">
        <div className="pt-0.5 text-emerald-600 dark:text-emerald-400">
          <CircleCheck size={15} />
        </div>
        <div className="flex flex-col gap-0.5">
          <p className="text-sm text-foreground">
            {document.title || "Untitled API"}{" "}
            <span className="text-muted-foreground">
              {document.version && `v${document.version} · `}OpenAPI {document.openapiVersion}
            </span>
          </p>
          <p className="text-xs text-muted-foreground">
            {count(document.operationCount, "operation")} · {count(document.tagCount, "tag")} ·{" "}
            {document.servers.length ? count(document.servers.length, "server") : "no servers"} ·{" "}
            {document.securitySchemes.length ? count(document.securitySchemes.length, "security scheme") : "no security schemes"}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-1 text-muted-foreground">
          <RelativeTime at={readAt} />
          <IconButton icon={RefreshCw} aria-label="Read the document again" variant="ghost" size="xs" onClick={onRefresh} />
        </div>
      </div>
      {missing.length > 0 && (
        <div className="flex items-start gap-2 rounded-md border border-border bg-card px-3 py-2">
          <div className="pt-0.5 text-muted-foreground">
            <Info size={15} />
          </div>
          <p className="text-xs leading-5 text-muted-foreground">
            The document declares{" "}
            {missing.map((field, index) => (
              <span key={field}>
                {index > 0 && " and "}no <span className="font-mono">{field}</span>
              </span>
            ))}
            , so Kaja can't prefill {missing.length > 1 ? "those" : "that"}. {missing.length > 1 ? "Both are" : "It is"} a plain field below
            {document.guessedBaseUrl ? ", with the base URL guessed from where the document was fetched" : ""}.
          </p>
        </div>
      )}
    </div>
  );
}

interface ProblemBannerProps {
  problem: OpenApiProblem;
  parameters: Record<string, string>;
  readOnly: boolean;
  onUploadInstead: () => void;
  onSpecHeaderChange: (key: string, value: string) => void;
  onRetry: () => void;
}

function ProblemBanner({ problem, parameters, readOnly, onUploadInstead, onSpecHeaderChange, onRetry }: ProblemBannerProps) {
  // The one case where a credential is needed before anything can be read. It is
  // asked for right here, and kept apart from the API's own credentials.
  if (problem.kind === OpenApiProblemKind.OPEN_API_PROBLEM_UNAUTHORIZED) {
    return (
      <div className="rounded-md border border-amber-500/40 bg-amber-500/10">
        <div className="flex items-start gap-2 px-3 py-2">
          <div className="pt-0.5 text-amber-600 dark:text-amber-400">
            <Lock size={15} />
          </div>
          <div className="flex flex-col gap-0.5">
            <p className="text-sm text-foreground">{problem.message}</p>
            <p className="text-xs text-muted-foreground">{problem.detail}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 border-t border-amber-500/40 px-3 py-2.5">
          <Input
            className="w-48"
            value={parameters.specHeaderName ?? ""}
            placeholder="Authorization"
            disabled={readOnly}
            onChange={(event) => onSpecHeaderChange("specHeaderName", event.target.value)}
          />
          <Input
            className="flex-1"
            value={parameters.specHeaderValue ?? ""}
            placeholder="Bearer …"
            disabled={readOnly}
            onChange={(event) => onSpecHeaderChange("specHeaderValue", event.target.value)}
          />
          <Button variant="secondary" size="sm" onClick={onRetry} disabled={readOnly}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  const warning = problem.kind === OpenApiProblemKind.OPEN_API_PROBLEM_SWAGGER2;
  const Icon: LucideIcon = warning ? TriangleAlert : problem.kind === OpenApiProblemKind.OPEN_API_PROBLEM_UNREACHABLE ? CircleAlert : CircleX;

  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-md border px-3 py-2",
        warning ? "border-amber-500/40 bg-amber-500/10" : "border-destructive/40 bg-destructive/10",
      )}
    >
      <div className={cn("pt-0.5", warning ? "text-amber-600 dark:text-amber-400" : "text-destructive")}>
        <Icon size={15} />
      </div>
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="text-sm text-foreground">{problem.message}</p>
        {problem.detail && (
          <p className={cn("break-words text-xs text-muted-foreground", problem.kind !== OpenApiProblemKind.OPEN_API_PROBLEM_HTML && "font-mono")}>
            {problem.detail}
          </p>
        )}
      </div>
      {problem.kind === OpenApiProblemKind.OPEN_API_PROBLEM_UNREACHABLE && !readOnly && (
        <Button variant="secondary" size="sm" className="ml-auto shrink-0" onClick={onUploadInstead}>
          Upload file
        </Button>
      )}
    </div>
  );
}

interface ServerSectionProps {
  document: OpenApiDocument;
  readOnly: boolean;
  choice: number | "custom";
  onChoice: (choice: number | "custom") => void;
  variableValues: Record<number, Record<string, string>>;
  onVariableChange: (index: number, variable: string, value: string) => void;
  customUrl: string;
  onCustomUrlChange: (url: string) => void;
  baseUrl: string;
  onBaseUrlChange: (url: string) => void;
}

// ServerSection adapts to what the document's servers list holds: nothing, one
// server, several, or one with {placeholders} to resolve. A list of one is not a
// choice, so it is stated rather than offered.
function ServerSection({
  document,
  readOnly,
  choice,
  onChoice,
  variableValues,
  onVariableChange,
  customUrl,
  onCustomUrlChange,
  baseUrl,
  onBaseUrlChange,
}: ServerSectionProps) {
  if (document.servers.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-1.5">
          <label className="text-sm font-medium text-foreground" htmlFor="openapi-base-url">
            Base URL
          </label>
          <span className="text-xs text-muted-foreground">Required</span>
        </div>
        <Input id="openapi-base-url" value={baseUrl} disabled={readOnly} onChange={(event) => onBaseUrlChange(event.target.value)} />
        <p className="text-xs text-muted-foreground">
          {document.guessedBaseUrl && baseUrl === document.guessedBaseUrl
            ? "Guessed from where the document was fetched. The document itself doesn't say."
            : "The document declares no servers, so requests need somewhere to go."}
        </p>
      </div>
    );
  }

  const single = document.servers.length === 1 && document.servers[0].variables.length === 0;
  if (single && choice !== "custom") {
    return (
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium text-foreground">Server</label>
        <div className="flex items-center gap-3 rounded-md border border-border bg-card px-3 py-2.5">
          <ServerIcon size={15} className="text-muted-foreground" />
          <span className="truncate font-mono text-sm text-foreground">{document.servers[0].url}</span>
          {!readOnly && (
            <Button variant="ghost" size="sm" className="ml-auto shrink-0" onClick={() => onChoice("custom")}>
              Change
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">The only server the document declares.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="text-sm font-medium text-foreground">Server</label>
      <p className="text-xs text-muted-foreground">Requests go here, with each operation's path appended.</p>
      <div className="flex flex-col gap-1.5 pt-0.5" role="radiogroup" aria-label="Server">
        {document.servers.map((server, index) => {
          const selected = choice === index;
          const values = variableValues[index] ?? {};
          return (
            <div key={`${server.url}-${index}`} className={cn("rounded-md border", selected ? "border-blue-500/50 bg-accent" : "border-border")}>
              <ChoiceRow selected={selected} disabled={readOnly} onSelect={() => onChoice(index)} icon={ServerIcon}>
                <span className={cn("truncate font-mono text-sm", selected ? "text-foreground" : "text-muted-foreground")}>{server.url}</span>
                {server.description && (
                  <span className="ml-auto shrink-0 rounded-sm bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">{server.description}</span>
                )}
              </ChoiceRow>
              {selected && server.variables.length > 0 && (
                <div className="flex flex-col gap-2.5 border-t border-border px-3 py-3">
                  {server.variables.map((variable) => (
                    <div key={variable.name} className="flex items-center gap-3">
                      <span className="w-[70px] shrink-0 font-mono text-xs text-muted-foreground">{variable.name}</span>
                      <div className="flex-1">
                        {variable.enumValues.length > 0 ? (
                          <Select
                            value={values[variable.name] ?? variable.defaultValue}
                            onValueChange={(value) => value != null && onVariableChange(index, variable.name, value as string)}
                            disabled={readOnly}
                          >
                            <SelectTrigger className="w-full">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {variable.enumValues.map((value) => (
                                <SelectItem key={value} value={value}>
                                  {value}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <Input
                            value={values[variable.name] ?? variable.defaultValue}
                            disabled={readOnly}
                            onChange={(event) => onVariableChange(index, variable.name, event.target.value)}
                          />
                        )}
                      </div>
                      <span className="w-[120px] shrink-0 text-xs text-muted-foreground">
                        {variable.enumValues.length > 0
                          ? `${variable.enumValues.length} allowed values`
                          : variable.defaultValue
                            ? `free text · default ${variable.defaultValue}`
                            : "free text"}
                      </span>
                    </div>
                  ))}
                  <div className="flex items-center gap-2 border-t border-border pt-2.5">
                    <ArrowRight size={13} className="text-muted-foreground" />
                    <span className="truncate font-mono text-xs text-foreground">{resolveServerUrl(server, values)}</span>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        <div className={cn("rounded-md border", choice === "custom" ? "border-blue-500/50 bg-accent" : "border-border")}>
          <ChoiceRow selected={choice === "custom"} disabled={readOnly} onSelect={() => onChoice("custom")} icon={Pencil}>
            <span className={cn("text-sm", choice === "custom" ? "text-foreground" : "text-muted-foreground")}>
              Somewhere else — a local mock, a staging host
            </span>
          </ChoiceRow>
          {choice === "custom" && (
            <div className="border-t border-border px-3 py-3">
              <Input value={customUrl} disabled={readOnly} onChange={(event) => onCustomUrlChange(event.target.value)} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface AuthenticationSectionProps {
  document: OpenApiDocument;
  readOnly: boolean;
  selected: string;
  onSelect: (key: string) => void;
  parameters: Record<string, string>;
  onParameterChange: (key: string, value: string) => void;
}

// AuthenticationSection is one row per security scheme the document declares, in
// coverage order, plus a row for sending nothing. Only the selected row asks for
// a credential, in the shape its scheme expects.
function AuthenticationSection({ document, readOnly, selected, onSelect, parameters, onParameterChange }: AuthenticationSectionProps) {
  if (document.securitySchemes.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium text-foreground" htmlFor="openapi-token">
          Authentication
        </label>
        <p className="text-xs text-muted-foreground">The document declares no security schemes. A token here is sent as a bearer token.</p>
        <Input
          id="openapi-token"
          type="password"
          value={parameters.token ?? ""}
          placeholder="Token, if the API needs one"
          disabled={readOnly}
          onChange={(event) => onParameterChange("token", event.target.value)}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="text-sm font-medium text-foreground">Authentication</label>
      <p className="text-xs text-muted-foreground">Read from the document's security schemes. Pick the one you hold a credential for.</p>
      <div className="flex flex-col gap-1.5 pt-0.5" role="radiogroup" aria-label="Authentication">
        {document.securitySchemes.map((scheme) => {
          const supported = scheme.type !== "mutualTLS";
          const isSelected = supported && selected === scheme.key;
          return (
            <div
              key={scheme.key}
              className={cn("rounded-md border", isSelected ? "border-blue-500/50 bg-accent" : "border-border", !supported && "opacity-60")}
            >
              <ChoiceRow selected={isSelected} disabled={readOnly || !supported} onSelect={() => onSelect(scheme.key)} icon={schemeIcon(scheme)}>
                <span className={cn("shrink-0 text-sm", isSelected ? "text-foreground" : "text-muted-foreground")}>{schemeLabel(scheme)}</span>
                <span className="truncate font-mono text-xs text-muted-foreground">{schemeIdentity(scheme)}</span>
                {!supported ? (
                  <span className="ml-auto shrink-0 rounded-sm bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">Not yet supported</span>
                ) : scheme.requiresOthers ? (
                  <span className="ml-auto shrink-0 rounded-sm bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">Needs another too</span>
                ) : (
                  document.perOperationSecurity && (
                    <span className="ml-auto shrink-0 rounded-sm bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                      {scheme.operationCount} of {document.operationCount} ops
                    </span>
                  )
                )}
              </ChoiceRow>
              {isSelected && <SchemeCredentials scheme={scheme} readOnly={readOnly} parameters={parameters} onParameterChange={onParameterChange} />}
            </div>
          );
        })}

        <div className={cn("rounded-md border", selected === NO_CREDENTIALS ? "border-blue-500/50 bg-accent" : "border-border")}>
          <ChoiceRow selected={selected === NO_CREDENTIALS} disabled={readOnly} onSelect={() => onSelect(NO_CREDENTIALS)}>
            <span className={cn("text-sm", selected === NO_CREDENTIALS ? "text-foreground" : "text-muted-foreground")}>Send no credentials</span>
          </ChoiceRow>
        </div>
      </div>
    </div>
  );
}

interface SchemeCredentialsProps {
  scheme: OpenApiSecurityScheme;
  readOnly: boolean;
  parameters: Record<string, string>;
  onParameterChange: (key: string, value: string) => void;
}

// SchemeCredentials is what the selected scheme asks for: one field for a key or
// a token, two for HTTP Basic.
function SchemeCredentials({ scheme, readOnly, parameters, onParameterChange }: SchemeCredentialsProps) {
  const basic = isBasicScheme(scheme);

  return (
    <div className="flex flex-col gap-1.5 border-t border-border px-3 py-3">
      {scheme.requiresOthers && (
        <div className="mb-1 flex items-center gap-2">
          <Info size={13} className="shrink-0 text-muted-foreground" />
          <p className="text-xs text-muted-foreground">
            The document asks for this scheme together with another one. Kaja sends this one; configure the rest as headers in Advanced.
          </p>
        </div>
      )}

      {basic ? (
        <div className="flex items-center gap-2">
          <Input
            className="flex-1"
            value={parameters.username ?? ""}
            placeholder="Username"
            disabled={readOnly}
            onChange={(event) => onParameterChange("username", event.target.value)}
          />
          <Input
            className="flex-1"
            type="password"
            value={parameters.password ?? ""}
            placeholder="Password"
            disabled={readOnly}
            onChange={(event) => onParameterChange("password", event.target.value)}
          />
        </div>
      ) : (
        <Input
          type="password"
          value={parameters.token ?? ""}
          placeholder={credentialPlaceholder(scheme)}
          disabled={readOnly}
          onChange={(event) => onParameterChange("token", event.target.value)}
        />
      )}

      {scheme.type === "openIdConnect" && scheme.openIdConnectUrl && (
        <div className="flex items-center gap-2">
          <LinkIcon size={13} className="shrink-0 text-muted-foreground" />
          <span className="truncate font-mono text-xs text-muted-foreground">{scheme.openIdConnectUrl}</span>
        </div>
      )}
      <p className={cn("text-xs text-muted-foreground", credentialNote(scheme).mono && "font-mono")}>{credentialNote(scheme).text}</p>
    </div>
  );
}

interface ChoiceRowProps {
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
  icon?: LucideIcon;
  children: React.ReactNode;
}

// ChoiceRow is one option in the server or authentication list: a radio, an
// optional icon, and whatever the option has to say about itself.
function ChoiceRow({ selected, disabled, onSelect, icon: Icon, children }: ChoiceRowProps) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      className="flex w-full items-center gap-3 px-3 py-2.5 text-left disabled:cursor-default"
    >
      {selected ? (
        <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-blue-500">
          <span className="h-2 w-2 rounded-full bg-blue-500" />
        </span>
      ) : (
        <span className="h-4 w-4 shrink-0 rounded-full border border-input" />
      )}
      {Icon && <Icon size={15} className="shrink-0 text-muted-foreground" />}
      {children}
    </button>
  );
}

function RelativeTime({ at }: { at: number }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => tick((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [at]);

  const seconds = Math.floor((Date.now() - at) / 1000);
  const label = seconds < 1 ? "just now" : seconds < 60 ? `${seconds}s ago` : `${Math.floor(seconds / 60)}m ago`;
  return <span className="text-xs">{label}</span>;
}

function count(value: number, noun: string): string {
  return `${value} ${noun}${value === 1 ? "" : "s"}`;
}

function schemeIcon(scheme: OpenApiSecurityScheme): LucideIcon {
  if (scheme.type === "oauth2" || scheme.type === "openIdConnect" || scheme.type === "mutualTLS") return Shield;
  if (scheme.type === "http" && scheme.scheme.toLowerCase() === "basic") return Lock;
  return Key;
}
