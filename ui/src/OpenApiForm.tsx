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
  ShieldCheck,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, buttonVariants } from "./components/button";
import { IconButton } from "./components/icon-button";
import { Input } from "./components/input";
import { SegmentedControl } from "./components/segmented-control";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./components/select";
import { AppNameField } from "./AppNameField";
import { ReadingRow } from "./InspectStatus";
import { KnownChip, KnownList } from "./KnownList";
import { KnownApi, knownApiFor, matchingApis } from "./knownApis";
import { ChoiceCard, ChoiceRow } from "./ChoiceRow";
import { VariableSuggestInput } from "./VariableSuggestInput";
import { buildApp, CustomFormProps } from "./appTypes";
import { cn } from "./cn";
import {
  NO_CREDENTIALS,
  credentialNote,
  credentialPlaceholder,
  defaultSecurityScheme,
  defaultVariableValues,
  deriveAppName,
  isBasicScheme,
  isUsableBaseUrl,
  matchServerUrl,
  resolveServerUrl,
  schemeIdentity,
  schemeLabel,
} from "./openApiDocument";
import { isReadableUrl, joinReading, remember, uniqueAppName } from "./appForms";
import { pluralCount } from "./plural";
import { InspectOpenApiResponse, OpenApiApp, OpenApiDocument, OpenApiProblem, OpenApiProblemKind, OpenApiSecurityScheme } from "./server/api";
import { getApiClient } from "./server/connection";
import { rpcErrorMessage } from "./rpcMessage";
import { SignInState, SignInStatus, followSignIn } from "./SignIn";

// The value itself lives in specUrl (URL) or specContent (file, paste); switching
// mode clears it but keeps everything the document filled in, since people often
// re-point at a local copy of the same API.
type SourceMode = "url" | "file" | "paste";

type ReadState =
  { status: "idle" } | { status: "reading" } | { status: "read"; document: OpenApiDocument; readAt: number } | { status: "problem"; problem: OpenApiProblem };

const READ_DEBOUNCE_MS = 600;
const PASTE_DEBOUNCE_MS = 400;

// Documents already read, so flipping between apps doesn't fetch and parse what
// hasn't changed. Only successful reads are remembered.
const inspected = new Map<string, { document: OpenApiDocument; readAt: number }>();

// inspectionKey includes the credentials, since a document behind a login can differ
// per token.
function inspectionKey(parameters: Record<string, string>): string {
  return JSON.stringify(["specUrl", "specContent", "specHeaderName", "specHeaderValue", "token", "username", "password"].map((key) => parameters[key] ?? ""));
}

// openApiApp is the app the form is describing right now, which is what both reading
// the document and signing in are asked about.
function openApiApp(parameters: Record<string, string>): OpenApiApp | undefined {
  const app = buildApp("", "openapi", parameters, {});
  return app.app.oneofKind === "openapi" ? app.app.openapi : undefined;
}

// withSignedIn is the document with one scheme's sign-in recorded, which is what a
// sign-in or a sign-out changes and all it changes: the document is not read again.
function withSignedIn(document: OpenApiDocument, key: string, signedIn: boolean): OpenApiDocument {
  return { ...document, securitySchemes: document.securitySchemes.map((scheme) => (scheme.key === key ? { ...scheme, signedIn } : scheme)) };
}

// Reads already on the wire, so two forms ask the server for the same document once.
const reading = new Map<string, Promise<InspectOpenApiResponse>>();

function inspect(key: string, openapi: OpenApiApp | undefined, fresh: boolean): Promise<InspectOpenApiResponse> {
  return joinReading(reading, key, () =>
    getApiClient()
      .inspectOpenApi({ openapi, fresh })
      .then(({ response }) => response),
  );
}

