import { Columns2, PanelLeftClose, PanelLeftOpen, Rows2 } from "lucide-react";
import { cn } from "./cn";
import { IconButton } from "./components/icon-button";
import { SimpleTooltip } from "./components/tooltip";
import { useShortcutLabel } from "./shortcuts";

interface CommandRowProps {
  // Room the macOS traffic lights need when this row is what the window's left
  // corner lands on.
  leftInset: number | string;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  // The finder's trigger; it owns its own popover.
  finder: React.ReactNode;
  // Save and discard for the file being edited, next to its name. Absent
  // entirely once there is nothing to save — this is the pair you reach for
  // mid-edit, not a permanent fixture.
  fileActions?: React.ReactNode;
  // What you do with the current view: Run for a script, the view's own verb for
  // anything else. Each view has at most one, so the row keeps its shape.
  action?: React.ReactNode;
  // Where the editor ends when the console sits beside it. The row splits at the
  // same x, so the action lands at the editor's own corner rather than the
  // window's, which on a wide screen is a long way from the code it runs.
  editorWidth?: number;
  layout: "vertical" | "horizontal";
  onToggleLayout: () => void;
}

// One 40px row instead of a top bar and a tab strip: sidebar toggle · finder ·
// the file's own save/discard · spacer · action · hairline · layout. Nothing
// else may be added to it — new controls go on the band of the sidebar section
// they are about, or in the console header.
//
// There is no search icon here. It said nothing the finder trigger beside it
// doesn't already say, and once the sidebar's band grew a search of its own —
// over the scripts and the app tree, which is a different thing entirely — two
// magnifying glasses in one 40px line meant two different searches. The one that
// had a trigger beside it is the one that could go.
//
// As the row narrows, things leave in order of what they are worth, the way the
// console header's do: the keyboard hint on Run first, there being no keyboard
// on the screen this narrows for. The finder truncates through all of it,
// because with the sidebar collapsed it is the only thing saying where you are.
export function CommandRow({
  leftInset,
  sidebarCollapsed,
  onToggleSidebar,
  finder,
  fileActions,
  action,
  editorWidth,
  layout,
  onToggleLayout,
}: CommandRowProps) {
  const sidebarKey = useShortcutLabel("toggleSidebar");
  const sidebarHint = sidebarKey === "" ? "" : ` (${sidebarKey})`;
  const split = editorWidth !== undefined;

  return (
    <div
      className="@container flex h-[40px] shrink-0 items-center border-b border-border/70 bg-background"
      style={{ "--wails-draggable": "drag" } as React.CSSProperties}
    >
      <div
        className={cn("flex min-w-0 items-center gap-2 pr-3", !split && "flex-1 pr-2")}
        style={{ paddingLeft: leftInset, width: editorWidth } as React.CSSProperties}
      >
        {/* The left side is what may shrink, and the finder inside it is what
            truncates: the right side is buttons, and a button that has given up
            room is a button drawn over its neighbour. */}
        <div className="flex min-w-0 flex-1 items-center gap-2" style={{ "--wails-draggable": "no-drag" } as React.CSSProperties}>
          <SimpleTooltip text={sidebarCollapsed ? `Show sidebar${sidebarHint}` : `Hide sidebar${sidebarHint}`} side="bottom">
            <IconButton
              icon={sidebarCollapsed ? PanelLeftOpen : PanelLeftClose}
              aria-label={sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
              onClick={onToggleSidebar}
              size="sm"
              variant="ghost"
              className="size-[26px] shrink-0"
              tooltip="none"
            />
          </SimpleTooltip>
          {finder}
          {fileActions}
        </div>
        {action && (
          <div className="flex shrink-0 items-center gap-2" style={{ "--wails-draggable": "no-drag" } as React.CSSProperties}>
            {action}
            {!split && <Hairline />}
          </div>
        )}
      </div>
      <div className={cn("flex shrink-0 items-center pr-3", split && "flex-1 justify-end")}>
        <SimpleTooltip text={layout === "vertical" ? "Side-by-side layout" : "Top-bottom layout"} side="bottom">
          <IconButton
            icon={layout === "vertical" ? Columns2 : Rows2}
            aria-label={layout === "vertical" ? "Switch to side-by-side layout" : "Switch to top-bottom layout"}
            onClick={onToggleLayout}
            size="sm"
            variant="ghost"
            className="size-[26px]"
            style={{ "--wails-draggable": "no-drag" } as React.CSSProperties}
            tooltip="none"
          />
        </SimpleTooltip>
      </div>
    </div>
  );
}

function Hairline({ className }: { className?: string }) {
  return <div className={cn("h-[14px] w-px shrink-0 bg-border", className)} />;
}
