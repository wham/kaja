import { ChevronLeft, ChevronRight, type LucideIcon } from "lucide-react";
import { forwardRef } from "react";
import { cn } from "./cn";

// A phone's sidebar is read at arm's length and tapped with a thumb, so a row is the
// 44pt iOS asks a touch target to be and its name is at the body size iOS reads at.
export const PHONE_ROW = "flex min-h-11 w-full cursor-pointer select-none items-center gap-3 rounded-xl px-3 text-left text-[17px] outline-none";
export const PHONE_ICON = 20;

// The verbs at a row's right edge: a target a thumb finds without covering the name.
export const PHONE_ROW_ACTION = "flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground active:bg-accent [&_svg]:size-[18px]";

export function PhoneRowAction({ icon: Icon, label, onClick }: { icon: LucideIcon; label: string; onClick: (event: React.MouseEvent) => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      className={PHONE_ROW_ACTION}
      onClick={(event) => {
        event.stopPropagation();
        onClick(event);
      }}
    >
      <Icon />
    </button>
  );
}

interface PhoneRowProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "onClick"> {
  icon?: React.ReactNode;
  current?: boolean;
  // A row that opens a level rather than a file says so with the chevron iOS draws there.
  opens?: boolean;
  trailing?: React.ReactNode;
  onClick?: (event: React.MouseEvent) => void;
}

export const PhoneRow = forwardRef<HTMLDivElement, PhoneRowProps>(function PhoneRow(
  { icon, current, opens, trailing, onClick, className, children, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      role="button"
      tabIndex={0}
      aria-current={current || undefined}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) return;
        event.preventDefault();
        event.currentTarget.click();
      }}
      className={cn(PHONE_ROW, current ? "bg-accent text-accent-foreground" : "text-foreground active:bg-accent/60", className)}
      {...rest}
    >
      {icon !== undefined && <span className="flex size-6 shrink-0 items-center justify-center text-muted-foreground">{icon}</span>}
      <span className="flex min-w-0 flex-1 items-center gap-2">{children}</span>
      {trailing}
      {opens && <ChevronRight size={18} className="shrink-0 text-muted-foreground/60" />}
    </div>
  );
});

/** A group's name over its rows, the way a phone's own lists head a section. */
export function PhoneSection({ children, trailing }: { children: React.ReactNode; trailing?: React.ReactNode }) {
  return (
    <div className="flex min-h-9 items-center gap-2 px-3 pt-3 pb-1 text-[15px] text-muted-foreground">
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {trailing}
    </div>
  );
}

/**
 * What a level below the top opens with: the way back, named by where it goes, and the
 * level's own name under it, so a list of methods is never a list of nobody's.
 */
export function PhoneLevelHeader({
  back,
  onBack,
  icon,
  title,
  trailing,
}: {
  back: string;
  onBack: () => void;
  icon?: React.ReactNode;
  title: React.ReactNode;
  trailing?: React.ReactNode;
}) {
  return (
    <div className="pb-1">
      <button
        type="button"
        onClick={onBack}
        className="-ml-1 flex h-11 max-w-full items-center gap-0.5 rounded-xl pr-3 pl-1 text-[17px] text-muted-foreground outline-none active:bg-accent/60"
      >
        <ChevronLeft size={24} className="shrink-0" />
        <span className="truncate">{back}</span>
      </button>
      <div className="flex min-h-10 items-center gap-2.5 px-3">
        {icon}
        <h2 className="min-w-0 flex-1 truncate text-[22px] font-semibold text-foreground">{title}</h2>
        {trailing}
      </div>
    </div>
  );
}
