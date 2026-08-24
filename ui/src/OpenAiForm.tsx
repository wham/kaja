import { Bot, Globe, Key, KeyRound, ShieldOff, Sparkles, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AppNameField } from "./AppNameField";
import { ChoiceCard, ChoiceRow } from "./ChoiceRow";
import { VariableSuggestInput } from "./VariableSuggestInput";
import { AppSurface } from "./appTypes";
import { cn } from "./cn";
import {
  AUTH_APIKEY,
  AUTH_BEARER,
  AUTH_NONE,
  CHOICE_ANTHROPIC,
  CHOICE_COMPATIBLE,
  CHOICE_OPENAI,
  DEFAULT_API_KEY_NAME,
  apiChoices,
  authNote,
  authSchemes,
  deriveAppName,
  getApiChoice,
  isUsableEndpoint,
  matchApiChoice,
  uniqueAppName,
} from "./chatApi";

// The app adds exactly one method, whichever API it speaks, so the footer's receipt
// is a constant rather than something read off a server.
const SURFACE: AppSurface = { count: 1 };

const CHOICE_ICONS: Record<string, LucideIcon> = {
  [CHOICE_OPENAI]: Sparkles,
  [CHOICE_ANTHROPIC]: Bot,
  [CHOICE_COMPATIBLE]: Globe,
};

interface OpenAiFormProps {
  name: string;
  onNameChange: (name: string) => void;
  duplicateName: boolean;
  // So a derived name doesn't land on a collision the user has to resolve by hand.
  takenNames: string[];
  parameters: Record<string, string>;
  onParametersChange: (update: (previous: Record<string, string>) => Record<string, string>) => void;
  variables: { [key: string]: string };
  readOnly?: boolean;
  onSurfaceChange: (surface: AppSurface | undefined) => void;
  onReadyChange: (ready: boolean) => void;
}

// OpenAiForm asks for one thing - which API, and where it is - and everything after
// it is a choice between things that answer already declares. There is nothing to
// read: no chat endpoint describes itself, so unlike the gRPC, OpenAPI and MCP forms
// this one settles at the first call rather than before the app is made.
export function OpenAiForm({
  name,
  onNameChange,
  duplicateName,
  takenNames,
  parameters,
  onParametersChange,
  variables,
  readOnly = false,
  onSurfaceChange,
  onReadyChange,
}: OpenAiFormProps) {
  const [choice, setChoice] = useState(() => matchApiChoice(parameters.api ?? "", parameters.endpoint ?? ""));
  const [nameTouched, setNameTouched] = useState(() => Boolean(name.trim()));
  const takenRef = useRef(takenNames);
  takenRef.current = takenNames;

  const endpoint = parameters.endpoint ?? "";
  const auth = parameters.auth || getApiChoice(choice).auth;
  const ready = isUsableEndpoint(endpoint);

  useEffect(() => {
    onReadyChange(ready);
    onSurfaceChange(ready ? SURFACE : undefined);
  }, [ready, onReadyChange, onSurfaceChange]);

  const setParameter = (key: string, value: string) => {
    onParametersChange((previous) => ({ ...previous, [key]: value }));
  };

  // The endpoint is prefilled rather than fixed, so a gateway serving the same API
  // is a matter of editing the field the row just filled.
  const selectChoice = (key: string) => {
    setChoice(key);
    const picked = getApiChoice(key);
    onParametersChange((previous) => ({ ...previous, api: picked.api, endpoint: picked.endpoint, auth: picked.auth }));
    if (!nameTouched) {
      onNameChange(uniqueAppName(deriveAppName(key, picked.endpoint), takenRef.current));
    }
  };

  // A new app opens on the first row with that row already applied, so what the
  // form shows and what it would save are the same thing before anything is
  // clicked. An app being edited already holds its own values, and a legacy one
  // that names no API keeps the endpoint it was made with.
  const seed = useRef(!name.trim() && !endpoint.trim() && !(parameters.api ?? "").trim());
  useEffect(() => {
    if (!seed.current) return;
    seed.current = false;
    selectChoice(choice);
    // Mount only: this is the starting point, not something to re-apply.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex max-w-[640px] flex-col gap-6">
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium text-foreground">API</label>
        <div role="radiogroup" aria-label="API" className="flex flex-col gap-2">
          {apiChoices.map((option) => {
            const active = choice === option.key;
            return (
              <ChoiceCard key={option.key} selected={active}>
                <ChoiceRow selected={active} disabled={readOnly} onSelect={() => selectChoice(option.key)} icon={CHOICE_ICONS[option.key]}>
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-sm text-foreground">{option.label}</span>
                    <span className="truncate text-xs text-muted-foreground">{option.summary}</span>
                  </span>
                </ChoiceRow>
                {active && (
                  <div className="flex flex-col gap-2 px-3 pb-3">
                    <VariableSuggestInput
                      id="openai-endpoint"
                      value={endpoint}
                      onValueChange={(value) => {
                        setParameter("endpoint", value);
                        if (!nameTouched && option.key === CHOICE_COMPATIBLE) {
                          onNameChange(uniqueAppName(deriveAppName(option.key, value), takenRef.current));
                        }
                      }}
                      variables={variables}
                      placeholder={option.endpoint || "https://llm.example.com/v1/chat/completions"}
                      disabled={readOnly}
                    />
                    <p className="text-xs text-muted-foreground">Kaja POSTs every call here. Change it for a gateway or a proxy serving the same API.</p>
                  </div>
                )}
              </ChoiceCard>
            );
          })}
        </div>
      </div>

      {ready && (
        <>
          <div className="h-px bg-border" />

          <AppNameField
            id="openai-name"
            name={name}
            onNameChange={(value) => {
              setNameTouched(true);
              onNameChange(value);
            }}
            duplicate={duplicateName}
            readOnly={readOnly}
            caption={nameTouched ? undefined : "From the API. Rename if you'd rather."}
          />

          <AuthenticationSection
            selected={auth}
            onSelect={(value) => setParameter("auth", value)}
            parameters={parameters}
            onParameterChange={setParameter}
            variables={variables}
            readOnly={readOnly}
          />
        </>
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

// The same fixed list the MCP form offers, for the same reason: nothing declares
// what the endpoint accepts.
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
              <ChoiceRow selected={active} disabled={readOnly} onSelect={() => onSelect(scheme.key)} icon={scheme.key === AUTH_APIKEY ? Key : KeyRound}>
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
                    placeholder="API key or ${VARIABLE}"
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
              <span className="truncate text-xs text-muted-foreground">For a local model, or an endpoint guarded another way</span>
            </span>
          </ChoiceRow>
        </ChoiceCard>
      </div>
    </div>
  );
}
