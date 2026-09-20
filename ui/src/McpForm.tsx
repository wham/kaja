import { Blocks, CircleAlert, CircleCheck, CircleX, Copy, Key, RefreshCw, ShieldCheck, Sparkles, TriangleAlert, Variable, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "./components/button";
import { IconButton } from "./components/icon-button";
import { Spinner } from "./components/spinner";
import { AppNameField } from "./AppNameField";
import { ChoiceCard, ChoiceRow } from "./ChoiceRow";
import { VariableSuggestInput } from "./VariableSuggestInput";
import { AppSurface, buildApp, getAppType } from "./appTypes";
import { copyText } from "./clipboard";
import { cn } from "./cn";
import {
  AUTH_APIKEY,
  AUTH_BEARER,
  AUTH_NONE,
  AUTH_OAUTH,
  DEFAULT_API_KEY_NAME,
  authNote,
  authSchemes,
  count,
  deriveAppName,
  eraLabel,
  isReadableEndpoint,
  uniqueAppName,
} from "./mcpServer";
import { KnownServer, endpointLabel, knownServerFor, matchingServers } from "./knownServers";
import { InspectMcpResponse, McpApp, McpProblem, McpProblemKind, McpServer } from "./server/api";
import { getApiClient } from "./server/connection";
import { rpcErrorMessage } from "./rpcMessage";
import { isWailsEnvironment, openInBrowser } from "./wails";

type ReadState = { status: "idle" } | { status: "reading" } | { status: "read"; server: McpServer } | { status: "problem"; problem: McpProblem };

// SignInState is the one slot the OAuth card carries: the button, the browser it is
// waiting on, and the way it can fail. A sign-in that worked is not a state of its
// own — the endpoint is read again, and the server answering is the proof. The code
// is what a server kaja cannot be sent back from asks the person to type over there,
// so waiting on one is waiting with something to say.
type SignInState = { status: "idle" } | { status: "waiting"; userCode: string } | { status: "problem"; problem: McpProblem };

// mcpApp is the app the form is describing right now, which is what both reading the
// server and signing in to it are asked about.
function mcpApp(parameters: Record<string, string>): McpApp | undefined {
  const app = buildApp("", "mcp", parameters, {});
  return app.app.oneofKind === "mcp" ? app.app.mcp : undefined;
}

const READ_DEBOUNCE_MS = 600;

// Servers already read, so flipping between apps doesn't reach a server that hasn't
// changed. Only successful reads are remembered.
const inspected = new Map<string, McpServer>();
const INSPECTED_LIMIT = 20;

// inspectionKey is the endpoint and nothing else. Credentials are sent with the read
// but are not part of the key — a token is typed a character at a time.
function inspectionKey(parameters: Record<string, string>): string {
  return (parameters.url ?? "").trim();
}

// The fields that make up the credential, which is the server's rather than the
// form's: a token typed for one host may not be sent to the next one typed.
const CREDENTIAL_KEYS = ["auth", "token", "apiKeyName", "clientId", "scope"];

function hostOf(url: string): string {
  try {
    return new URL(url.trim()).host.toLowerCase();
  } catch {
    return "";
  }
}

// withEndpoint is the parameters with a new endpoint typed in. Typing another host, or
// clearing the field, drops the credential with the server it was for; a path corrected
// on the same host keeps it, a typo being the most common edit made to a URL that has
// just been read.
export function withEndpoint(previous: Record<string, string>, url: string): Record<string, string> {
  if (hostOf(previous.url ?? "") === hostOf(url)) return { ...previous, url };
  const next: Record<string, string> = { ...previous, url };
  for (const key of CREDENTIAL_KEYS) delete next[key];
  return next;
}

// Reads already on the wire, so two forms ask the server the same question once.
const reading = new Map<string, Promise<InspectMcpResponse>>();

function inspect(key: string, mcp: McpApp | undefined): Promise<InspectMcpResponse> {
  const pending = reading.get(key);
  if (pending) return pending;
  const started = getApiClient()
    .inspectMcp({ mcp })
    .then(({ response }) => response)
    .finally(() => reading.delete(key));
  reading.set(key, started);
  return started;
}

function remember(key: string, server: McpServer) {
  inspected.delete(key);
  inspected.set(key, server);
  for (const oldest of inspected.keys()) {
    if (inspected.size <= INSPECTED_LIMIT) break;
    inspected.delete(oldest);
  }
}

// surfaceCount is everything the app would add: a method per tool, a method per
// prompt, and the fixed methods a server with resources gets.
function surfaceCount(server: McpServer): number {
  const resourceMethods = server.resourceCount > 0 || server.resourceTemplateCount > 0 ? 3 : 0;
  const promptMethods = server.promptCount > 0 ? server.promptCount + 1 : 0;
  return server.toolCount + promptMethods + resourceMethods;
}

interface McpFormProps {
  name: string;
  onNameChange: (name: string) => void;
  duplicateName: boolean;
  // So a derived name doesn't land on a collision the user has to resolve by hand.
  takenNames: string[];
  parameters: Record<string, string>;
  onParametersChange: (update: (previous: Record<string, string>) => Record<string, string>) => void;
  variables: { [key: string]: string };
  readOnly: boolean;
  // What the form last read, for the receipt in the footer.
  onSurfaceChange: (surface: AppSurface | undefined) => void;
  onReadyChange: (ready: boolean) => void;
}

// McpForm is the New/Edit form for an MCP app. It asks for one thing - where the
// server is - and everything after it is what that server said about itself.
export function McpForm({
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
}: McpFormProps) {
  const [state, setState] = useState<ReadState>({ status: "idle" });
  const [signIn, setSignIn] = useState<SignInState>({ status: "idle" });
  const parametersRef = useRef(parameters);
  parametersRef.current = parameters;
  // Only the latest read may write to state; anything older is discarded.
  const readIdRef = useRef(0);
  // Whether the name is the user's rather than the one derived from the server.
  const [nameTouched, setNameTouched] = useState(Boolean(name));
  // Typing is the only change that waits for a pause before reading.
  const typedRef = useRef(false);
  // Whether the field is offering the servers Kaja is set up for.
  const [picker, setPicker] = useState(false);
  const [highlight, setHighlight] = useState(0);

  const url = parameters.url ?? "";
  const known = useMemo(() => knownServerFor(url), [url]);
  const offered = useMemo(() => matchingServers(url), [url]);
  // The list is an offer of what to type, so it goes the moment the field holds one of
  // them: what a matched endpoint has to say is said by the chip and the read below it.
  const picking = picker && !readOnly && !known && offered.length > 0;
  const server = state.status === "read" ? state.server : undefined;
  const problem = state.status === "problem" ? state.problem : undefined;
  // The endpoint names a variable this kaja doesn't define. The server is read where
  // the app opens, so the app can still be added, under a name of the person's own.
  const unresolved = problem?.kind === McpProblemKind.MCP_PROBLEM_UNRESOLVED;
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
      const response = await inspect(key, mcpApp(parameters));
      if (readId !== readIdRef.current) return;
      if (response.server && !response.problem) {
        remember(key, response.server);
        setState({ status: "read", server: response.server });
      } else {
        setState({
          status: "problem",
          problem: response.problem ?? { kind: McpProblemKind.MCP_PROBLEM_UNKNOWN, message: "Couldn't read the server", detail: "" },
        });
      }
    } catch (error) {
      if (readId !== readIdRef.current) return;
      setState({
        status: "problem",
        problem: {
          kind: McpProblemKind.MCP_PROBLEM_UNKNOWN,
          message: "Couldn't read the server",
          detail: rpcErrorMessage(error),
        },
      });
    }
  }, []);

  // Signing in is a flow with a browser in the middle of it: the first message is the
  // page to open, and the last one arrives once the authorization server has sent the
  // person back to the loopback address kaja is listening on. So the stream is read to
  // its end rather than awaited as one answer.
  const authorize = useCallback(async () => {
    setSignIn({ status: "waiting", userCode: "" });
    const failed = (problem: McpProblem) => setSignIn({ status: "problem", problem });
    try {
      const call = getApiClient().authorizeMcp({ mcp: mcpApp(parametersRef.current) });
      for await (const response of call.responses) {
        if (response.authorizationUrl) {
          // The desktop's window is not a browser, and a page it navigated away from
          // would be the app gone.
          if (isWailsEnvironment()) openInBrowser(response.authorizationUrl);
          else window.open(response.authorizationUrl, "_blank", "noopener");
          setSignIn({ status: "waiting", userCode: response.userCode });
          continue;
        }
        if (response.problem) return failed(response.problem);
        if (response.authorized) {
          setSignIn({ status: "idle" });
          read({ fresh: true });
          return;
        }
      }
      setSignIn({ status: "idle" });
    } catch (error) {
      failed({ kind: McpProblemKind.MCP_PROBLEM_AUTHORIZATION, message: "The sign-in failed.", detail: rpcErrorMessage(error) });
    }
  }, [read]);

  const forget = useCallback(async () => {
    try {
      await getApiClient().forgetMcpAuthorization({ mcp: mcpApp(parametersRef.current) });
    } catch {
      // Signing out is dropping a token kaja holds. One it could not drop is one it
      // will fail on the next call with, which is where that is worth saying.
    }
    setSignIn({ status: "idle" });
    read({ fresh: true });
  }, [read]);

  // Read once the endpoint settles. The demo link, ⏎, or the app this form was opened
  // on are already complete and read at once.
  useEffect(() => {
    const typed = typedRef.current;
    typedRef.current = false;

    if (!isReadableEndpoint(parametersRef.current.url ?? "")) {
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
  }, [source, read]);

  useEffect(() => setHighlight(0), [url]);

  useEffect(() => onSurfaceChange(server ? { count: surfaceCount(server) } : undefined), [server, onSurfaceChange]);

  // Derive the name from what the server calls itself until the user types one. A
  // name derived from one server is dropped when the endpoint stops naming it, so an
  // endpoint nothing has read yet is not added under the previous server's name.
  useEffect(() => {
    if (nameTouched) return;
    if (!server) {
      onNameChange("");
      return;
    }
    const derived = uniqueAppName(deriveAppName(parametersRef.current.url ?? "", server.name), takenNames);
    if (derived) onNameChange(derived);
  }, [server, nameTouched, takenNames, onNameChange]);

  // A sign-in that failed is about the server it was tried against.
  useEffect(() => setSignIn({ status: "idle" }), [source]);

  // A server that won't say what it exposes without a credential is asking for the one
  // MCP's own authorization framework hands out. A server Kaja is set up for asks for
  // the sign-in it is set up for, which is the whole of what being on that list buys.
  useEffect(() => {
    if (readOnly || problem?.kind !== McpProblemKind.MCP_PROBLEM_UNAUTHORIZED) return;
    const wanted = knownServerFor(parametersRef.current.url ?? "") ? AUTH_OAUTH : AUTH_BEARER;
    onParametersChange((previous) => ((previous.auth ?? "") === "" ? { ...previous, auth: wanted } : previous));
  }, [problem, readOnly, onParametersChange]);

  useEffect(() => {
    onReadyChange((Boolean(server) || unresolved) && isReadableEndpoint(parametersRef.current.url ?? ""));
  }, [server, unresolved, url, onReadyChange]);

  const setParameter = (key: string, value: string) => onParametersChange((previous) => ({ ...previous, [key]: value }));

  // Taking a row is the address and the credential at once: an entry exists because
  // Kaja can sign in to it, so selecting anything else would be undoing the offer.
  const pick = (chosen: KnownServer) => {
    setPicker(false);
    typedRef.current = false;
    onParametersChange((previous) => ({ ...previous, url: chosen.endpoint, auth: AUTH_OAUTH }));
  };

  const demo = getAppType("mcp")?.demo;
  // An app that names no credential sends none, and the form says so rather than
  // showing a bearer card with nothing in it. A token with no scheme beside it is a
  // bearer token, which is what the server reads it as.
  const auth = (parameters.auth ?? "").trim() || ((parameters.token ?? "").trim() ? AUTH_BEARER : AUTH_NONE);

  // A credential the server wants is asked for before anything has been read: it is the
  // whole reason nothing has been.
  const showAuthentication =
    Boolean(server) ||
    auth === AUTH_OAUTH ||
    problem?.kind === McpProblemKind.MCP_PROBLEM_UNAUTHORIZED ||
    problem?.kind === McpProblemKind.MCP_PROBLEM_FORBIDDEN;

  return (
    <div className="flex max-w-[640px] flex-col gap-6">
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium text-foreground" htmlFor="mcp-url">
          MCP endpoint
        </label>

        <div className="relative">
          <VariableSuggestInput
            id="mcp-url"
            value={url}
            onValueChange={(value) => {
              typedRef.current = true;
              onParametersChange((previous) => withEndpoint(previous, value));
            }}
            variables={variables}
            placeholder="https://example.com/mcp"
            disabled={readOnly}
            className={known ? "pr-28" : undefined}
            trailingAction={known && <KnownServerChip server={known} />}
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
          {picking && <KnownServerList servers={offered} query={url} highlight={highlight % offered.length} onHighlight={setHighlight} onPick={pick} />}
        </div>

        <EndpointStatus
          state={state}
          readOnly={readOnly}
          demoLabel={demo?.label}
          onDemo={demo ? () => onParametersChange((previous) => ({ ...previous, ...demo.parameters })) : undefined}
          onCancel={() => {
            readIdRef.current++;
            setState({ status: "idle" });
          }}
          onRetry={() => read({ fresh: true })}
        />
      </div>

      {(server || unresolved || showAuthentication) && (
        <>
          <div className="h-px bg-border" />

          {(server || unresolved) && (
            <AppNameField
              id="mcp-name"
              name={name}
              onNameChange={(value) => {
                setNameTouched(true);
                onNameChange(value);
              }}
              duplicate={duplicateName}
              readOnly={readOnly}
              caption={nameTouched || !server ? undefined : `From ${server.name ? "what the server calls itself" : "the endpoint"}.`}
            />
          )}

          {showAuthentication && (
            <AuthenticationSection
              selected={auth}
              onSelect={(value) => setParameter("auth", value)}
              known={known}
              parameters={parameters}
              onParameterChange={setParameter}
              variables={variables}
              readOnly={readOnly}
              signedIn={Boolean(server) && auth === AUTH_OAUTH}
              signIn={signIn}
              onSignIn={authorize}
              onSignOut={forget}
            />
          )}
        </>
      )}
    </div>
  );
}

