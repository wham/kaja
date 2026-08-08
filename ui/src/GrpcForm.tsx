import {
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CircleX,
  Folder,
  FileIcon,
  Info,
  Key,
  Lock,
  LockOpen,
  RefreshCw,
  Server as ServerIcon,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  Unplug,
  Waypoints,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "./components/button";
import { Checkbox } from "./components/checkbox";
import { IconButton } from "./components/icon-button";
import { SegmentedControl } from "./components/segmented-control";
import { Spinner } from "./components/spinner";
import { AppNameField } from "./AppNameField";
import { ChoiceCard, ChoiceRow } from "./ChoiceRow";
import { VariableSuggestInput } from "./VariableSuggestInput";
import { AppSurface, buildApp, getAppType } from "./appTypes";
import { cn } from "./cn";
import {
  AUTH_APIKEY,
  AUTH_BASIC,
  AUTH_BEARER,
  AUTH_NONE,
  DEFAULT_API_KEY_NAME,
  SOURCE_PROTO_DIR,
  SOURCE_REFLECTION,
  TLS_AUTO,
  TLS_OFF,
  TLS_ON,
  authNote,
  authSchemes,
  count,
  deriveAppName,
  isDialableTarget,
  nameFromAddress,
  streamingMethods,
  tlsFromServer,
  uniqueAppName,
} from "./grpcServer";
import { GrpcApp, GrpcProblem, GrpcProblemKind, GrpcServer, InspectGrpcResponse } from "./server/api";
import { getApiClient } from "./server/connection";
import { OpenDirectoryDialog, OpenFileDialog } from "./wailsjs/go/main/App";
import { isWailsEnvironment } from "./wails";

// Where the service definitions come from. The server describes itself, or a
// directory of .proto files does. It is the only structural choice in the form,
// and every other question is the same either way.
type SurfaceMode = "reflection" | "protoDir";

type ReadState = { status: "idle" } | { status: "reading" } | { status: "read"; server: GrpcServer } | { status: "problem"; problem: GrpcProblem };

const READ_DEBOUNCE_MS = 600;

// Surfaces already read, so flipping between apps in the sidebar doesn't reflect
// a server that hasn't changed. The refresh control reads past it. Only
// successful reads are remembered - a server that was down should be tried again.
const inspected = new Map<string, GrpcServer>();
const INSPECTED_LIMIT = 20;

// inspectionKey is what the surface depends on: the address, where the
// definitions come from, and how the connection is made. Credentials are sent
// with the read but are not part of the key - a token is typed a character at a
// time, and each character is not worth a round trip to a server.
function inspectionKey(parameters: Record<string, string>): string {
  return JSON.stringify(
    ["url", "protoDir", "reflection", "tls", "insecureSkipVerify", "caFile", "clientCertFile", "clientKeyFile"].map((key) => parameters[key] ?? ""),
  );
}

// Reads already on the wire, so two forms - or one form mounted twice - ask the
// server the same question once.
const reading = new Map<string, Promise<InspectGrpcResponse>>();

function inspect(key: string, grpc: GrpcApp | undefined): Promise<InspectGrpcResponse> {
  const pending = reading.get(key);
  if (pending) return pending;
  const started = getApiClient()
    .inspectGrpc({ grpc })
    .then(({ response }) => response)
    .finally(() => reading.delete(key));
  reading.set(key, started);
  return started;
}

function remember(key: string, server: GrpcServer) {
  inspected.delete(key);
  inspected.set(key, server);
  for (const oldest of inspected.keys()) {
    if (inspected.size <= INSPECTED_LIMIT) break;
    inspected.delete(oldest);
  }
}

interface GrpcFormProps {
  name: string;
  onNameChange: (name: string) => void;
  duplicateName: boolean;
  // Names already in use, so a derived one doesn't land on a collision the user
  // has to resolve by hand.
  takenNames: string[];
  parameters: Record<string, string>;
  onParametersChange: (update: (previous: Record<string, string>) => Record<string, string>) => void;
  variables: { [key: string]: string };
  readOnly: boolean;
  // What the form last read, for the receipt in the footer.
  onSurfaceChange: (surface: AppSurface | undefined) => void;
  // Whether the app can be created from what the form holds.
  onReadyChange: (ready: boolean) => void;
}

// GrpcForm is the New/Edit form for a gRPC app. It asks for one thing - where
// the server is - and everything after it is a choice about a server that has
// already answered.
export function GrpcForm({
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
}: GrpcFormProps) {
  const [surfaceMode, setSurfaceMode] = useState<SurfaceMode>(() =>
    parameters.reflection === "true" || !(parameters.protoDir ?? "").trim() ? "reflection" : "protoDir",
  );
  const [state, setState] = useState<ReadState>({ status: "idle" });
  const [changingTransport, setChangingTransport] = useState(false);
  const [certificatesOpen, setCertificatesOpen] = useState(
    () => parameters.insecureSkipVerify === "true" || Boolean((parameters.caFile ?? "").trim() || (parameters.clientCertFile ?? "").trim()),
  );

  const parametersRef = useRef(parameters);
  parametersRef.current = parameters;
  // Only the latest read may write to state; anything older is discarded.
  const readIdRef = useRef(0);
  // Whether the name is the user's rather than the one derived from the address.
  const [nameTouched, setNameTouched] = useState(Boolean(name));
  // Whether the source changed because the user typed into it, which is the only
  // change that waits for a pause before reading.
  const typedRef = useRef(false);

  const url = parameters.url ?? "";
  const protoDir = parameters.protoDir ?? "";
  const server = state.status === "read" ? state.server : undefined;
  const problem = state.status === "problem" ? state.problem : undefined;
  const source = inspectionKey(parameters);

  const read = useCallback(async (options?: { fresh?: boolean }) => {
    const parameters = parametersRef.current;
    const key = inspectionKey(parameters);
    const readId = ++readIdRef.current;

    const cached = options?.fresh ? undefined : inspected.get(key);
    if (cached) {
      setState({ status: "read", server: cached });
      return;
    }

    setState({ status: "reading" });
    try {
      const app = buildApp("", "grpc", parameters, {});
      const grpc = app.app.oneofKind === "grpc" ? app.app.grpc : undefined;
      const response = await inspect(key, grpc);
      if (readId !== readIdRef.current) return;
      if (response.server) {
        remember(key, response.server);
        setState({ status: "read", server: response.server });
      } else {
        setState({
          status: "problem",
          problem: response.problem ?? { kind: GrpcProblemKind.GRPC_PROBLEM_UNKNOWN, message: "Couldn't read the server", detail: "" },
        });
      }
    } catch (error) {
      if (readId !== readIdRef.current) return;
      setState({
        status: "problem",
        problem: {
          kind: GrpcProblemKind.GRPC_PROBLEM_UNKNOWN,
          message: "Couldn't read the server",
          detail: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }, []);

  // The control above the address and the parameter under it are the same
  // choice, so the parameter follows the control rather than being set alongside
  // it - a new app opens on reflection, and says so in its configuration.
  useEffect(() => {
    if (readOnly) return;
    const wanted = surfaceMode === "reflection" ? "true" : "";
    onParametersChange((previous) => ((previous.reflection ?? "") === wanted ? previous : { ...previous, reflection: wanted }));
  }, [surfaceMode, readOnly, onParametersChange]);

  // Read once the source settles. Typing is the only change that waits: the demo
  // link, a picked folder, or the app this form was opened on are already
  // complete and read at once.
  useEffect(() => {
    const typed = typedRef.current;
    typedRef.current = false;

    const ready = surfaceMode === "reflection" ? isDialableTarget(parametersRef.current.url ?? "") : Boolean((parametersRef.current.protoDir ?? "").trim());
    if (!ready) {
      readIdRef.current++;
      setState({ status: "idle" });
      return;
    }
    if (!typed) {
      read();
      return;
    }
    const timer = setTimeout(() => read(), READ_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [source, surfaceMode, read]);

  useEffect(() => onSurfaceChange(server ? { count: server.methodCount } : undefined), [server, onSurfaceChange]);

  // Derive the name from the address until the user types one. The name is the
  // folder every generated import starts with, so what is offered is the part of
  // the address that identifies the API rather than the machine.
  useEffect(() => {
    if (!server || nameTouched) return;
    const derived = uniqueAppName(
      deriveAppName(
        parametersRef.current.url ?? "",
        server.services.map((service) => service.name),
      ),
      takenNames,
    );
    if (derived) onNameChange(derived);
  }, [server, nameTouched, takenNames, onNameChange]);

  // The transport is settled by what answered, so the app says outright what it
  // does rather than leaving it to be re-derived from the address. A choice the
  // user has already made is never written over.
  useEffect(() => {
    if (readOnly || !server || !server.reachable) return;
    const settled = tlsFromServer(server);
    onParametersChange((previous) => ((previous.tls ?? "") === "" ? { ...previous, tls: settled } : previous));
  }, [server, readOnly, onParametersChange]);

  // A server that asks for a credential before it will say anything is asking
  // for the one nearly every gRPC service asks for.
  useEffect(() => {
    if (readOnly || problem?.kind !== GrpcProblemKind.GRPC_PROBLEM_UNAUTHENTICATED) return;
    onParametersChange((previous) => ((previous.auth ?? "") === "" ? { ...previous, auth: AUTH_BEARER } : previous));
  }, [problem, readOnly, onParametersChange]);

  useEffect(() => {
    onReadyChange(Boolean(server) && isDialableTarget(parametersRef.current.url ?? ""));
  }, [server, url, onReadyChange]);

  const setParameter = (key: string, value: string) => onParametersChange((previous) => ({ ...previous, [key]: value }));

  const switchSurfaceMode = (mode: SurfaceMode) => {
    if (mode === surfaceMode) return;
    setSurfaceMode(mode);
    onParametersChange((previous) => ({ ...previous, protoDir: "" }));
  };

  const demo = getAppType("grpc")?.demo;
  const auth = (parameters.auth ?? "").trim() || AUTH_NONE;
  const transport = (parameters.tls ?? "").trim();

  // A credential the server wants, or the transport it wants, is asked for
  // before anything has been read - it is the whole reason nothing has been.
  const showTransport = Boolean(server) || problem?.kind === GrpcProblemKind.GRPC_PROBLEM_TLS;
  const showAuthentication =
    Boolean(server) || problem?.kind === GrpcProblemKind.GRPC_PROBLEM_UNAUTHENTICATED || problem?.kind === GrpcProblemKind.GRPC_PROBLEM_PERMISSION_DENIED;

  return (
    <div className="flex max-w-[640px] flex-col gap-6">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-foreground" htmlFor="grpc-url">
            gRPC server
          </label>
          <SegmentedControl aria-label="Service definitions">
            <SegmentedControl.Button selected={surfaceMode === "reflection"} disabled={readOnly} onClick={() => switchSurfaceMode("reflection")}>
              Reflection
            </SegmentedControl.Button>
            <SegmentedControl.Button selected={surfaceMode === "protoDir"} disabled={readOnly} onClick={() => switchSurfaceMode("protoDir")}>
              Proto files
            </SegmentedControl.Button>
          </SegmentedControl>
        </div>

        <VariableSuggestInput
          id="grpc-url"
          value={url}
          onValueChange={(value) => {
            typedRef.current = true;
            setParameter("url", value);
          }}
          variables={variables}
          placeholder="dns:example.com:443"
          disabled={readOnly}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              read({ fresh: true });
            }
          }}
        />

        {surfaceMode === "protoDir" && (
          <PathField
            value={protoDir}
            onValueChange={(value) => {
              typedRef.current = true;
              setParameter("protoDir", value);
            }}
            onPick={OpenDirectoryDialog}
            icon={Folder}
            label="Select the proto directory"
            variables={variables}
            placeholder="Folder of .proto files"
            readOnly={readOnly}
          />
        )}

        <SourceStatus
          state={state}
          mode={surfaceMode}
          readOnly={readOnly}
          demoLabel={demo?.label}
          onDemo={
            demo
              ? () => {
                  setSurfaceMode("reflection");
                  onParametersChange((previous) => ({ ...previous, ...demo.parameters, protoDir: "" }));
                }
              : undefined
          }
          onCancel={() => {
            readIdRef.current++;
            setState({ status: "idle" });
          }}
          onRetry={() => read({ fresh: true })}
          onSwitchMode={switchSurfaceMode}
        />
      </div>

      {(server || showTransport || showAuthentication) && (
        <>
          <div className="h-px bg-border" />

          {server && (
            <AppNameField
              id="grpc-name"
              name={name}
              onNameChange={(value) => {
                setNameTouched(true);
                onNameChange(value);
              }}
              duplicate={duplicateName}
              readOnly={readOnly}
              caption={nameTouched ? undefined : `From the ${nameFromAddress(url) ? "address" : "service it serves"}. Rename if you'd rather.`}
            />
          )}

          {showTransport && (
            <TransportSection
              server={server}
              transport={transport}
              onTransportChange={(value) => setParameter("tls", value)}
              changing={changingTransport || !server}
              onChange={() => setChangingTransport(true)}
              parameters={parameters}
              onParameterChange={setParameter}
              variables={variables}
              readOnly={readOnly}
              certificatesOpen={certificatesOpen}
              onCertificatesOpenChange={setCertificatesOpen}
            />
          )}

          {showAuthentication && (
            <AuthenticationSection
              selected={auth}
              onSelect={(value) => setParameter("auth", value)}
              parameters={parameters}
              onParameterChange={setParameter}
              variables={variables}
              readOnly={readOnly}
            />
          )}
        </>
      )}
    </div>
  );
}

interface SourceStatusProps {
  state: ReadState;
  mode: SurfaceMode;
  readOnly: boolean;
  demoLabel?: string;
  onDemo?: () => void;
  onCancel: () => void;
  onRetry: () => void;
  onSwitchMode: (mode: SurfaceMode) => void;
}

// SourceStatus is the one slot under the address that carries every state: the
// caption, the read in progress, the server that answered, and each way reaching
// it can fail. All of them name the next move.
function SourceStatus({ state, mode, readOnly, demoLabel, onDemo, onCancel, onRetry, onSwitchMode }: SourceStatusProps) {
  if (state.status === "idle") {
    return (
      <div className="flex items-center gap-1.5">
        <p className="text-xs text-muted-foreground">
          {mode === "reflection"
            ? "Kaja asks the server what it serves and fills in the rest."
            : "Kaja reads every .proto file in the folder and fills in the rest."}
        </p>
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
        <span className="text-sm text-muted-foreground">
          {mode === "reflection" ? "Reaching the server…" : "Reading the proto files, and checking the server…"}
        </span>
        <Button variant="ghost" size="sm" className="ml-auto" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    );
  }

  if (state.status === "read") {
    return <ServerSummary server={state.server} onRefresh={onRetry} />;
  }

  return <ProblemBanner problem={state.problem} mode={mode} readOnly={readOnly} onRetry={onRetry} onSwitchMode={onSwitchMode} />;
}

function ServerSummary({ server, onRefresh }: { server: GrpcServer; onRefresh: () => void }) {
  const streaming = streamingMethods(server);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2">
        <div className="pt-0.5 text-emerald-600 dark:text-emerald-400">
          <CircleCheck size={15} />
        </div>
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="text-sm text-foreground">
            {count(server.services.length, "service")} · {count(server.methodCount, "method")}{" "}
            <span className="text-muted-foreground">
              {server.source === SOURCE_REFLECTION ? `from reflection ${server.reflectionVersion}` : `from ${count(server.fileCount, "proto file")}`}
            </span>
          </p>
          <p className="truncate text-xs text-muted-foreground">{server.services.map((service) => service.name).join(" · ")}</p>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1 text-muted-foreground">
          <IconButton icon={RefreshCw} aria-label="Read the server again" variant="ghost" size="xs" onClick={onRefresh} />
        </div>
      </div>
      {/* Only where it is true. The desktop carries streaming calls fine, so there
          the note would be describing another build of an app nobody said there
          was two of. */}
      {streaming > 0 && !isWailsEnvironment() && (
        <div className="flex items-start gap-2 rounded-md border border-border bg-card px-3 py-2">
          <div className="pt-0.5 text-muted-foreground">
            <Info size={15} />
          </div>
          <p className="text-xs leading-5 text-muted-foreground">
            {count(streaming, "method")} stream. gRPC-Web can't carry a stream, so they are listed but can't be called.
          </p>
        </div>
      )}
      {server.source === SOURCE_PROTO_DIR && !server.reachable && (
        <div className="flex items-start gap-2 rounded-md border border-border bg-card px-3 py-2">
          <div className="pt-0.5 text-muted-foreground">
            <Unplug size={15} />
          </div>
          <p className="text-xs leading-5 text-muted-foreground">
            The proto files say what the app exposes; the server at that address didn't answer, so the transport below is Kaja's to guess until it does.
          </p>
        </div>
      )}
    </div>
  );
}

interface ProblemBannerProps {
  problem: GrpcProblem;
  mode: SurfaceMode;
  readOnly: boolean;
  onRetry: () => void;
  onSwitchMode: (mode: SurfaceMode) => void;
}

function ProblemBanner({ problem, mode, readOnly, onRetry, onSwitchMode }: ProblemBannerProps) {
  // A server that reflects nothing, doesn't reflect at all, or isn't there yet is
  // answered by the other source rather than by trying again. The failures with a
  // fix of their own - the transport, the address, a credential, a proto file
  // that doesn't compile - are not.
  const otherSource = !(
    problem.kind === GrpcProblemKind.GRPC_PROBLEM_TLS ||
    problem.kind === GrpcProblemKind.GRPC_PROBLEM_TARGET ||
    problem.kind === GrpcProblemKind.GRPC_PROBLEM_PROTO_INVALID ||
    problem.kind === GrpcProblemKind.GRPC_PROBLEM_UNAUTHENTICATED ||
    problem.kind === GrpcProblemKind.GRPC_PROBLEM_PERMISSION_DENIED
  );

  const warning = problem.kind === GrpcProblemKind.GRPC_PROBLEM_NO_REFLECTION || problem.kind === GrpcProblemKind.GRPC_PROBLEM_NO_SERVICES;
  const Icon: LucideIcon = warning ? TriangleAlert : problem.kind === GrpcProblemKind.GRPC_PROBLEM_TLS ? CircleAlert : CircleX;

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
        {problem.detail && <p className="break-words font-mono text-xs text-muted-foreground">{problem.detail}</p>}
      </div>
      {!readOnly && (
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {otherSource && (
            <Button variant="secondary" size="sm" onClick={() => onSwitchMode(mode === "reflection" ? "protoDir" : "reflection")}>
              {mode === "reflection" ? "Use proto files" : "Use reflection"}
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={onRetry}>
            Retry
          </Button>
        </div>
      )}
    </div>
  );
}

interface TransportSectionProps {
  server: GrpcServer | undefined;
  transport: string;
  onTransportChange: (value: string) => void;
  changing: boolean;
  onChange: () => void;
  parameters: Record<string, string>;
  onParameterChange: (key: string, value: string) => void;
  variables: { [key: string]: string };
  readOnly: boolean;
  certificatesOpen: boolean;
  onCertificatesOpenChange: (open: boolean) => void;
}

// TransportSection is the half of a gRPC connection the address can't state. A
// server that answered has settled it, so it is stated rather than offered; a
// server that hasn't is the one case where the three options are a real choice.
function TransportSection({
  server,
  transport,
  onTransportChange,
  changing,
  onChange,
  parameters,
  onParameterChange,
  variables,
  readOnly,
  certificatesOpen,
  onCertificatesOpenChange,
}: TransportSectionProps) {
  const secure = transport === TLS_ON || (transport === TLS_AUTO && Boolean(server?.tls));

  return (
    <div className="flex flex-col gap-2">
      <label className="text-sm font-medium text-foreground">Transport</label>

      {!changing && server?.reachable ? (
        <>
          <div className="flex items-center gap-3 rounded-md border border-border bg-card px-3 py-2.5">
            {server.tls ? <Lock size={15} className="text-muted-foreground" /> : <LockOpen size={15} className="text-muted-foreground" />}
            <span className="truncate text-sm text-foreground">{server.tls ? "TLS" : "Plaintext"}</span>
            <span className="truncate font-mono text-xs text-muted-foreground">{server.target}</span>
            {!readOnly && (
              <Button variant="ghost" size="sm" className="ml-auto shrink-0" onClick={onChange}>
                Change
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">How Kaja reached the server just now, written into the app so it doesn't have to guess again.</p>
        </>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">A gRPC address doesn't always say whether the connection is encrypted.</p>
          <div className="flex flex-col gap-1.5 pt-0.5" role="radiogroup" aria-label="Transport">
            <ChoiceCard selected={transport === TLS_ON}>
              <ChoiceRow selected={transport === TLS_ON} disabled={readOnly} onSelect={() => onTransportChange(TLS_ON)} icon={Lock}>
                <span className={cn("text-sm", transport === TLS_ON ? "text-foreground" : "text-muted-foreground")}>TLS</span>
              </ChoiceRow>
            </ChoiceCard>
            <ChoiceCard selected={transport === TLS_OFF}>
              <ChoiceRow selected={transport === TLS_OFF} disabled={readOnly} onSelect={() => onTransportChange(TLS_OFF)} icon={LockOpen}>
                <span className={cn("text-sm", transport === TLS_OFF ? "text-foreground" : "text-muted-foreground")}>Plaintext</span>
              </ChoiceRow>
            </ChoiceCard>
            <ChoiceCard selected={transport === TLS_AUTO}>
              <ChoiceRow selected={transport === TLS_AUTO} disabled={readOnly} onSelect={() => onTransportChange(TLS_AUTO)} icon={Waypoints}>
                <span className={cn("text-sm", transport === TLS_AUTO ? "text-foreground" : "text-muted-foreground")}>
                  Decide from the address — https, grpcs, or port 443
                </span>
              </ChoiceRow>
            </ChoiceCard>
          </div>
        </>
      )}

      {secure && (
        <CertificatesSection
          open={certificatesOpen}
          onOpenChange={onCertificatesOpenChange}
          parameters={parameters}
          onParameterChange={onParameterChange}
          variables={variables}
          readOnly={readOnly}
        />
      )}
    </div>
  );
}

interface CertificatesSectionProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  parameters: Record<string, string>;
  onParameterChange: (key: string, value: string) => void;
  variables: { [key: string]: string };
  readOnly: boolean;
}

// CertificatesSection is everything about a TLS connection beyond having one:
// which roots the server is verified against, and which certificate Kaja
// presents. Folded away, because the system roots are the answer nearly always.
function CertificatesSection({ open, onOpenChange, parameters, onParameterChange, variables, readOnly }: CertificatesSectionProps) {
  const skipping = parameters.insecureSkipVerify === "true";
  const configured = [skipping ? "x" : "", parameters.caFile, parameters.clientCertFile].filter((value) => (value ?? "").trim()).length;

  return (
    <div className="flex flex-col gap-3 pt-1">
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        className="flex items-center gap-1.5 self-start text-sm text-muted-foreground hover:text-foreground"
        aria-expanded={open}
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span>Certificates</span>
        {configured > 0 && <span className="rounded-sm bg-muted px-1.5 py-0.5 text-xs">{configured} changed</span>}
      </button>

      {open && (
        <div className="flex flex-col gap-4">
          <label className="flex items-start gap-2.5">
            <Checkbox
              className="mt-0.5"
              checked={skipping}
              disabled={readOnly}
              onCheckedChange={(checked) => onParameterChange("insecureSkipVerify", checked === true ? "true" : "")}
            />
            <span className="flex flex-col gap-0.5">
              <span className="text-sm text-foreground">Accept any certificate this server presents</span>
              <span className={cn("text-xs", skipping ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground")}>
                For a development server with a self-signed certificate. Nothing verifies who you are talking to.
              </span>
            </span>
          </label>

          <FileField
            label="Certificate authority"
            caption="A PEM bundle the server's certificate is verified against, instead of the system roots."
            value={parameters.caFile ?? ""}
            onValueChange={(value) => onParameterChange("caFile", value)}
            variables={variables}
            readOnly={readOnly || skipping}
          />

          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-1.5">
              <ShieldCheck size={13} className="text-muted-foreground" />
              <span className="text-sm text-foreground">Client certificate</span>
              <span className="text-xs text-muted-foreground">Mutual TLS — the server authenticates Kaja too</span>
            </div>
            <FileField
              value={parameters.clientCertFile ?? ""}
              onValueChange={(value) => onParameterChange("clientCertFile", value)}
              variables={variables}
              readOnly={readOnly}
              placeholder="client.pem"
            />
            <FileField
              value={parameters.clientKeyFile ?? ""}
              onValueChange={(value) => onParameterChange("clientKeyFile", value)}
              variables={variables}
              readOnly={readOnly}
              placeholder="client-key.pem"
            />
          </div>
        </div>
      )}
    </div>
  );
}

interface AuthenticationSectionProps {
  selected: string;
  onSelect: (key: string) => void;
  parameters: Record<string, string>;
  onParameterChange: (key: string, value: string) => void;
  variables: { [key: string]: string };
  readOnly: boolean;
}

// AuthenticationSection is one row per credential a gRPC service asks for, plus
// a row for sending nothing. Only the selected row asks for a credential, in the
// shape its scheme expects. There is no document to read them off, so the list is
// the fixed one gRPC services use.
function AuthenticationSection({ selected, onSelect, parameters, onParameterChange, variables, readOnly }: AuthenticationSectionProps) {
  return (
    <div className="flex flex-col gap-2">
      <label className="text-sm font-medium text-foreground">Authentication</label>
      <p className="text-xs text-muted-foreground">
        Sent as metadata with every call, and with reflection. A client certificate is a transport credential — it lives under Certificates above.
      </p>
      <div className="flex flex-col gap-1.5 pt-0.5" role="radiogroup" aria-label="Authentication">
        {authSchemes.map((scheme) => {
          const isSelected = selected === scheme.key;
          return (
            <ChoiceCard key={scheme.key} selected={isSelected}>
              <ChoiceRow selected={isSelected} disabled={readOnly} onSelect={() => onSelect(scheme.key)} icon={scheme.key === AUTH_BASIC ? Lock : Key}>
                <span className={cn("shrink-0 text-sm", isSelected ? "text-foreground" : "text-muted-foreground")}>{scheme.label}</span>
                <span className="truncate text-xs text-muted-foreground">{scheme.summary}</span>
              </ChoiceRow>
              {isSelected && (
                <SchemeCredentials
                  scheme={scheme.key}
                  parameters={parameters}
                  onParameterChange={onParameterChange}
                  variables={variables}
                  readOnly={readOnly}
                />
              )}
            </ChoiceCard>
          );
        })}

        <ChoiceCard selected={selected === AUTH_NONE}>
          <ChoiceRow selected={selected === AUTH_NONE} disabled={readOnly} onSelect={() => onSelect(AUTH_NONE)}>
            <span className={cn("text-sm", selected === AUTH_NONE ? "text-foreground" : "text-muted-foreground")}>Send no credentials</span>
          </ChoiceRow>
        </ChoiceCard>
      </div>
    </div>
  );
}

interface SchemeCredentialsProps {
  scheme: string;
  parameters: Record<string, string>;
  onParameterChange: (key: string, value: string) => void;
  variables: { [key: string]: string };
  readOnly: boolean;
}

// SchemeCredentials is what the selected scheme asks for. Each field takes a
// ${NAME} variable, so a credential can name where it is held instead of being
// written into kaja.json - and whichever it is, the value is applied where Kaja
// keeps it rather than handed to the browser to send.
function SchemeCredentials({ scheme, parameters, onParameterChange, variables, readOnly }: SchemeCredentialsProps) {
  const note = authNote(scheme, parameters.apiKeyName ?? "");

  return (
    <div className="flex flex-col gap-2 border-t border-border px-3 py-3">
      {scheme === AUTH_BASIC ? (
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
        <div className="flex items-center gap-2">
          {scheme === AUTH_APIKEY && (
            <div className="w-48">
              <VariableSuggestInput
                value={parameters.apiKeyName ?? ""}
                onValueChange={(value) => onParameterChange("apiKeyName", value)}
                variables={variables}
                placeholder={DEFAULT_API_KEY_NAME}
                disabled={readOnly}
              />
            </div>
          )}
          <div className="flex-1">
            <VariableSuggestInput
              value={parameters.token ?? ""}
              onValueChange={(value) => onParameterChange("token", value)}
              variables={variables}
              placeholder={scheme === AUTH_APIKEY ? "Key" : "Token"}
              disabled={readOnly}
            />
          </div>
        </div>
      )}
      <p className={cn("text-xs text-muted-foreground", note.mono && "font-mono")}>{note.text}</p>
    </div>
  );
}

interface PathFieldProps {
  value: string;
  onValueChange: (value: string) => void;
  onPick: () => Promise<string>;
  icon: LucideIcon;
  label: string;
  variables: { [key: string]: string };
  placeholder?: string;
  readOnly: boolean;
}

// PathField is a path that takes a ${NAME} variable and, on the desktop, a
// native picker. Elsewhere it is the text field it always was.
function PathField({ value, onValueChange, onPick, icon, label, variables, placeholder, readOnly }: PathFieldProps) {
  return (
    <VariableSuggestInput
      value={value}
      onValueChange={onValueChange}
      variables={variables}
      placeholder={placeholder}
      disabled={readOnly}
      trailingAction={
        isWailsEnvironment() ? (
          <IconButton
            icon={icon}
            aria-label={label}
            variant="ghost"
            size="sm"
            tooltip={false}
            disabled={readOnly}
            onClick={async () => {
              const picked = await onPick();
              if (picked) onValueChange(picked);
            }}
          />
        ) : undefined
      }
    />
  );
}

function FileField({
  label,
  caption,
  value,
  onValueChange,
  variables,
  readOnly,
  placeholder,
}: {
  label?: string;
  caption?: string;
  value: string;
  onValueChange: (value: string) => void;
  variables: { [key: string]: string };
  readOnly: boolean;
  placeholder?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {label && <span className="text-sm text-foreground">{label}</span>}
      <PathField
        value={value}
        onValueChange={onValueChange}
        onPick={OpenFileDialog}
        icon={FileIcon}
        label={label ?? "Select the file"}
        variables={variables}
        placeholder={placeholder ?? "path/to/ca.pem"}
        readOnly={readOnly}
      />
      {caption && <span className="text-xs text-muted-foreground">{caption}</span>}
    </div>
  );
}
