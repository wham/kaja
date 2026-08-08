import { type LucideIcon } from "lucide-react";
import { cn } from "./cn";

interface ChoiceRowProps {
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
  icon?: LucideIcon;
  children: React.ReactNode;
}

// ChoiceRow is one option in an app form's radio list - a server, a security
// scheme, a transport: a radio, an optional icon, and whatever the option has to
// say about itself. Shared by the OpenAPI and gRPC forms so the two read as one
// screen; it is not a design-system primitive, just the row both of them draw.
export function ChoiceRow({ selected, disabled, onSelect, icon: Icon, children }: ChoiceRowProps) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      className="flex w-full items-center gap-3 px-3 py-2.5 text-left disabled:cursor-default"
    >
      {selected ? (
        <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-blue-500">
          <span className="h-2 w-2 rounded-full bg-blue-500" />
        </span>
      ) : (
        <span className="h-4 w-4 shrink-0 rounded-full border border-input" />
      )}
      {Icon && <Icon size={15} className="shrink-0 text-muted-foreground" />}
      {children}
    </button>
  );
}

// ChoiceCard wraps a ChoiceRow and whatever the selected option reveals under
// it, so the selection reads as one block rather than a row and a loose form.
export function ChoiceCard({ selected, children, className }: { selected: boolean; children: React.ReactNode; className?: string }) {
  return <div className={cn("rounded-md border", selected ? "border-blue-500/50 bg-accent" : "border-border", className)}>{children}</div>;
}