interface KnownServerListProps {
  servers: KnownServer[];
  query: string;
  highlight: number;
  onHighlight: (index: number) => void;
  onPick: (server: KnownServer) => void;
}

// The servers Kaja is set up for, under the field they fill in. Rows are the height of
// that field, and the footer is the escape hatch: everything here is an offer, and
// pasting an address nobody bundled is the ordinary way to use the form.
function KnownServerList({ servers, query, highlight, onHighlight, onPick }: KnownServerListProps) {
  const typed = query.trim().length > 0;
  return (
    // Keep focus in the input so a click on a row isn't lost to blur.
    <div
      onMouseDown={(event) => event.preventDefault()}
      className="absolute left-0 top-full z-10 mt-1 w-full overflow-hidden rounded-md border border-border bg-popover shadow-md"
    >
      {!typed && <p className="px-3 pb-1 pt-2 text-xs text-muted-foreground">Servers Kaja is set up for</p>}
      {servers.map((server, index) => (
        <button
          key={server.endpoint}
          type="button"
          onMouseEnter={() => onHighlight(index)}
          onClick={() => onPick(server)}
          className={cn("flex h-8 w-full items-center gap-2 px-3 text-left", index === highlight ? "bg-accent" : "hover:bg-accent/50")}
        >
          <span className="flex size-[18px] shrink-0 items-center justify-center text-foreground">
            <server.mark size={16} />
          </span>
          <span className="shrink-0 text-sm text-foreground">{server.name}</span>
          <span className="truncate font-mono text-xs text-muted-foreground">{endpointLabel(server.endpoint)}</span>
          <span className="ml-auto shrink-0 text-xs text-muted-foreground">{typed && index === highlight ? "⏎" : "sign-in ready"}</span>
        </button>
      ))}
      <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
        {!typed || isReadableEndpoint(query) ? (
          <>
            Or paste any endpoint. <span className="font-mono">{"${VARIABLES}"}</span> work here too.
          </>
        ) : (
          "Nothing typed here is a URL yet, so no server has been reached."
        )}
      </p>
    </div>
  );
}

