import { useRef, useState } from "react";
import { Input } from "./components/input";
import { cn } from "./cn";
import { environmentReferences, variableKind } from "./variableExpansion";

// variableSummary describes a variable in one line: its value when kaja.json
// carries it, and where the value comes from when it doesn't.
function variableSummary(value: string): string {
  switch (variableKind(value)) {
    case "stored":
      return "Stored on this machine";
    case "environment":
      return "From " + environmentReferences(value).join(", ");
    default:
      return value;
  }
}

// matchVariableReferencePrefix finds an unfinished ${NAME reference ending at
// the caret, returning where it starts and the name typed so far.
function matchVariableReferencePrefix(value: string, caret: number): { start: number; query: string } | null {
  const match = /\$\{([A-Za-z0-9_]*)$/.exec(value.slice(0, caret));
  return match ? { start: caret - match[0].length, query: match[1] } : null;
}

interface VariableSuggestInputProps {
  id?: string;
  value: string;
  onValueChange: (value: string) => void;
  variables: { [key: string]: string };
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  type?: string;
  trailingAction?: React.ReactNode;
  onKeyDown?: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  onBlur?: () => void;
}

// A text input that suggests the configured variables once the user types "${",
// completing the reference to ${NAME}.
export function VariableSuggestInput({
  id,
  value,
  onValueChange,
  variables,
  placeholder,
  disabled,
  className,
  type,
  trailingAction,
  onKeyDown: onKeyDownProp,
  onBlur,
}: VariableSuggestInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [suggestion, setSuggestion] = useState<{ start: number; query: string } | null>(null);
  const [highlightIndex, setHighlightIndex] = useState(0);

  const names = suggestion ? Object.keys(variables).filter((name) => name.toLowerCase().startsWith(suggestion.query.toLowerCase())) : [];
  const open = names.length > 0;

  const refreshSuggestion = () => {
    const input = inputRef.current;
    if (!input) return;
    const next = matchVariableReferencePrefix(input.value, input.selectionStart ?? 0);
    setSuggestion((prev) => {
      if (prev?.start !== next?.start || prev?.query !== next?.query) {
        setHighlightIndex(0);
        return next;
      }
      return prev;
    });
  };

  const insert = (name: string) => {
    const input = inputRef.current;
    if (!input || !suggestion) return;
    const caret = input.selectionStart ?? input.value.length;
    // Replace the unfinished ${query with ${name}, consuming a closing brace
    // the user may already have typed.
    let rest = value.slice(caret);
    if (rest.startsWith("}")) rest = rest.slice(1);
    onValueChange(value.slice(0, suggestion.start) + "${" + name + "}" + rest);
    setSuggestion(null);
    const position = suggestion.start + name.length + 3;
    requestAnimationFrame(() => inputRef.current?.setSelectionRange(position, position));
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open) {
      onKeyDownProp?.(e);
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIndex((prev) => (prev + (e.key === "ArrowDown" ? 1 : names.length - 1)) % names.length);
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      insert(names[highlightIndex]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setSuggestion(null);
    } else {
      onKeyDownProp?.(e);
    }
  };

  return (
    <div className="relative">
      <div className="relative">
        <Input
          ref={inputRef}
          id={id}
          type={type}
          value={value}
          onChange={(e) => {
            onValueChange(e.target.value);
            refreshSuggestion();
          }}
          onSelect={refreshSuggestion}
          onKeyDown={onKeyDown}
          onBlur={() => {
            setSuggestion(null);
            onBlur?.();
          }}
          placeholder={placeholder}
          disabled={disabled}
          className={cn(trailingAction ? "pr-9" : undefined, className)}
        />
        {trailingAction && <div className="absolute right-1 top-1/2 -translate-y-1/2">{trailingAction}</div>}
      </div>
      {open && (
        // Keep focus in the input so a click on a suggestion isn't lost to blur.
        <div
          onMouseDown={(e) => e.preventDefault()}
          className="absolute left-0 top-full z-10 mt-1 max-h-60 min-w-80 overflow-y-auto rounded-md border border-border bg-popover shadow-md"
        >
          {names.map((name, index) => (
            <button
              key={name}
              type="button"
              onClick={() => insert(name)}
              className={cn(
                "flex w-full flex-col items-start gap-0.5 px-3 py-1.5 text-left text-sm",
                index === highlightIndex ? "bg-accent text-accent-foreground" : "hover:bg-accent/50",
              )}
            >
              <span className="font-mono">{"${" + name + "}"}</span>
              <span className="text-xs text-muted-foreground">{variableSummary(variables[name])}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