// OpenApiForm is the New/Edit form for an OpenAPI app. It asks for one thing -
// the document - and everything after it is a choice between things the document
// already declared.
export function OpenApiForm({
  name,
  onNameChange,
  duplicateName,
  takenNames,
  parameters,
  onParametersChange,
  variables,
  readOnly,
  onSurfaceChange,
  onReadyChange,
}: CustomFormProps) {
  const [sourceMode, setSourceMode] = useState<SourceMode>(() => ((parameters.specContent ?? "").trim() ? "paste" : "url"));
  const [state, setState] = useState<ReadState>({ status: "idle" });
  const [signIn, setSignIn] = useState<SignInState>({ status: "idle" });
  const [uploadName, setUploadName] = useState("");
  const [serverChoice, setServerChoice] = useState<number | "custom">(0);
  const [serverVariables, setServerVariables] = useState<Record<number, Record<string, string>>>({});
  const [customServerUrl, setCustomServerUrl] = useState("");

  const parametersRef = useRef(parameters);
  parametersRef.current = parameters;
  // Only the latest read may write to state; anything older is discarded.
  const readIdRef = useRef(0);
  // Whether the name is the user's rather than the one derived from the title. State,
  // not a ref, because the caption under the field reads it.
  const [nameTouched, setNameTouched] = useState(Boolean(name));
  // Typing is the only change that waits for a pause before reading.
  const typedRef = useRef(false);
  // Credentials typed for a scheme, kept while another scheme is selected so flipping
  // back and forth doesn't lose typing.
  const credentialsRef = useRef<Record<string, Credentials>>({});
  // Whether the field is offering the documents Kaja knows the address of.
  const [picker, setPicker] = useState(false);
  const [highlight, setHighlight] = useState(0);

  const specUrl = parameters.specUrl ?? "";
  const specContent = parameters.specContent ?? "";
  const source = sourceMode === "url" ? specUrl : specContent;
  const document = state.status === "read" ? state.document : undefined;
  const known = useMemo(() => knownApiFor(specUrl), [specUrl]);
  const offered = useMemo(() => matchingApis(specUrl), [specUrl]);
  const picking = picker && !readOnly && !known && offered.length > 0;

  const read = useCallback(async (options?: { fresh?: boolean }) => {
    const parameters = parametersRef.current;
    const key = inspectionKey(parameters);
    const readId = ++readIdRef.current;

    const cached = options?.fresh ? undefined : inspected.get(key);
    if (cached) {
      setState({ status: "read", document: cached.document, readAt: cached.readAt });
      return;
    }

    setState({ status: "reading" });
    try {
      const response = await inspect(key, openApiApp(parameters), Boolean(options?.fresh));
      if (readId !== readIdRef.current) return;
      if (response.document) {
        const readAt = Date.now() - response.document.ageSeconds * 1000;
        remember(inspected, key, { document: response.document, readAt });
        setState({ status: "read", document: response.document, readAt });
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
          detail: rpcErrorMessage(error),
        },
      });
    }
  }, []);

  const recordSignIn = useCallback((key: string, signedIn: boolean) => {
    const cacheKey = inspectionKey(parametersRef.current);
    const cached = inspected.get(cacheKey);
    if (cached) inspected.set(cacheKey, { ...cached, document: withSignedIn(cached.document, key, signedIn) });
    setState((previous) => (previous.status === "read" ? { ...previous, document: withSignedIn(previous.document, key, signedIn) } : previous));
  }, []);

  const authorize = useCallback(async () => {
    const parameters = parametersRef.current;
    const call = getApiClient().authorizeOpenApi({ openapi: openApiApp(parameters) });
    if (await followSignIn(call.responses, setSignIn)) recordSignIn(parameters.securityScheme ?? "", true);
  }, [recordSignIn]);

  const forget = useCallback(async () => {
    const parameters = parametersRef.current;
    try {
      await getApiClient().forgetOpenApiAuthorization({ openapi: openApiApp(parameters) });
    } catch {
      // A token kaja could not drop is one the next call fails with, which is where
      // that is worth saying.
    }
    setSignIn({ status: "idle" });
    recordSignIn(parameters.securityScheme ?? "", false);
  }, [recordSignIn]);

  // A sign-in that failed is about the document it was tried against.
  useEffect(() => setSignIn({ status: "idle" }), [source]);

  // Read once the source settles. A file, a known API, or the app this form was
  // opened on are already complete and read at once.
  useEffect(() => {
    const typed = typedRef.current;
    typedRef.current = false;

    if (!source.trim() || (sourceMode === "url" && !isReadableUrl(source))) {
      readIdRef.current++;
      setState({ status: "idle" });
      return;
    }
    if (!typed) {
      read();
      return;
    }
    const timer = setTimeout(() => read(), sourceMode === "paste" ? PASTE_DEBOUNCE_MS : READ_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [source, sourceMode, read]);

  useEffect(() => onSurfaceChange(document ? { count: document.operationCount } : undefined), [document, onSurfaceChange]);

  // Derive the name from the document's title until the user types one. A title is
  // written for a docs page, so what is offered is the part of it that names the API.
  useEffect(() => {
    if (!document || nameTouched) return;
    const derived = uniqueAppName(deriveAppName(document.title), takenNames);
    if (derived) onNameChange(derived);
  }, [document, nameTouched, takenNames, onNameChange]);

  // Restore the server and credentials the app was configured with, matching them
  // against what the document declares now. A choice that has vanished falls back rather
  // than silently pointing somewhere else.
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
      onParametersChange((previous) => ({ ...previous, securityScheme: defaultSecurityScheme(document, Boolean((previous.token ?? "").trim())) }));
    }
  }, [document, onParametersChange]);

  const resolvedServerUrl = useMemo(() => {
    if (!document || document.servers.length === 0) return (parameters.baseUrl ?? "").trim();
    if (serverChoice === "custom") return customServerUrl.trim();
    const server = document.servers[serverChoice];
    return server ? resolveServerUrl(server, serverVariables[serverChoice] ?? {}) : "";
  }, [document, serverChoice, serverVariables, customServerUrl, parameters.baseUrl]);

  // Requests go where the form says they go, so the choice is written out as the app's
  // base URL rather than re-derived from the document later.
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

  const pick = (chosen: KnownApi) => {
    setPicker(false);
    typedRef.current = false;
    onParametersChange((previous) => ({ ...previous, specUrl: chosen.specUrl, specContent: "" }));
  };

  const selectedScheme =
    (parameters.securityScheme ?? "").trim() || (document ? defaultSecurityScheme(document, Boolean((parameters.token ?? "").trim())) : NO_CREDENTIALS);

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
          <div className="relative">
            <VariableSuggestInput
              id="openapi-source"
              value={specUrl}
              onValueChange={(value) => {
                typedRef.current = true;
                setParameter("specUrl", value);
              }}
              variables={variables}
              placeholder="https://example.com/openapi.json"
              disabled={readOnly}
              className={known ? "pr-28" : undefined}
              trailingAction={known && <KnownChip entry={known} />}
              onFocus={() => setPicker(true)}
              onBlur={() => setPicker(false)}
              onKeyDown={(event) => {
                if (picking && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
                  event.preventDefault();
                  setHighlight((previous) => (previous + (event.key === "ArrowDown" ? 1 : offered.length - 1)) % offered.length);
                  return;
                }
                if (picking && event.key === "Escape") {
                  event.preventDefault();
                  setPicker(false);
                  return;
                }
                if (event.key !== "Enter") return;
                event.preventDefault();
                if (picking) pick(offered[highlight % offered.length]);
                else if (isReadableUrl(specUrl)) read();
              }}
            />
            {picking && (
              <KnownList
                heading="Known APIs"
                entries={offered.map((api) => ({ name: api.name, address: api.specUrl, mark: api.mark }))}
                query={specUrl}
                highlight={highlight % offered.length}
                onHighlight={setHighlight}
                onPick={(index) => pick(offered[index])}
                footer={
                  !specUrl.trim() || isReadableUrl(specUrl) ? (
                    <>
                      Or paste any document URL. <span className="font-mono">{"${VARIABLES}"}</span> work here too.
                    </>
                  ) : (
                    "Nothing typed here is a URL yet, so no document has been read."
                  )
                }
              />
            )}
          </div>
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
            onChange={(event) => {
              typedRef.current = true;
              setParameter("specContent", event.target.value);
            }}
            disabled={readOnly}
            spellCheck={false}
            placeholder="Paste the OpenAPI document (JSON or YAML)"
            className="min-h-40 w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          />
        )}

        <SourceStatus
          state={state}
          parameters={parameters}
          variables={variables}
          readOnly={readOnly}
          onCancel={() => {
            readIdRef.current++;
            setState({ status: "idle" });
          }}
          onRefresh={() => read({ fresh: true })}
          onUploadInstead={() => switchSourceMode("file")}
          onSpecHeaderChange={setParameter}
          onRetry={() => read({ fresh: true })}
        />
      </div>

      {document && (
        <>
          <div className="h-px bg-border" />

          <AppNameField
            id="openapi-name"
            name={name}
            onNameChange={(value) => {
              setNameTouched(true);
              onNameChange(value);
            }}
            duplicate={duplicateName}
            readOnly={readOnly}
            caption={nameTouched ? undefined : "From the document's title."}
          />

          <ServerSection
            document={document}
            variables={variables}
            readOnly={readOnly}
            choice={serverChoice}
            onChoice={(choice) => {
              setServerChoice(choice);
            }}
            variableValues={serverVariables}
            onVariableChange={(index, variable, value) => {
              setServerVariables((previous) => ({ ...previous, [index]: { ...previous[index], [variable]: value } }));
            }}
            customUrl={customServerUrl}
            onCustomUrlChange={setCustomServerUrl}
            baseUrl={parameters.baseUrl ?? ""}
            onBaseUrlChange={(value) => setParameter("baseUrl", value)}
          />

          <AuthenticationSection
            document={document}
            variables={variables}
            readOnly={readOnly}
            selected={selectedScheme}
            onSelect={selectScheme}
            parameters={parameters}
            onParameterChange={setParameter}
            signIn={signIn}
            onSignIn={authorize}
            onSignOut={forget}
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
  variables: { [key: string]: string };
  readOnly: boolean;
  onCancel: () => void;
  onRefresh: () => void;
  onUploadInstead: () => void;
  onSpecHeaderChange: (key: string, value: string) => void;
  onRetry: () => void;
}

// SourceStatus is the one slot under the source field carrying every state: the
// caption, the read in progress, the document that was read, and each way it can fail.
function SourceStatus({ state, parameters, variables, readOnly, onCancel, onRefresh, onUploadInstead, onSpecHeaderChange, onRetry }: SourceStatusProps) {
  if (state.status === "idle") {
    return <p className="text-xs text-muted-foreground">Kaja reads it and fills in the rest.</p>;
  }

  if (state.status === "reading") {
    return <ReadingRow label="Reading the document…" onCancel={onCancel} />;
  }

  if (state.status === "read") {
    return <DocumentSummary document={state.document} readAt={state.readAt} onRefresh={onRefresh} />;
  }

  return (
    <ProblemBanner
      problem={state.problem}
      parameters={parameters}
      variables={variables}
      readOnly={readOnly}
      onUploadInstead={onUploadInstead}
      onSpecHeaderChange={onSpecHeaderChange}
      onRetry={onRetry}
    />
  );
}

function DocumentSummary({ document, readAt, onRefresh }: { document: OpenApiDocument; readAt: number; onRefresh: () => void }) {
  // A scheme Kaja supplied is one the document left out, which is still worth saying
  // the document left out: the rows below are Kaja's, not the API's.
  const declared = document.securitySchemes.filter((scheme) => !scheme.supplied).length;
  const supplied = document.securitySchemes.length - declared;
  const missing: string[] = [];
  if (document.servers.length === 0) missing.push("servers");
  if (declared === 0 && supplied === 0) missing.push("securitySchemes");

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
            {pluralCount(document.operationCount, "operation")} · {pluralCount(document.tagCount, "tag")} ·{" "}
            {document.servers.length ? pluralCount(document.servers.length, "server") : "no servers"} ·{" "}
            {declared ? pluralCount(declared, "security scheme") : "no security schemes"}
            {supplied > 0 && ` · ${pluralCount(supplied, "scheme")} from Kaja`}
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
  variables: { [key: string]: string };
  readOnly: boolean;
  onUploadInstead: () => void;
  onSpecHeaderChange: (key: string, value: string) => void;
  onRetry: () => void;
}

function ProblemBanner({ problem, parameters, variables, readOnly, onUploadInstead, onSpecHeaderChange, onRetry }: ProblemBannerProps) {
  // The one case where a credential is needed before anything can be read. It is asked
  // for right here, and kept apart from the API's own credentials.
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
          <div className="flex-1">
            <VariableSuggestInput
              value={parameters.specHeaderValue ?? ""}
              onValueChange={(value) => onSpecHeaderChange("specHeaderValue", value)}
              variables={variables}
              placeholder="Bearer …"
              disabled={readOnly}
            />
          </div>
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
  variables: { [key: string]: string };
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

// ServerSection adapts to what the document's servers list holds. A list of one is
// not a choice, so it is stated rather than offered.
function ServerSection({
  document,
  variables,
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
        <VariableSuggestInput id="openapi-base-url" value={baseUrl} onValueChange={onBaseUrlChange} variables={variables} disabled={readOnly} />
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
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="text-sm font-medium text-foreground">Server</label>
      <div className="flex flex-col gap-1.5 pt-0.5" role="radiogroup" aria-label="Server">
        {document.servers.map((server, index) => {
          const selected = choice === index;
          const values = variableValues[index] ?? {};
          return (
            <ChoiceCard key={`${server.url}-${index}`} selected={selected}>
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
                          <VariableSuggestInput
                            value={values[variable.name] ?? variable.defaultValue}
                            onValueChange={(value) => onVariableChange(index, variable.name, value)}
                            variables={variables}
                            disabled={readOnly}
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
            </ChoiceCard>
          );
        })}

        <ChoiceCard selected={choice === "custom"}>
          <ChoiceRow selected={choice === "custom"} disabled={readOnly} onSelect={() => onChoice("custom")} icon={Pencil}>
            <span className={cn("text-sm", choice === "custom" ? "text-foreground" : "text-muted-foreground")}>
              Somewhere else: a local mock, a staging host
            </span>
          </ChoiceRow>
          {choice === "custom" && (
            <div className="border-t border-border px-3 py-3">
              <VariableSuggestInput value={customUrl} onValueChange={onCustomUrlChange} variables={variables} disabled={readOnly} />
            </div>
          )}
        </ChoiceCard>
      </div>
    </div>
  );
}

interface AuthenticationSectionProps {
  document: OpenApiDocument;
  variables: { [key: string]: string };
  readOnly: boolean;
  selected: string;
  onSelect: (key: string) => void;
  parameters: Record<string, string>;
  onParameterChange: (key: string, value: string) => void;
  signIn: SignInState;
  onSignIn: () => void;
  onSignOut: () => void;
}

// One row per security scheme the document declares, in coverage order, plus a row
// for sending nothing.
function AuthenticationSection({
  document,
  variables,
  readOnly,
  selected,
  onSelect,
  parameters,
  onParameterChange,
  signIn,
  onSignIn,
  onSignOut,
}: AuthenticationSectionProps) {
  if (document.securitySchemes.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium text-foreground" htmlFor="openapi-token">
          Authentication
        </label>
        <p className="text-xs text-muted-foreground">The document declares no security schemes. A token here is sent as a bearer token.</p>
        <VariableSuggestInput
          id="openapi-token"
          value={parameters.token ?? ""}
          onValueChange={(value) => onParameterChange("token", value)}
          variables={variables}
          placeholder="Token, if the API needs one"
          disabled={readOnly}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="text-sm font-medium text-foreground">Authentication</label>
      <div className="flex flex-col gap-1.5 pt-0.5" role="radiogroup" aria-label="Authentication">
        {document.securitySchemes.map((scheme) => {
          const supported = scheme.type !== "mutualTLS";
          const isSelected = supported && selected === scheme.key;
          return (
            <ChoiceCard key={scheme.key} selected={isSelected} className={cn(!supported && "opacity-60")}>
              <ChoiceRow selected={isSelected} disabled={readOnly || !supported} onSelect={() => onSelect(scheme.key)} icon={schemeIcon(scheme)}>
                <span className={cn("shrink-0 text-sm", isSelected ? "text-foreground" : "text-muted-foreground")}>{schemeLabel(scheme)}</span>
                {scheme.signIn ? (
                  <span className="truncate text-xs text-muted-foreground">Kaja gets the token and keeps it renewed</span>
                ) : (
                  <span className="truncate font-mono text-xs text-muted-foreground">{schemeIdentity(scheme)}</span>
                )}
                {scheme.signIn ? (
                  <span className="ml-auto shrink-0 rounded-sm bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">nothing to paste</span>
                ) : !supported ? (
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
              {isSelected && scheme.signIn && (
                <div className="flex flex-col gap-2 border-t border-border px-3 py-3">
                  {/* The verbs go where the workspace can't be written, as in the MCP form. */}
                  {!readOnly && <SignInStatus state={signIn} signedIn={scheme.signedIn} onSignIn={onSignIn} onSignOut={onSignOut} />}
                  {scheme.signedIn && <p className="text-xs text-muted-foreground">Signed in. Kaja sends the token with every call.</p>}
                </div>
              )}
              {isSelected && !scheme.signIn && (
                <SchemeCredentials scheme={scheme} variables={variables} readOnly={readOnly} parameters={parameters} onParameterChange={onParameterChange} />
              )}
            </ChoiceCard>
          );
        })}

        <ChoiceCard selected={selected === NO_CREDENTIALS}>
          <ChoiceRow selected={selected === NO_CREDENTIALS} disabled={readOnly} onSelect={() => onSelect(NO_CREDENTIALS)}>
            <span className={cn("text-sm", selected === NO_CREDENTIALS ? "text-foreground" : "text-muted-foreground")}>Send no credentials</span>
          </ChoiceRow>
        </ChoiceCard>
      </div>
    </div>
  );
}

interface SchemeCredentialsProps {
  scheme: OpenApiSecurityScheme;
  variables: { [key: string]: string };
  readOnly: boolean;
  parameters: Record<string, string>;
  onParameterChange: (key: string, value: string) => void;
}

// Each field takes a ${NAME} variable, so a credential can name where it is held
// instead of being written into kaja.json.
function SchemeCredentials({ scheme, variables, readOnly, parameters, onParameterChange }: SchemeCredentialsProps) {
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
          <div className="flex-1">
            <VariableSuggestInput
              value={parameters.username ?? ""}
              onValueChange={(value) => onParameterChange("username", value)}
              variables={variables}
              placeholder="Username"
              disabled={readOnly}
            />
          </div>
          <div className="flex-1">
            <VariableSuggestInput
              value={parameters.password ?? ""}
              onValueChange={(value) => onParameterChange("password", value)}
              variables={variables}
              placeholder="Password"
              disabled={readOnly}
            />
          </div>
        </div>
      ) : (
        <VariableSuggestInput
          value={parameters.token ?? ""}
          onValueChange={(value) => onParameterChange("token", value)}
          variables={variables}
          placeholder={credentialPlaceholder(scheme)}
          disabled={readOnly}
        />
      )}

      {scheme.type === "openIdConnect" && scheme.openIdConnectUrl && (
        <div className="flex items-center gap-2">
          <LinkIcon size={13} className="shrink-0 text-muted-foreground" />
          <span className="truncate font-mono text-xs text-muted-foreground">{scheme.openIdConnectUrl}</span>
        </div>
      )}
      {credentialNote(scheme).text && (
        <p className={cn("text-xs text-muted-foreground", credentialNote(scheme).mono && "font-mono")}>{credentialNote(scheme).text}</p>
      )}
    </div>
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

function schemeIcon(scheme: OpenApiSecurityScheme): LucideIcon {
  if (scheme.signIn) return ShieldCheck;
  if (scheme.type === "oauth2" || scheme.type === "openIdConnect" || scheme.type === "mutualTLS") return Shield;
  if (scheme.type === "http" && scheme.scheme.toLowerCase() === "basic") return Lock;
  return Key;
}