// The server the endpoint turned out to be, said in the field that holds it. It is the
// one thing recognition adds above the divider: everything it changed is below.
function KnownServerChip({ server }: { server: KnownServer }) {
  return (
    <span className="flex items-center gap-1 rounded-sm bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
      <server.mark size={12} />
      <span className="max-w-24 truncate">{server.name}</span>
    </span>
  );
}

interface EndpointStatusProps {
  state: ReadState;
  readOnly: boolean;
  demoLabel?: string;
  onDemo?: () => void;
  onCancel: () => void;
  onRetry: () => void;
}

// EndpointStatus is the one slot under the endpoint carrying every state: the caption,
// the read in progress, the server that answered, and each way reaching it can fail.
function EndpointStatus({ state, readOnly, demoLabel, onDemo, onCancel, onRetry }: EndpointStatusProps) {
  if (state.status === "idle") {
    return (
      <p className="text-xs text-muted-foreground">
        Kaja asks the server what it exposes and fills in the rest.
        {demoLabel && onDemo && !readOnly && (
          <>
            {" "}
            {/* The separator rides with the link, so a wrap never leaves it dangling. */}
            <span className="whitespace-nowrap">
              ·{" "}
              <button type="button" onClick={onDemo} className="inline-flex items-center gap-1 align-middle hover:text-foreground">
                <Sparkles size={11} />
                {demoLabel}
              </button>
            </span>
          </>
        )}
      </p>
    );
  }

  if (state.status === "reading") {
    return (
      <div className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2">
        <Spinner size="sm" />
        <span className="text-sm text-muted-foreground">Reaching the server…</span>
        <Button variant="ghost" size="sm" className="ml-auto" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    );
  }

  if (state.status === "read") {
    return <ServerSummary server={state.server} onRefresh={onRetry} />;
  }

  return <ProblemBanner problem={state.problem} readOnly={readOnly} onRetry={onRetry} />;
}

