import type { LucideIcon } from "lucide-react";

import { cn } from "./cn";

interface SidebarBlankslateProps {
  title: string;
  description: string;
  action: { label: string; icon?: LucideIcon; onClick?: () => void; outline?: boolean };
  phone?: boolean;
}

export function SidebarBlankslate({ title, description, action, phone = false }: SidebarBlankslateProps) {
  const Icon = action.icon;
  return (
    <div className={cn("flex flex-col items-center text-center", phone ? "gap-1.5 px-6 pt-10" : "gap-1 px-4 pt-6")}>
      <p className={cn("m-0 font-medium text-foreground", phone ? "text-[16px]" : "text-[13px]")}>{title}</p>
      <p className={cn("m-0 text-pretty text-muted-foreground", phone ? "text-[14px] leading-[1.4]" : "text-xs leading-[1.5]")}>{description}</p>
      <button
        type="button"
        onClick={action.onClick}
        className={cn(
          "inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          action.outline
            ? "border border-border bg-transparent text-foreground hover:bg-accent active:bg-accent"
            : "bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/90",
          phone ? "mt-4 h-11 rounded-full px-5 text-[15px]" : "mt-3 h-7 px-3 text-xs",
        )}
      >
        {Icon && <Icon size={phone ? 17 : 14} />}
        {action.label}
      </button>
    </div>
  );
}
