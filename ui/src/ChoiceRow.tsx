import { Check, type LucideIcon } from "lucide-react";
import { cn } from "./cn";
import { PHONE_QUERY } from "./phone";
import { useMediaQuery } from "./useMediaQuery";

interface ChoiceRowProps {
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
  icon?: LucideIcon;
  children: React.ReactNode;
}

// ChoiceRow is one option in an app form's radio list - a server, a security
// scheme, a transport: a radio, an optional icon, and whatever the option has to
// say about itself. Shared by every app form so they read as one screen; it is not
// a design-system primitive, just the row all of them draw.
export function ChoiceRow({ selected, disabled, onSelect, icon: Icon, children }: ChoiceRowProps) {
  const phone = useMediaQuery(PHONE_QUERY);
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      className={cn("flex w-full items-center gap-3 px-3 py-1.5 text-left disabled:cursor-default", phone ? "min-h-11" : "min-h-10")}
    >
      {selected ? (
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-500 text-white">
          <Check size={13} strokeWidth={3} />
        </span>
      ) : (
        <span className="h-5 w-5 shrink-0 rounded-full border border-input" />
      )}
      {Icon && !phone && <Icon size={15} className="shrink-0 text-muted-foreground" />}
      {children}
    </button>
  );
}

// ChoiceCard wraps a ChoiceRow and whatever the selected option reveals under it.
// The chosen one is outlined so it reads from across the room; the others are
// borderless rows with a hairline between them.
export function ChoiceCard({ selected, children, className }: { selected: boolean; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn(selected ? "rounded-lg border-2 border-blue-500 bg-blue-500/10" : "border-b border-border last:border-b-0", className)}>{children}</div>
  );
}

// ChoiceBody is what the chosen option opens under its row.
export function ChoiceBody({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("flex flex-col gap-2 px-3 pb-3", className)}>{children}</div>;
}

// choiceLabel is the class of an option's own name: full strength when chosen.
export function choiceLabel(selected: boolean): string {
  return selected ? "text-sm font-medium text-foreground" : "text-sm text-muted-foreground";
}

// ChoiceList holds the options of one question.
export function ChoiceList({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2" role="radiogroup" aria-label={label}>
      {children}
    </div>
  );
}
