import { Blocks, CircleAlert, CircleCheck, CircleX, Info, Key, RefreshCw, ShieldOff, Sparkles, TriangleAlert, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "./components/button";
import { IconButton } from "./components/icon-button";
import { Spinner } from "./components/spinner";
import { AppNameField } from "./AppNameField";
import { ChoiceCard, ChoiceRow } from "./ChoiceRow";
import { VariableSuggestInput } from "./VariableSuggestInput";
import { AppSurface, buildApp, getAppType } from "./appTypes";
import { cn } from "./cn";
import {
  AUTH_APIKEY,
  AUTH_BEARER,
  AUTH_NONE,
  DEFAULT_API_KEY_NAME,
  authNote,
  authSchemes,
  count,
  deriveAppName,
  eraLabel,
  isReadableEndpoint,
  uniqueAppName,
} from "./mcpServer";
import { InspectMcpResponse, McpApp, McpProblem, McpProblemKind, McpServer } from "./server/api";
import { getApiClient } from "./server/connection";

type ReadState = { status: "idle" } | { status: "reading" } | { status: "read"; server: McpServer } | { status: "problem"; problem: McpProblem };

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
  const parametersRef = useRef(parameters);
  parametersRef.current = parameters;
  // Only the latest read may write to state; anything older is discarded.
  const readIdRef = useRef(0);
  // Whether the name is the user's rather than the one derived from the server.
  const [nameTouched, setNameTouched] = useState(Boolean(name));
  // Typing is the only change that waits for a pause before reading.
  const typedRef = useRef(false);

  const url = parameters.url ?? "";
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
      const app = buildApp("", "mcp", parameters, {});
      const mcp = app.app.oneofKind === "mcp" ? app.app.mcp : undefined;
      const response = await inspect(key, mcp);
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
          detail: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }, []);

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

  useEffect(() => onSurfaceChange(server ? { count: surfaceCount(server) } : undefined), [server, onSurfaceChange]);

  // Derive the name from what the server calls itself until the user types one.
  useEffect(() => {
    if (!server || nameTouched) return;
    const derived = uniqueAppName(deriveAppName(parametersRef.current.url ?? "", server.name), takenNames);
    if (derived) onNameChange(derived);
  }, [server, nameTouched, takenNames, onNameChange]);

  // A server that won't say what it exposes without a credential is asking for the one
  // MCP's own authorization framework hands out.
  useEffect(() => {
    if (readOnly || problem?.kind !== McpProblemKind.MCP_PROBLEM_UNAUTHORIZED) return;
    onParametersChange((previous) => ((previous.auth ?? "") === "" ? { ...previous, auth: AUTH_BEARER } : previous));
  }, [problem, readOnly, onParametersChange]);

  useEffect(() => {
    onReadyChange(Boolean(server) && isReadableEndpoint(parametersRef.current.url ?? ""));
  }, [server, url, onReadyChange]);

  const setParameter = (key: string, value: string) => onParametersChange((previous) => ({ ...previous, [key]: value }));

  const demo = getAppType("mcp")?.demo;
  const auth = (parameters.auth ?? "").trim() || AUTH_BEARER;

  // A credential the server wants is asked for before anything has been read: it is the
  // whole reason nothing has been.
  const showAuthentication =
    Boolean(server) || problem?.kind === McpProblemKind.MCP_PROBLEM_UNAUTHORIZED || problem?.kind === McpProblemKind.MCP_PROBLEM_FORBIDDEN;

  return (
    <div className="flex max-w-[640px] flex-col gap-6">
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium text-foreground" htmlFor="mcp-url">
          MCP endpoint
        </label>

        <VariableSuggestInput
          id="mcp-url"
          value={url}
          onValueChange={(value) => {
            typedRef.current = true;
            setParameter("url", value);
          }}
          variables={variables}
          placeholder="https://example.com/mcp"
          disabled={readOnly}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              read({ fresh: true });
            }
          }}
        />

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

      {(server || showAuthentication) && (
        <>
          <div className="h-px bg-border" />

          {server && (
            <AppNameField
              id="mcp-name"
              name={name}
              onNameChange={(value) => {
                setNameTouched(true);
                onNameChange(value);
              }}
              duplicate={duplicateName}
              readOnly={readOnly}
              caption={nameTouched ? undefined : `From ${server.name ? "what the server calls itself" : "the endpoint"}. Rename if you'd rather.`}
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
      <div className="flex items-center gap-1.5">
        <p className="text-xs text-muted-foreground">Kaja asks the server what it exposes and turns each tool into a method.</p>
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
    <div className="flex flex-col gap-2">
      <div className="flex items-start gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2">
        <div className="pt-0.5 text-emerald-600 dark:text-emerald-400">
          <CircleCheck size={15} />
        </div>
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="text-sm text-foreground">
            {parts.join(" · ")}{" "}
            <span className="text-muted-foreground">
              from {server.name || "the server"}
              {server.version && ` ${server.version}`}
            </span>
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {eraLabel(server.protocolVersion, server.handshake)}
            {server.tools.length > 0 && ` · ${server.tools.map((tool) => tool.name).join(" · ")}`}
          </p>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1 text-muted-foreground">
          <IconButton icon={RefreshCw} aria-label="Read the server again" variant="ghost" size="xs" onClick={onRefresh} />
        </div>
      </div>
      {server.instructions && (
        <div className="flex items-start gap-2 rounded-md border border-border bg-card px-3 py-2">
          <div className="pt-0.5 text-muted-foreground">
            <Info size={15} />
          </div>
          <p className="line-clamp-3 text-xs leading-5 text-muted-foreground">{server.instructions}</p>
        </div>
      )}
    </div>
  );
}

function ProblemBanner({ problem, readOnly, onRetry }: { problem: McpProblem; readOnly: boolean; onRetry: () => void }) {
  const warning = problem.kind === McpProblemKind.MCP_PROBLEM_EMPTY || problem.kind === McpProblemKind.MCP_PROBLEM_UNAUTHORIZED;
  const Icon: LucideIcon = warning ? TriangleAlert : problem.kind === McpProblemKind.MCP_PROBLEM_NOT_MCP ? CircleAlert : CircleX;

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
  parameters: Record<string, string>;
  onParameterChange: (key: string, value: string) => void;
  variables: { [key: string]: string };
  readOnly: boolean;
}

// A fixed list: there is no document declaring what a server accepts, so the two
// shapes a credential comes in are offered outright.
function AuthenticationSection({ selected, onSelect, parameters, onParameterChange, variables, readOnly }: AuthenticationSectionProps) {
  return (
    <div className="flex flex-col gap-2">
      <label className="text-sm font-medium text-foreground">Authentication</label>
      <div role="radiogroup" aria-label="Authentication" className="flex flex-col gap-2">
        {authSchemes.map((scheme) => {
          const active = selected === scheme.key;
          const note = authNote(scheme.key, parameters.apiKeyName ?? "");
          return (
            <ChoiceCard key={scheme.key} selected={active}>
              <ChoiceRow selected={active} disabled={readOnly} onSelect={() => onSelect(scheme.key)} icon={scheme.key === AUTH_APIKEY ? Key : Blocks}>
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-sm text-foreground">{scheme.label}</span>
                  <span className="truncate text-xs text-muted-foreground">{scheme.summary}</span>
                </span>
              </ChoiceRow>
              {active && (
                <div className="flex flex-col gap-2 px-3 pb-3">
                  {scheme.key === AUTH_APIKEY && (
                    <VariableSuggestInput
                      value={parameters.apiKeyName ?? ""}
                      onValueChange={(value) => onParameterChange("apiKeyName", value)}
                      variables={variables}
                      placeholder={DEFAULT_API_KEY_NAME}
                      disabled={readOnly}
                    />
                  )}
                  <VariableSuggestInput
                    value={parameters.token ?? ""}
                    onValueChange={(value) => onParameterChange("token", value)}
                    variables={variables}
                    placeholder={scheme.key === AUTH_APIKEY ? "API key or ${VARIABLE}" : "Token or ${VARIABLE}"}
                    disabled={readOnly}
                  />
                  {note.text && <p className={cn("text-xs text-muted-foreground", note.mono && "font-mono")}>{note.text}</p>}
                </div>
              )}
            </ChoiceCard>
          );
        })}

        <ChoiceCard selected={selected === AUTH_NONE}>
          <ChoiceRow selected={selected === AUTH_NONE} disabled={readOnly} onSelect={() => onSelect(AUTH_NONE)} icon={ShieldOff}>
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-sm text-foreground">Send no credentials</span>
              <span className="truncate text-xs text-muted-foreground">For a server that is open, or guarded another way</span>
            </span>
          </ChoiceRow>
        </ChoiceCard>
      </div>
    </div>
  );
}
