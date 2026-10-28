import { cn } from "./cn";
import { PHONE_QUERY } from "./phone";
import { useMediaQuery } from "./useMediaQuery";
import { VariableSuggestInput } from "./VariableSuggestInput";

interface BasicCredentialsProps {
  parameters: Record<string, string>;
  onParameterChange: (key: string, value: string) => void;
  variables: { [key: string]: string };
  readOnly: boolean;
}

// BasicCredentials is a username and password, side by side where a placeholder has
// room to name each and stacked under labels where it hasn't.
export function BasicCredentials({ parameters, onParameterChange, variables, readOnly }: BasicCredentialsProps) {
  const phone = useMediaQuery(PHONE_QUERY);
  return (
    <div className={cn(phone ? "flex flex-col gap-3" : "grid grid-cols-2 gap-3")}>
      {(["username", "password"] as const).map((key) => {
        const label = key === "username" ? "Username" : "Password";
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