function ServerSummary({ server, onRefresh }: { server: McpServer; onRefresh: () => void }) {
  const parts = [count(server.toolCount, "tool")];
  if (server.resourceCount > 0) parts.push(count(server.resourceCount, "resource"));
  if (server.resourceTemplateCount > 0) parts.push(count(server.resourceTemplateCount, "resource template"));
  if (server.promptCount > 0) parts.push(count(server.promptCount, "prompt"));

  return (
    <div className="flex items-start gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2">
      <div className="pt-0.5 text-emerald-600 dark:text-emerald-400">
        <CircleCheck size={15} />
      </div>
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="truncate text-sm text-foreground">
          {parts.join(" · ")} <span className="text-muted-foreground">from {server.name || "the server"}</span>
        </p>
        {/* A version is whatever the server calls its build, and some of them name a
            commit, so it goes on the line that truncates rather than the one read. */}
        <p className="truncate text-xs text-muted-foreground">
          {eraLabel(server.protocolVersion, server.handshake)}
          {server.version && ` · ${server.version}`}
        </p>
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-1 text-muted-foreground">
        <IconButton icon={RefreshCw} aria-label="Read the server again" variant="ghost" size="xs" onClick={onRefresh} />
      </div>
    </div>
  );
}

// Not everything the read comes back with is a failure. A sign-in Kaja has not done
// yet is the next step in a form that has just asked for one, so it is drawn in the
// chrome's own colours and offers no Retry: the move is the button below it, and
// reading again before that is pressed answers exactly the same.
function ProblemBanner({ problem, readOnly, onRetry }: { problem: McpProblem; readOnly: boolean; onRetry: () => void }) {
  const unresolved = problem.kind === McpProblemKind.MCP_PROBLEM_UNRESOLVED;
  const step = problem.kind === McpProblemKind.MCP_PROBLEM_SIGN_IN || unresolved;
  const warning = problem.kind === McpProblemKind.MCP_PROBLEM_EMPTY || problem.kind === McpProblemKind.MCP_PROBLEM_UNAUTHORIZED;
  const notMcp = problem.kind === McpProblemKind.MCP_PROBLEM_NOT_MCP || problem.kind === McpProblemKind.MCP_PROBLEM_LEGACY_SSE;
  const Icon: LucideIcon = unresolved ? Variable : step ? ShieldCheck : warning ? TriangleAlert : notMcp ? CircleAlert : CircleX;

  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-md border px-3 py-2",
        step ? "border-border bg-card" : warning ? "border-amber-500/40 bg-amber-500/10" : "border-destructive/40 bg-destructive/10",
      )}
    >
      <div className={cn("pt-0.5", step ? "text-muted-foreground" : warning ? "text-amber-600 dark:text-amber-400" : "text-destructive")}>
        <Icon size={15} />
      </div>
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="text-sm text-foreground">{problem.message}</p>
        {problem.detail && <p className="break-words font-mono text-xs text-muted-foreground">{problem.detail}</p>}
      </div>
      {!readOnly && !step && (
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onRetry}>
            Retry
          </Button>
        </div>
      )}
    </div>
  );
}

