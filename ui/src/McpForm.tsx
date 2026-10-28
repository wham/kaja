import { Blocks, CircleAlert, CircleCheck, CircleX, Key, RefreshCw, ShieldCheck, TriangleAlert, Variable, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "./components/button";
import { IconButton } from "./components/icon-button";
import { AppNameField } from "./AppNameField";
import { DemoLink, ReadingRow } from "./InspectStatus";
import { ChoiceBody, ChoiceCard, ChoiceList, ChoiceRow, choiceLabel } from "./ChoiceRow";
import { FormSection } from "./FormSection";
import { VariableSuggestInput } from "./VariableSuggestInput";
import { buildApp, CustomFormProps, getAppType } from "./appTypes";
import { cn } from "./cn";
import { PHONE_QUERY } from "./phone";
import { useMediaQuery } from "./useMediaQuery";
import { AUTH_APIKEY, AUTH_BEARER, AUTH_NONE, AUTH_OAUTH, DEFAULT_API_KEY_NAME, authNote, authSchemes, deriveAppName, eraLabel } from "./mcpServer";
import { isReadableUrl, joinReading, remember, uniqueAppName } from "./appForms";
import { pluralCount } from "./plural";
import { KnownServer, knownServerFor, matchingServers } from "./knownServers";
import { KnownChip, KnownList } from "./KnownList";
import { InspectMcpResponse, McpApp, McpProblem, McpProblemKind, McpServer } from "./server/api";
import { getApiClient } from "./server/connection";
import { rpcErrorMessage } from "./rpcMessage";
import { SignInState, SignInStatus, SignInVariable, followSignIn } from "./SignIn";
import { signInCredential, signsIn } from "./variableExpansion";

type ReadState = { status: "idle" } | { status: "reading" } | { status: "read"; server: McpServer } | { status: "problem"; problem: McpProblem };

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
  return joinReading(reading, key, () =>
    getApiClient()
      .inspectMcp({ mcp })
      .then(({ response }) => response),
  );
}

// surfaceCount is everything the app would add: a method per tool, a method per
// prompt, and the fixed methods a server with resources gets.
function surfaceCount(server: McpServer): number {
  const resourceMethods = server.resourceCount > 0 || server.resourceTemplateCount > 0 ? 3 : 0;
  const promptMethods = server.promptCount > 0 ? server.promptCount + 1 : 0;
  return server.toolCount + promptMethods + resourceMethods;
}

// McpForm is the New/Edit form for an MCP app. It asks for one thing - where the
// server is - and everything after it is what that server said about itself.
export function McpForm({
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
        remember(inspected, key, response.server);
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

  const authorize = useCallback(async () => {
    const credential = signInCredential(parametersRef.current.token ?? "", name, variables);
    const parameters: Record<string, string> = { ...parametersRef.current, token: credential };
    onParametersChange((previous) => ({ ...previous, token: credential }));
    const call = getApiClient().authorizeMcp({ mcp: mcpApp(parameters) });
    if (await followSignIn(call, setSignIn)) read({ fresh: true });
  }, [read, name, variables, onParametersChange]);

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

    if (!isReadableUrl(parametersRef.current.url ?? "")) {
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
    onReadyChange((Boolean(server) || unresolved) && isReadableUrl(parametersRef.current.url ?? ""));
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
    <div className={cn("flex flex-col", phone ? "gap-5" : "gap-7")}>
      <FormSection lead fields={["url"]}>
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
                heading="Servers Kaja is set up for"
                note="sign-in ready"
                entries={offered.map((server) => ({ name: server.name, address: server.endpoint, mark: server.mark }))}
                query={url}
                highlight={highlight % offered.length}
                onHighlight={setHighlight}
                onPick={(index) => pick(offered[index])}
                footer={
                  !url.trim() || isReadableUrl(url) ? (
                    <>
                      Or paste any endpoint. <span className="font-mono">{"${VARIABLES}"}</span> work here too.
                    </>
                  ) : (
                    "Nothing typed here is a URL yet, so no server has been reached."
                  )
                }
              />
            )}
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
      </FormSection>

      {(server || unresolved || showAuthentication) && (
        <>
          {(server || unresolved) && (nameField || unresolved) && (
            <FormSection>
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
            </FormSection>
          )}

          {showAuthentication && (
            <FormSection fields={["auth", "clientId", "scope", "apiKeyName", "token"]}>
              <AuthenticationSection
                selected={auth}
                onSelect={(value) =>
                  onParametersChange((previous) => ({
                    ...previous,
                    auth: value,
                    // The sign-in stays kept for when Sign in is chosen again; another
                    // credential is typed, and a reference to a sign-in isn't one.
                    ...(value !== AUTH_OAUTH && signsIn(previous.token ?? "", variables) ? { token: "" } : {}),
                  }))
                }
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
            </FormSection>
          )}
        </>
      )}
    </div>
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
        {demoLabel && onDemo && !readOnly && <DemoLink label={demoLabel} onDemo={onDemo} />}
      </p>
    );
  }

  if (state.status === "reading") {
    return <ReadingRow label="Reaching the server…" onCancel={onCancel} />;
  }

  if (state.status === "read") {
    return <ServerSummary server={state.server} onRefresh={onRetry} />;
  }

  return <ProblemBanner problem={state.problem} readOnly={readOnly} onRetry={onRetry} />;
}

