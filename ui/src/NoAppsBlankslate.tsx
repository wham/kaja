import { Plus } from "lucide-react";

import { cn } from "./cn";

interface NoAppsBlankslateProps {
  onNewAppClick?: () => void;
  phone?: boolean;
}

export function NoAppsBlankslate({ onNewAppClick, phone = false }: NoAppsBlankslateProps) {
  return (
    <div className={cn("flex flex-col items-center text-center", phone ? "gap-1.5 px-6 pt-10" : "gap-1 px-4 pt-6")}>
      <p className={cn("m-0 font-medium text-foreground", phone ? "text-[16px]" : "text-[13px]")}>No apps yet</p>
      <p className={cn("m-0 text-pretty text-muted-foreground", phone ? "text-[14px] leading-[1.4]" : "text-xs leading-[1.5]")}>
        An app is an API your scripts call: gRPC, OpenAPI or MCP
      </p>
      <button
        type="button"
        onClick={onNewAppClick}
        className={cn(
          "inline-flex items-center justify-center gap-1.5 rounded-md bg-primary font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          phone ? "mt-4 h-11 rounded-full px-5 text-[15px] active:bg-primary/90" : "mt-3 h-7 px-3 text-xs",
        )}
      >
        <Plus size={phone ? 17 : 14} />
        New app
      </button>
    </div>
  );
}