interface AuthenticationSectionProps {
  selected: string;
  onSelect: (value: string) => void;
  // The server Kaja ships a registration for, where the endpoint is one of those.
  known: KnownServer | undefined;
  parameters: Record<string, string>;
  onParameterChange: (key: string, value: string) => void;
  variables: { [key: string]: string };
  readOnly: boolean;
  // Whether the server answered with the token Kaja holds, which is the only honest
  // proof that a sign-in is still good.
  signedIn: boolean;
  signIn: SignInState;
  onSignIn: () => void;
  onSignOut: () => void;
}

// A fixed list: there is no document declaring what a server accepts, so every shape a
// credential comes in is offered outright. Signing in comes first, because it is the
// one MCP's own authorization framework defines and the one a hosted server wants.
function AuthenticationSection({
  selected,
  onSelect,
  known,
  parameters,
  onParameterChange,
  variables,
  readOnly,
  signedIn,
  signIn,
  onSignIn,
  onSignOut,
}: AuthenticationSectionProps) {
  const oauth = selected === AUTH_OAUTH;
  // A prefill is a starting point, never a lock: the bundled registration is what the
  // card opens on, and asking for the fields is one click either way. A client id or a
  // scope already in the app is that ask having been made before.
  const [ownClient, setOwnClient] = useState(false);
  const own = ownClient || (parameters.clientId ?? "") !== "" || (parameters.scope ?? "") !== "";
  // The registration the card would sign in with, where that is Kaja's own.
  const bundled = own ? undefined : known;
  const backToKaja = () => {
    setOwnClient(false);
    onParameterChange("clientId", "");
    onParameterChange("scope", "");
  };
  return (
    <div className="flex flex-col gap-2">
      <label className="text-sm font-medium text-foreground">Authentication</label>
      <div role="radiogroup" aria-label="Authentication" className="flex flex-col gap-1.5 pt-0.5">
        <ChoiceCard selected={oauth}>
          <ChoiceRow selected={oauth} disabled={readOnly} onSelect={() => onSelect(AUTH_OAUTH)} icon={ShieldCheck}>
            <span className={cn("shrink-0 text-sm", oauth ? "text-foreground" : "text-muted-foreground")}>Sign in</span>
            <span className="truncate text-xs text-muted-foreground">Kaja gets the token and keeps it renewed</span>
            {known && <span className="ml-auto shrink-0 rounded-sm bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">nothing to paste</span>}
          </ChoiceRow>
          {oauth && (
            <div className="flex flex-col gap-2 border-t border-border px-3 py-3">
              {/* The verbs go where the workspace can't be written; the fields stay,
                  because reading how an app is configured is still worth doing. */}
              {!readOnly && (
                <SignInStatus
                  state={signIn}
                  signedIn={signedIn}
                  onSignIn={onSignIn}
                  onSignOut={onSignOut}
                  onOwnClient={bundled ? () => setOwnClient(true) : undefined}
                  onBundled={known && own ? backToKaja : undefined}
                />
              )}
              {!bundled && (
                <>
                  <VariableSuggestInput
                    value={parameters.clientId ?? ""}
                    onValueChange={(value) => onParameterChange("clientId", value)}
                    variables={variables}
                    placeholder="Client ID"
                    disabled={readOnly}
                  />
                  <VariableSuggestInput
                    value={parameters.scope ?? ""}
                    onValueChange={(value) => onParameterChange("scope", value)}
                    variables={variables}
                    placeholder="Scopes"
                    disabled={readOnly}
                  />
                  <p className="text-xs text-muted-foreground">Left empty, Kaja registers itself and takes the scopes the server names.</p>
                </>
              )}
              {bundled && <p className="text-xs text-muted-foreground">Using Kaja's registration with {bundled.name}.</p>}
            </div>
          )}
        </ChoiceCard>

        {authSchemes.map((scheme) => {
          const active = selected === scheme.key;
          const note = authNote(scheme.key, parameters.apiKeyName ?? "");
          return (
            <ChoiceCard key={scheme.key} selected={active}>
              <ChoiceRow selected={active} disabled={readOnly} onSelect={() => onSelect(scheme.key)} icon={scheme.key === AUTH_APIKEY ? Key : Blocks}>
                <span className={cn("shrink-0 text-sm", active ? "text-foreground" : "text-muted-foreground")}>{scheme.label}</span>
                <span className="truncate text-xs text-muted-foreground">{scheme.summary}</span>
              </ChoiceRow>
              {active && (
                <div className="flex flex-col gap-2 border-t border-border px-3 py-3">
                  <div className="flex items-center gap-2">
                    {scheme.key === AUTH_APIKEY && (
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
                        placeholder={scheme.key === AUTH_APIKEY ? "Key" : "Token"}
                        disabled={readOnly}
                      />
                    </div>
                  </div>
                  <p className={cn("text-xs text-muted-foreground", note.mono && "font-mono")}>{note.text}</p>
                </div>
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

// The code the person carries to the page that was opened. It is shown in full and
// copyable, being a value that has to be typed somewhere else in the next minute.
function UserCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void copyText(code).then((landed) => {
      if (landed) setCopied(true);
    });
  };
  return (
    <div className="flex items-center gap-1 pl-6">
      <span className="font-mono text-sm tracking-[0.18em] text-foreground">{code}</span>
      <IconButton
        size="xs"
        variant="ghost"
        tooltip="native"
        icon={Copy}
        aria-label={copied ? "Copied the code" : "Copy the code"}
        className={cn("h-5 w-5 [&_svg]:size-3", copied && "text-foreground")}
        onClick={copy}
      />
    </div>
  );
}

interface SignInStatusProps {
  state: SignInState;
  signedIn: boolean;
  onSignIn: () => void;
  onSignOut: () => void;
  // Present where Kaja's own registration is what would be used, and where something
  // typed over it could be given back. Never both.
  onOwnClient?: () => void;
  onBundled?: () => void;
}

// One slot, like the endpoint's: the button, the browser it is waiting on, and the way
// it can fail. It says nothing about having succeeded — the server answering above is
// what says that.
function SignInStatus({ state, signedIn, onSignIn, onSignOut, onOwnClient, onBundled }: SignInStatusProps) {
  if (state.status === "waiting") {
    return (
      <div className="flex flex-col gap-1.5 text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          <Spinner />
          <span>{state.userCode ? "Enter this code in the browser to finish signing in." : "Waiting for the browser. Finish signing in there."}</span>
        </div>
        {state.userCode && <UserCode code={state.userCode} />}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Button variant={signedIn ? "ghost" : "default"} size="sm" onClick={onSignIn}>
          {signedIn ? "Sign in again" : "Sign in…"}
        </Button>
        {signedIn && (
          <Button variant="ghost" size="sm" onClick={onSignOut}>
            Sign out
          </Button>
        )}
        {onOwnClient && (
          <Button variant="ghost" size="sm" onClick={onOwnClient}>
            Use my own client ID
          </Button>
        )}
        {onBundled && (
          <Button variant="ghost" size="sm" onClick={onBundled}>
            Back to Kaja's
          </Button>
        )}
      </div>
      {state.status === "problem" && (
        <div className="flex items-start gap-2 text-xs text-destructive">
          <CircleX className="mt-px size-3.5 shrink-0" />
          <span className="min-w-0">
            {state.problem.message}
            {state.problem.detail && <span className="block break-all text-muted-foreground">{state.problem.detail}</span>}
          </span>
        </div>
      )}
    </div>
  );
}
