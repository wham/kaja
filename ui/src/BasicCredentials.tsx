import { cn } from "./cn";
import { PHONE_QUERY } from "./phone";
import { useMediaQuery } from "./useMediaQuery";
import { VariableSuggestInput } from "./VariableSuggestInput";

interface BasicCredentialsProps {
  parameters: Record<string, string>;
  onParameterChange: (key: string, value: string) => void;
  variables: { [key: string]: string };
  readOnly: boolean;
  fields?: readonly [CredentialField, CredentialField];
}

interface CredentialField {
  key: string;
  label: string;
}

const USERNAME_PASSWORD = [
  { key: "username", label: "Username" },
  { key: "password", label: "Password" },
] as const;

// BasicCredentials is a username and password, side by side where a placeholder has
// room to name each and stacked under labels where it hasn't.
export function BasicCredentials({ parameters, onParameterChange, variables, readOnly, fields = USERNAME_PASSWORD }: BasicCredentialsProps) {
  const phone = useMediaQuery(PHONE_QUERY);
  return (
    <div className={cn(phone ? "flex flex-col gap-3" : "grid grid-cols-2 gap-3")}>
      {fields.map(({ key, label }) => {
        return (
          <label key={key} className="flex min-w-0 flex-col gap-1.5">
            {phone && <span className="text-xs text-muted-foreground">{label}</span>}
            <VariableSuggestInput
              value={parameters[key] ?? ""}
              onValueChange={(value) => onParameterChange(key, value)}
              variables={variables}
              placeholder={phone ? undefined : label}
              disabled={readOnly}
            />
          </label>
        );
      })}
    </div>
  );
}
