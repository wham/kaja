import { ChevronLeft, ChevronRight, KeyRound, SquareTerminal, Type, type LucideIcon } from "lucide-react";
import { type ReactNode, type Ref } from "react";
import { cn } from "./cn";
import { Input } from "./components/input";
import { SegmentedControl } from "./components/segmented-control";
import { Spinner } from "./components/spinner";
import { VariableKind } from "./variableExpansion";

export const KIND_ICON: Record<VariableKind, LucideIcon> = {
  value: Type,
  stored: KeyRound,
  environment: SquareTerminal,
};

export function PhoneGroup({ heading, footer, children }: { heading?: ReactNode; footer?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex shrink-0 flex-col pb-6">
      {heading && <h2 className="px-4 pb-1.5 text-xs uppercase tracking-wide text-muted-foreground">{heading}</h2>}
      <div className="overflow-hidden rounded-xl border border-border bg-card dark:border-transparent">{children}</div>
      {footer && <p className="px-4 pt-1.5 text-xs text-muted-foreground">{footer}</p>}
    </section>
  );
}

// A separator starts where the text does, so an icon column reads as one strip.
export function PhoneRow({
  icon,
  title,
  mono,
  subtitle,
  trailing,
  chevron,
  tone,
  onClick,
}: {
  icon?: ReactNode;
  title: ReactNode;
  mono?: boolean;
  subtitle?: ReactNode;
  trailing?: ReactNode;
  chevron?: boolean;
  tone?: "destructive";
  onClick?: () => void;
}) {
  const body = (
    <>
      {icon && <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">{icon}</span>}
      <span
        className={cn(
          "flex min-h-[48px] min-w-0 flex-1 items-center gap-2 py-2 pr-3",
          "[[data-phone-row]+[data-phone-row]_&]:border-t [[data-phone-row]+[data-phone-row]_&]:border-border",
        )}
      >
        <span className={cn("flex min-w-0 flex-1 flex-col", tone && "items-center")}>
          <span className={cn("truncate text-[15px]", mono && "font-mono text-sm", tone === "destructive" && "text-destructive")}>{title}</span>
          {subtitle && <span className="flex min-w-0 items-center gap-1.5 truncate text-[13px] text-muted-foreground">{subtitle}</span>}
        </span>
        {trailing && <span className="flex shrink-0 items-center text-[15px] text-muted-foreground">{trailing}</span>}
        {chevron && <ChevronRight size={16} className="shrink-0 text-muted-foreground/60" />}
      </span>
    </>
  );
  const className = "flex w-full items-center gap-3 pl-4 text-left outline-none";
  if (!onClick)
    return (
      <div data-phone-row className={className}>
        {body}
      </div>
    );
  return (
    <button data-phone-row type="button" onClick={onClick} className={cn(className, "active:bg-accent focus-visible:bg-accent")}>
      {body}
    </button>
  );
}

export function UnsetMark({ children }: { children: ReactNode }) {
  return (
    <>
      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-amber-500" />
      <span className="truncate text-amber-600 dark:text-amber-400">{children}</span>
    </>
  );
}

export interface PhoneUse {
  key: string;
  label: string;
  detail: string;
  mono?: boolean;
  onSelect?: () => void;
}

interface PhoneVariableDetailProps {
  name: string;
  value: string;
  kind: VariableKind;
  sources: { kind: VariableKind; label: string }[];
  error?: string;
  readOnly: boolean;
  // What the stored or environment source says about the value, in place of a field.
  storedState?: { label: ReactNode; unset: boolean; action?: { label: string; onClick: () => void } };
  caption?: ReactNode;
  uses: PhoneUse[] | "scanning" | "failed";
  nameRef?: Ref<HTMLInputElement>;
  onBack: () => void;
  onName: (name: string) => void;
  onValue: (value: string) => void;
  onSource: (kind: VariableKind) => void;
  onDelete: () => void;
}

// A variable's own screen, pushed from the list the way a row in Settings is.
export function PhoneVariableDetail({
  name,
  value,
  kind,
  sources,
  error,
  readOnly,
  storedState,
  caption,
  uses,
  nameRef,
  onBack,
  onName,
  onValue,
  onSource,
  onDelete,
}: PhoneVariableDetailProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto px-4 pb-8">
      <button type="button" onClick={onBack} className="-ml-1.5 flex h-11 shrink-0 items-center gap-0.5 self-start text-[15px] outline-none">
        <ChevronLeft size={22} />
        Variables
      </button>

      <PhoneGroup heading="Name">
        {readOnly ? (
          <PhoneRow title={name} mono />
        ) : (
          <div className="flex min-h-[48px] items-center px-4">
            <Input
              ref={nameRef}
              value={name}
              onChange={(e) => onName(e.target.value)}
              placeholder="API_BASE_URL"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              className="h-auto border-0 bg-transparent p-0 font-mono text-base shadow-none focus-visible:ring-0 dark:bg-transparent"
            />
          </div>
        )}
      </PhoneGroup>

      <section className="flex shrink-0 flex-col pb-6">
        <h2 className="px-4 pb-1.5 text-xs uppercase tracking-wide text-muted-foreground">Source</h2>
        <SegmentedControl aria-label="Where the value comes from" className="flex w-full rounded-lg p-0.5">
          {sources.map((source) => (
            <SegmentedControl.Button
              key={source.kind}
              selected={kind === source.kind}
              disabled={readOnly && kind !== source.kind}
              onClick={() => onSource(source.kind)}
              className="flex-1 justify-center py-1.5 text-[13px]"
            >
              {source.label}
            </SegmentedControl.Button>
          ))}
        </SegmentedControl>
      </section>

      <PhoneGroup heading="Value" footer={error ? <span className="text-destructive">{error}</span> : caption}>
        {storedState ? (
          <PhoneRow
            title={storedState.unset ? <UnsetMark>{storedState.label}</UnsetMark> : storedState.label}
            trailing={storedState.action && <span className="font-medium text-foreground">{storedState.action.label}</span>}
            onClick={storedState.action?.onClick}
          />
        ) : readOnly ? (
          <PhoneRow title={value} mono />
        ) : (
          <div className="flex min-h-[48px] items-center px-4">
            <Input
              value={value}
              onChange={(e) => onValue(e.target.value)}
              placeholder={kind === "environment" ? "${env:HOST}" : "https://api.example.com"}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              className="h-auto border-0 bg-transparent p-0 font-mono text-base shadow-none focus-visible:ring-0 dark:bg-transparent"
            />
          </div>
        )}
      </PhoneGroup>

      {name.trim() && (
        <PhoneGroup heading="Used by">
          {uses === "scanning" ? (
            <PhoneRow title={<span className="text-muted-foreground">Scanning scripts</span>} trailing={<Spinner className="size-4" />} />
          ) : uses === "failed" ? (
            <PhoneRow title={<span className="text-muted-foreground">Scripts couldn't be scanned</span>} />
          ) : uses.length === 0 ? (
            <PhoneRow title={<span className="text-muted-foreground">Nothing references it yet</span>} />
          ) : (
            uses.map((use) => (
              <PhoneRow key={use.key} title={use.label} mono={use.mono} trailing={use.detail} chevron={Boolean(use.onSelect)} onClick={use.onSelect} />
            ))
          )}
        </PhoneGroup>
      )}

      {!readOnly && (
        <PhoneGroup>
          <PhoneRow title="Delete Variable" tone="destructive" onClick={onDelete} />
        </PhoneGroup>
      )}
    </div>
  );
}
