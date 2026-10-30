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
  ShieldCheck,
  TriangleAlert,
  Unplug,
  Waypoints,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "./components/button";
import { Checkbox } from "./components/checkbox";
import { IconButton } from "./components/icon-button";
import { SegmentedControl } from "./components/segmented-control";
import { AppNameField } from "./AppNameField";
import { BasicCredentials } from "./BasicCredentials";
import { ReadingRow } from "./InspectStatus";
import { KnownChip, KnownList } from "./KnownList";
import { KnownGrpcServer, knownGrpcServerFor, matchingGrpcServers } from "./knownGrpcServers";
import { ChoiceBody, ChoiceCard, ChoiceList, ChoiceRow, choiceLabel } from "./ChoiceRow";
import { FormSection } from "./FormSection";
import { VariableSuggestInput } from "./VariableSuggestInput";
import { buildApp, CustomFormProps } from "./appTypes";
import { cn } from "./cn";
import { PHONE_QUERY } from "./phone";
import { useMediaQuery } from "./useMediaQuery";
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
  clientStreamingMethods,
  deriveAppName,
  isDialableTarget,
  nameFromAddress,
  tlsFromServer,
} from "./grpcServer";
import { joinReading, remember, uniqueAppName } from "./appForms";
import { pluralCount } from "./plural";
import { GrpcApp, GrpcProblem, GrpcProblemKind, GrpcServer, InspectGrpcResponse } from "./server/api";
import { getApiClient } from "./server/connection";
import { desktop, isWailsEnvironment } from "./wails";
import { rpcErrorMessage } from "./rpcMessage";

// The only structural choice in the form; every other question is the same either way.
type SurfaceMode = "reflection" | "protoDir";

type ReadState = { status: "idle" } | { status: "reading" } | { status: "read"; server: GrpcServer } | { status: "problem"; problem: GrpcProblem };

const READ_DEBOUNCE_MS = 600;

// Surfaces already read, so flipping between apps in the sidebar doesn't reflect a
// server that hasn't changed. Only successful reads are remembered — a server that was
// down should be tried again.
const inspected = new Map<string, GrpcServer>();

// inspectionKey is what the surface depends on: the address, where the definitions
// come from, and how the connection is made. Credentials are sent with the read but
// are not part of the key — a token is typed a character at a time.
function inspectionKey(parameters: Record<string, string>): string {
  return JSON.stringify(
    ["url", "protoDir", "reflection", "tls", "insecureSkipVerify", "caFile", "clientCertFile", "clientKeyFile"].map((key) => parameters[key] ?? ""),
  );
}

// Reads already on the wire, so two forms — or one form mounted twice — ask the
// server the same question once.
const reading = new Map<string, Promise<InspectGrpcResponse>>();

function inspect(key: string, grpc: GrpcApp | undefined): Promise<InspectGrpcResponse> {
  return joinReading(reading, key, () =>
    getApiClient()
      .inspectGrpc({ grpc })
      .then(({ response }) => response),
  );
}

