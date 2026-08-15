import { Columns2, PanelLeftClose, PanelLeftOpen, Rows2, Search } from "lucide-react";
import { cn } from "./cn";
import { IconButton } from "./components/icon-button";
import { SimpleTooltip } from "./components/tooltip";

interface CommandRowProps {
  // Room the macOS traffic lights need when this row is what the window's left
  // corner lands on.
  leftInset: number;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  // The finder's trigger; it owns its own popover.
  finder: React.ReactNode;
  // Save and discard for the file being edited, next to its name. Absent
  // entirely once there is nothing to save — this is the pair you reach for
  // mid-edit, not a permanent fixture.
  fileActions?: React.ReactNode;
  // What you do with the current file: Run for a script, the JSON toggle for a
  // form. A file is never both, so they share the slot and the row keeps its
  // shape.
  action?: React.ReactNode;
  onSearch: () => void;
  layout: "vertical" | "horizontal";
  onToggleLayout: () => void;
}

// One 40px row instead of a top bar and a tab strip: sidebar toggle · finder ·
// the file's own save/discard · spacer · action · hairline · search · layout.
// Nothing else may be added to it — new controls go in the sidebar header or the
// console header.
//
// As the row narrows, things leave in order of what they are worth, the way the
// console header's do: the keyboard hint on Run first (there is no keyboard on
// the screen this narrows for), then the search icon, whose verb the trigger
// beside it already carries. The finder truncates through all of it, because
// with the sidebar collapsed it is the only thing saying where you are.
export function CommandRow({ leftInset, sidebarCollapsed, onToggleSidebar, finder, fileActions, action, onSearch, layout, onToggleLayout }: CommandRowProps) {
  const modifier = navigator.platform.startsWith("Mac") ? "⌘" : "Ctrl+";

  return (
    <div
      className="@container flex h-[40px] shrink-0 items-center gap-2 border-b border-border bg-chrome px-3"
      style={{ paddingLeft: leftInset, "--wails-draggable": "drag" } as React.CSSProperties}
    >
      {/* The left side is what may shrink, and the finder inside it is what
          truncates: the right side is buttons, and a button that has given up
          room is a button drawn over its neighbour. */}
      <div className="flex min-w-0 flex-1 items-center gap-2" style={{ "--wails-draggable": "no-drag" } as React.CSSProperties}>
        <SimpleTooltip text={sidebarCollapsed ? `Show sidebar (${modifier}B)` : `Hide sidebar (${modifier}B)`} side="bottom">
          <IconButton
            icon={sidebarCollapsed ? PanelLeftOpen : PanelLeftClose}
            aria-label={sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
            onClick={onToggleSidebar}
            size="sm"
            variant="ghost"
            className="size-[26px] shrink-0"
            tooltip={false}
          />
        </SimpleTooltip>
        {finder}
        {fileActions}
      </div>
      <div className="flex shrink-0 items-center gap-2" style={{ "--wails-draggable": "no-drag" } as React.CSSProperties}>
        {action}
        {action && <Hairline />}
        {/* The trigger beside it opens the same finder, so on a row this narrow
            the icon is the one thing here that says nothing new. */}
        <SimpleTooltip text={`Find a file (${modifier}K)`} side="bottom">
          <IconButton
            icon={Search}
            aria-label="Find a file"
            onClick={onSearch}
            size="sm"
            variant="ghost"
            className="size-[26px] @max-[380px]:hidden"
            tooltip={false}
          />
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