function ServerSummary({ server, onRefresh }: { server: McpServer; onRefresh: () => void }) {
  const parts = [pluralCount(server.toolCount, "tool")];
  if (server.resourceCount > 0) parts.push(pluralCount(server.resourceCount, "resource"));
  if (server.resourceTemplateCount > 0) parts.push(pluralCount(server.resourceTemplateCount, "resource template"));
  if (server.promptCount > 0) parts.push(pluralCount(server.promptCount, "prompt"));

  return (
    <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
      <CircleCheck size={13} className="shrink-0 text-emerald-600 dark:text-emerald-400" />
      {/* A version is whatever the server calls its build, and some of them name a
          commit, so it goes last where the line truncates. */}
      <span className="min-w-0 truncate">
        <span className="text-foreground">{parts.join(" · ")}</span> from {server.name || "the server"} · {eraLabel(server.protocolVersion, server.handshake)}
        {server.version && ` · ${server.version}`}
      </span>
      <IconButton icon={RefreshCw} aria-label="Read the server again" variant="ghost" size="xs" className="ml-auto shrink-0" onClick={onRefresh} />
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
      <ChoiceList label="Authentication">
        <ChoiceCard selected={oauth}>
          <ChoiceRow selected={oauth} disabled={readOnly} onSelect={() => onSelect(AUTH_OAUTH)} icon={ShieldCheck}>
            <span className={cn("shrink-0", choiceLabel(oauth))}>Sign in</span>
            <span className="truncate text-xs text-muted-foreground">Kaja gets the token and keeps it renewed</span>
            {known && <span className="ml-auto shrink-0 text-xs text-muted-foreground">nothing to paste</span>}
          </ChoiceRow>
          {oauth && (
            <ChoiceBody>
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
              <SignInVariable credential={parameters.token ?? ""} variables={variables} />
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
            </ChoiceBody>
          )}
        </ChoiceCard>

        {authSchemes.map((scheme) => {
          const active = selected === scheme.key;
          const note = authNote(scheme.key, parameters.apiKeyName ?? "");
          return (
            <ChoiceCard key={scheme.key} selected={active}>
              <ChoiceRow selected={active} disabled={readOnly} onSelect={() => onSelect(scheme.key)} icon={scheme.key === AUTH_APIKEY ? Key : Blocks}>
                <span className={cn("shrink-0", choiceLabel(active))}>{scheme.label}</span>
                <span className="truncate text-xs text-muted-foreground">{scheme.summary}</span>
              </ChoiceRow>
              {active && (
                <ChoiceBody>
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
                </ChoiceBody>
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