// GrpcForm is the New/Edit form for a gRPC app. It asks for one thing - where
// the server is - and everything after it is a choice about a server that has
// already answered.
export function GrpcForm({
  nameField,
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
  const phone = useMediaQuery(PHONE_QUERY);
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
  // Typing is the only change that waits for a pause before reading.
  const typedRef = useRef(false);
  // Whether the field is offering the servers Kaja knows the address of.
  const [picker, setPicker] = useState(false);
  const [highlight, setHighlight] = useState(0);

  const url = parameters.url ?? "";
  const protoDir = parameters.protoDir ?? "";
  const server = state.status === "read" ? state.server : undefined;
  const problem = state.status === "problem" ? state.problem : undefined;
  const source = inspectionKey(parameters);
  const known = useMemo(() => knownGrpcServerFor(url), [url]);
  const offered = useMemo(() => matchingGrpcServers(url), [url]);
  const picking = picker && !readOnly && surfaceMode === "reflection" && !known && offered.length > 0;

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
        remember(inspected, key, response.server);
        // The transport that answered is about to be written into the app, which moves
        // the key; without this the form would reflect the server a second time.
        if ((parameters.tls ?? "") === TLS_AUTO && response.server.reachable) {
          remember(inspected, inspectionKey({ ...parameters, tls: tlsFromServer(response.server) }), response.server);
        }
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
          detail: rpcErrorMessage(error),
        },
      });
    }
  }, []);

  // The control above the address and the parameter under it are the same choice, so
  // the parameter follows the control rather than being set alongside it.
  useEffect(() => {
    if (readOnly) return;
    const wanted = surfaceMode === "reflection" ? "true" : "";
    onParametersChange((previous) => ((previous.reflection ?? "") === wanted ? previous : { ...previous, reflection: wanted }));
  }, [surfaceMode, readOnly, onParametersChange]);

  // Read once the source settles. A known server, a picked folder, or the app this form
  // was opened on are already complete and read at once.
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

  // Derive the name from the address until the user types one: the part of the address
  // that identifies the API rather than the machine.
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

  // The transport is settled by what answered, so the app says outright what it does
  // rather than leaving it to be re-derived from the address. A choice the user has
  // already made is never written over.
  useEffect(() => {
    if (readOnly || !server || !server.reachable) return;
    const settled = tlsFromServer(server);
    onParametersChange((previous) => ((previous.tls ?? "") === "" ? { ...previous, tls: settled } : previous));
  }, [server, readOnly, onParametersChange]);

  // A server that asks for a credential before it will say anything is asking for the
  // one nearly every gRPC service asks for.
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

  const pick = (chosen: KnownGrpcServer) => {
    setPicker(false);
    typedRef.current = false;
    onParametersChange((previous) => ({ ...previous, url: chosen.address, protoDir: "" }));
  };

  const auth = (parameters.auth ?? "").trim() || AUTH_NONE;
  const transport = (parameters.tls ?? "").trim();

  // A credential the server wants, or the transport it wants, is asked for before
  // anything has been read — it is the whole reason nothing has been.
  const showTransport = Boolean(server) || problem?.kind === GrpcProblemKind.GRPC_PROBLEM_TLS;
  const showAuthentication =
    Boolean(server) || problem?.kind === GrpcProblemKind.GRPC_PROBLEM_UNAUTHENTICATED || problem?.kind === GrpcProblemKind.GRPC_PROBLEM_PERMISSION_DENIED;

  return (
    <div className={cn("flex flex-col", phone ? "gap-5" : "gap-7")}>
      <FormSection lead fields={["url", "reflection", "protoDir"]}>
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

          <div className="relative">
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
                else read({ fresh: true });
              }}
            />
            {picking && (
              <KnownList
                heading="Known servers"
                entries={offered}
                query={url}
                highlight={highlight % offered.length}
                onHighlight={setHighlight}
                onPick={(index) => pick(offered[index])}
                footer={
                  <>
                    Or type any address. <span className="font-mono">{"${VARIABLES}"}</span> work here too.
                  </>
                }
              />
            )}
          </div>

          {surfaceMode === "protoDir" && (
            <PathField
              value={protoDir}
              onValueChange={(value) => {
                typedRef.current = true;
                setParameter("protoDir", value);
              }}
              onPick={() => desktop().then((app) => app.OpenDirectoryDialog())}
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
            onCancel={() => {
              readIdRef.current++;
              setState({ status: "idle" });
            }}
            onRetry={() => read({ fresh: true })}
            onSwitchMode={switchSurfaceMode}
          />
        </div>
      </FormSection>

      {(server || showTransport || showAuthentication) && (
        <>
          {server && nameField && (
            <FormSection>
              <AppNameField
                id="grpc-name"
                name={name}
                onNameChange={(value) => {
                  setNameTouched(true);
                  onNameChange(value);
                }}
                duplicate={duplicateName}
                readOnly={readOnly}
                caption={nameTouched ? undefined : `From the ${nameFromAddress(url) ? "address" : "service it serves"}.`}
              />
            </FormSection>
          )}

          {showTransport && (
            <FormSection fields={["tls", "insecureSkipVerify", "caFile", "clientCertFile", "clientKeyFile"]}>
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
            </FormSection>
          )}

          {showAuthentication && (
            <FormSection fields={["auth", "username", "password", "apiKeyName", "token"]}>
              <AuthenticationSection
                selected={auth}
                onSelect={(value) => setParameter("auth", value)}
                parameters={parameters}
                onParameterChange={setParameter}
                variables={variables}
                readOnly={readOnly}
              />
            </FormSection>
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
  onCancel: () => void;
  onRetry: () => void;
  onSwitchMode: (mode: SurfaceMode) => void;
}

// SourceStatus is the one slot under the address carrying every state: the read in
// progress, the server that answered, and each way reaching it can fail.
function SourceStatus({ state, mode, readOnly, onCancel, onRetry, onSwitchMode }: SourceStatusProps) {
  if (state.status === "idle") return null;

  if (state.status === "reading") {
    return <ReadingRow label={mode === "reflection" ? "Reaching the server…" : "Reading the proto files, and checking the server…"} onCancel={onCancel} />;
  }

  if (state.status === "read") {
    return <ServerSummary server={state.server} onRefresh={onRetry} />;
  }

  return <ProblemBanner problem={state.problem} mode={mode} readOnly={readOnly} onRetry={onRetry} onSwitchMode={onSwitchMode} />;
}

function ServerSummary({ server, onRefresh }: { server: GrpcServer; onRefresh: () => void }) {
  const clientStreaming = clientStreamingMethods(server);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
        <CircleCheck size={13} className="shrink-0 text-emerald-600 dark:text-emerald-400" />
        <span className="min-w-0 truncate">
          <span className="text-foreground">
            {pluralCount(server.services.length, "service")} · {pluralCount(server.methodCount, "method")}
          </span>{" "}
          {server.source === SOURCE_REFLECTION ? `from reflection ${server.reflectionVersion}` : `from ${pluralCount(server.fileCount, "proto file")}`}
          {server.services.length > 0 && ` · ${server.services.map((service) => service.name).join(" · ")}`}
        </span>
        <IconButton icon={RefreshCw} aria-label="Read the server again" variant="ghost" size="xs" className="ml-auto shrink-0" onClick={onRefresh} />
      </div>
      {clientStreaming > 0 && (
        <div className="flex items-start gap-2 rounded-md border border-border bg-card px-3 py-2">
          <div className="pt-0.5 text-muted-foreground">
            <Info size={15} />
          </div>
          <p className="text-xs leading-5 text-muted-foreground">
            Client streaming is not supported by Kaja yet, so {clientStreaming === 1 ? "one method is" : `${clientStreaming} methods are`} listed in the sidebar
            and marked there, but can’t be called. Server streaming works like any other method.
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
  // answered by the other source rather than by trying again. The failures with a fix of
  // their own — the transport, the address, a credential, a proto that won't compile —
  // are not.
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

// TransportSection is the half of a gRPC connection the address can't state. A server
// that answered has settled it, so it is stated rather than offered.
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
          <ChoiceList label="Transport">
            <ChoiceCard selected={transport === TLS_ON}>
              <ChoiceRow selected={transport === TLS_ON} disabled={readOnly} onSelect={() => onTransportChange(TLS_ON)} icon={Lock}>
                <span className={choiceLabel(transport === TLS_ON)}>TLS</span>
              </ChoiceRow>
            </ChoiceCard>
            <ChoiceCard selected={transport === TLS_OFF}>
              <ChoiceRow selected={transport === TLS_OFF} disabled={readOnly} onSelect={() => onTransportChange(TLS_OFF)} icon={LockOpen}>
                <span className={choiceLabel(transport === TLS_OFF)}>Plaintext</span>
              </ChoiceRow>
            </ChoiceCard>
            <ChoiceCard selected={transport === TLS_AUTO}>
              <ChoiceRow selected={transport === TLS_AUTO} disabled={readOnly} onSelect={() => onTransportChange(TLS_AUTO)} icon={Waypoints}>
                <span className={choiceLabel(transport === TLS_AUTO)}>Decide from the address: https, grpcs, or port 443</span>
              </ChoiceRow>
            </ChoiceCard>
          </ChoiceList>
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

// Folded away, because the system roots are the answer nearly always.
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
              <span className="text-xs text-muted-foreground">Mutual TLS. The server authenticates Kaja too</span>
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

// One row per credential a gRPC service asks for, plus a row for sending nothing.
// There is no document to read them off, so the list is the fixed one.
function AuthenticationSection({ selected, onSelect, parameters, onParameterChange, variables, readOnly }: AuthenticationSectionProps) {
  return (
    <div className="flex flex-col gap-2">
      <label className="text-sm font-medium text-foreground">Authentication</label>
      <p className="text-xs text-muted-foreground">
        Sent as metadata with every call, and with reflection. A client certificate is a transport credential, so it lives under Certificates above.
      </p>
      <ChoiceList label="Authentication">
        {authSchemes.map((scheme) => {
          const isSelected = selected === scheme.key;
          return (
            <ChoiceCard key={scheme.key} selected={isSelected}>
              <ChoiceRow selected={isSelected} disabled={readOnly} onSelect={() => onSelect(scheme.key)} icon={scheme.key === AUTH_BASIC ? Lock : Key}>
                <span className={cn("shrink-0", choiceLabel(isSelected))}>{scheme.label}</span>
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
            <span className={choiceLabel(selected === AUTH_NONE)}>Send no credentials</span>
          </ChoiceRow>
        </ChoiceCard>
      </ChoiceList>
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

// Each field takes a ${NAME} variable, so a credential can name where it is held
// instead of being written into kaja.json — and whichever it is, the value is applied
// where Kaja keeps it rather than handed to the browser to send.
function SchemeCredentials({ scheme, parameters, onParameterChange, variables, readOnly }: SchemeCredentialsProps) {
  const note = authNote(scheme, parameters.apiKeyName ?? "");

  return (
    <ChoiceBody>
      {scheme === AUTH_BASIC ? (
        <BasicCredentials parameters={parameters} onParameterChange={onParameterChange} variables={variables} readOnly={readOnly} />
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
      {note.text && <p className={cn("text-xs text-muted-foreground", note.mono && "font-mono")}>{note.text}</p>}
    </ChoiceBody>
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

// PathField takes a ${NAME} variable and, on the desktop, a native picker.
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
            tooltip="native"
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
        onPick={() => desktop().then((app) => app.OpenFileDialog())}
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
