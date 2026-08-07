import { Columns2, PanelLeftClose, PanelLeftOpen, Rows2, Search } from "lucide-react";
import { cn } from "./cn";
import { IconButton } from "./components/icon-button";
import { SimpleTooltip } from "./components/tooltip";
import { useMediaQuery } from "./useMediaQuery";

// The chips are a shortcut, not a tab strip: they give up room before anything
// else on the row does, last chip first.
const TWO_CHIPS_MIN_WIDTH = 900;
const ONE_CHIP_MIN_WIDTH = 760;

export interface RecentChip {
  id: string;
  name: string;
}

interface CommandRowProps {
  // Room the macOS traffic lights need when this row is what the window's left
  // corner lands on.
  leftInset: number;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  // The finder's trigger; it owns its own popover.
  finder: React.ReactNode;
  // The two most recently visited files other than the current one.
  recent: RecentChip[];
  onSelectRecent: (id: string) => void;
  // What you do with the current file: Run for a script, the JSON toggle for a
  // form. A file is never both, so they share the slot and the row keeps its
  // shape.
  action?: React.ReactNode;
  onSearch: () => void;
  layout: "vertical" | "horizontal";
  onToggleLayout: () => void;
}

// One 40px row instead of a top bar and a tab strip: sidebar toggle · finder ·
// hairline · recent chips · spacer · action · hairline · search · layout.
// Nothing else may be added to it — new controls go in the sidebar header or the
// console header.
export function CommandRow({
  leftInset,
  sidebarCollapsed,
  onToggleSidebar,
  finder,
  recent,
  onSelectRecent,
  action,
  onSearch,
  layout,
  onToggleLayout,
}: CommandRowProps) {
  const wide = useMediaQuery(`(min-width: ${TWO_CHIPS_MIN_WIDTH}px)`);
  const roomForChips = useMediaQuery(`(min-width: ${ONE_CHIP_MIN_WIDTH}px)`);
  const chips = roomForChips ? recent.slice(0, wide ? 2 : 1) : [];
  const modifier = navigator.platform.startsWith("Mac") ? "⌘" : "Ctrl+";

  return (
    <div
      className="flex h-[40px] shrink-0 items-center gap-2 border-b border-border bg-chrome px-3"
      style={{ paddingLeft: leftInset, "--wails-draggable": "drag" } as React.CSSProperties}
    >
      <div className="flex min-w-0 items-center gap-2" style={{ "--wails-draggable": "no-drag" } as React.CSSProperties}>
        <SimpleTooltip text={sidebarCollapsed ? `Show sidebar (${modifier}B)` : `Hide sidebar (${modifier}B)`} side="bottom">
          <IconButton
            icon={sidebarCollapsed ? PanelLeftOpen : PanelLeftClose}
            aria-label={sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
            onClick={onToggleSidebar}
            size="sm"
            variant="ghost"
            className="size-[26px]"
            tooltip={false}
          />
        </SimpleTooltip>
        {finder}
        {chips.length > 0 && <Hairline />}
        {chips.map((chip) => (
          <button
            key={chip.id}
            type="button"
            onClick={() => onSelectRecent(chip.id)}
            className="flex h-[26px] max-w-[160px] shrink-0 items-center gap-1.5 rounded-md px-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <span className="truncate">{chip.name}</span>
          </button>
        ))}
      </div>
      <div className="flex-1" />
      <div className="flex shrink-0 items-center gap-2" style={{ "--wails-draggable": "no-drag" } as React.CSSProperties}>
        {action}
        {action && <Hairline />}
        <SimpleTooltip text={`Find a file (${modifier}K)`} side="bottom">
          <IconButton icon={Search} aria-label="Find a file" onClick={onSearch} size="sm" variant="ghost" className="size-[26px]" tooltip={false} />
        </SimpleTooltip>
        <SimpleTooltip text={layout === "vertical" ? "Side-by-side layout" : "Top-bottom layout"} side="bottom">
          <IconButton
            icon={layout === "vertical" ? Columns2 : Rows2}
            aria-label={layout === "vertical" ? "Switch to side-by-side layout" : "Switch to top-bottom layout"}
            onClick={onToggleLayout}
            size="sm"
            variant="ghost"
            className="size-[26px]"
            tooltip={false}
          />
        </SimpleTooltip>
      </div>
    </div>
  );
}

function Hairline({ className }: { className?: string }) {
  return <div className={cn("h-[14px] w-px shrink-0 bg-border", className)} />;
}
