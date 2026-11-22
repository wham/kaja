import { memo, useState } from "react";
import { CircleHelp, ExternalLink, GitBranch, Keyboard, Minus, Moon, Plus, Settings, Sun } from "lucide-react";
import { isWailsEnvironment, openInBrowser } from "./wails";
import { ErrorStatus } from "./ErrorStatus";
import { Popover, PopoverContent, PopoverTrigger } from "./components/popover";
import { SegmentedControl } from "./components/segmented-control";
import { Switch } from "./components/switch";
import { DEFAULT_ZOOM, type ZoomGesture } from "./zoom";
import { cn } from "./cn";
import { isIPhone } from "./phone";

export type ColorMode = "day" | "night";

export interface FeaturePreview {
  key: string;
  label: string;
  enabled: boolean;
}

interface SidebarFootProps {
  colorMode: ColorMode;
  onToggleColorMode: () => void;
  zoom: number;
  /** Absent where nothing can zoom the window: a browser zooms itself. */
  onZoom?: (gesture: ZoomGesture) => void;
  gitRef?: string;
  featurePreviews: FeaturePreview[];
  onToggleFeaturePreview: (key: string) => void;
  onShowShortcuts: () => void;
  phone?: boolean;
}

const FEEDBACK_URL = "https://github.com/wham/kaja/issues/new?template=feedback.yml";

function openExternal(url: string) {
  if (isWailsEnvironment()) openInBrowser(url);
  else window.open(url, "_blank", "noopener,noreferrer");
}

/**
 * The window's own settings, floating over the bottom of the sidebar rather than taking
 * a row of it. It is a zero-height block at the end of the column, so the controls hang
 * from it over the list and the list keeps the whole height.
 */
export const SidebarFoot = memo(function SidebarFoot({
  colorMode,
  onToggleColorMode,
  zoom,
  onZoom,
  gitRef,
  featurePreviews,
  onToggleFeaturePreview,
  onShowShortcuts,
  phone = false,
}: SidebarFootProps) {
  const [open, setOpen] = useState(false);
  const shortRef = gitRef ? (gitRef.length > 7 ? gitRef.slice(0, 7) : gitRef) : undefined;
  const close = (then: () => void) => () => {
    setOpen(false);
    then();
  };

  const row = cn("flex w-full items-center gap-2.5 rounded-md px-2 text-left text-foreground hover:bg-accent", phone ? "h-11 text-[15px]" : "h-8 text-[13px]");
  const label = cn("px-2 pt-2 pb-1 text-muted-foreground", phone ? "text-[13px]" : "text-xs");
  const icon = phone ? 18 : 15;

  return (
    <div className="relative h-0 shrink-0">
      <div
        className="absolute flex items-center gap-1.5"
        style={phone ? { left: 16, bottom: "max(12px, calc(env(safe-area-inset-bottom) - 8px))" } : { left: 12, bottom: 12 }}
      >
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className={cn(
                "flex items-center rounded-full border border-border bg-card text-muted-foreground shadow-md transition-colors hover:text-foreground data-[popup-open]:text-foreground",
                phone ? "h-11 gap-2 pr-4 pl-3.5 text-[15px]" : "h-8 gap-1.5 pr-3 pl-2.5 text-xs",
              )}
            >
              <Settings size={icon} className="shrink-0" />
              Settings
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" side="top" sideOffset={8} className={cn("rounded-xl p-1.5 shadow-xl", phone ? "w-[300px]" : "w-[256px]")}>
            <div className={label}>Theme</div>
            <SegmentedControl aria-label="Theme" className="flex w-full">
              {(["day", "night"] as const).map((mode) => (
                <SegmentedControl.Button
                  key={mode}
                  selected={colorMode === mode}
                  leadingIcon={mode === "day" ? Sun : Moon}
                  onClick={() => colorMode !== mode && onToggleColorMode()}
                  className={cn("flex-1 justify-center", phone ? "h-9 text-sm" : "text-xs")}
                >
                  {mode === "day" ? "Light" : "Dark"}
                </SegmentedControl.Button>
              ))}
            </SegmentedControl>
            {onZoom && (
              <>
                <div className={label}>Zoom</div>
                <div className="flex w-full items-center gap-0.5 rounded-md bg-muted p-0.5 text-xs">
                  <button
                    type="button"
                    aria-label="Zoom out"
                    onClick={() => onZoom("out")}
                    className="flex h-7 flex-1 items-center justify-center rounded text-muted-foreground hover:text-foreground"
                  >
                    <Minus size={14} />
                  </button>
                  <button
                    type="button"
                    title="Reset zoom"
                    disabled={zoom === DEFAULT_ZOOM}
                    onClick={() => onZoom("reset")}
                    className="flex h-7 flex-[2] items-center justify-center rounded bg-background font-mono tabular-nums text-foreground shadow-sm dark:bg-accent dark:shadow-none"
                  >
                    {zoom}%
                  </button>
                  <button
                    type="button"
                    aria-label="Zoom in"
                    onClick={() => onZoom("in")}
                    className="flex h-7 flex-1 items-center justify-center rounded text-muted-foreground hover:text-foreground"
                  >
                    <Plus size={14} />
                  </button>
                </div>
              </>
            )}
            {featurePreviews.length > 0 && (
              <>
                <div className={label}>Feature previews</div>
                {featurePreviews.map((feature) => {
                  const labelId = `feature-preview-${feature.key}`;
                  return (
                    <div key={feature.key} className={cn(row, "hover:bg-transparent")}>
                      <span id={labelId}>{feature.label}</span>
                      <Switch
                        className="ml-auto"
                        checked={feature.enabled}
                        aria-labelledby={labelId}
                        onCheckedChange={() => onToggleFeaturePreview(feature.key)}
                      />
                    </div>
                  );
                })}
              </>
            )}
            <div className="mx-1.5 my-1 h-px bg-border" />
            {/* An iPhone has no keyboard to press them on; a narrow browser window still does. */}
            {!isIPhone() && (
              <button type="button" className={row} onClick={close(onShowShortcuts)}>
                <Keyboard size={icon} className="text-muted-foreground" />
                Keyboard shortcuts
              </button>
            )}
            <button type="button" className={row} onClick={close(() => openExternal(FEEDBACK_URL))}>
              <CircleHelp size={icon} className="text-muted-foreground" />
              Send feedback
              <ExternalLink size={13} className="ml-auto text-muted-foreground" />
            </button>
            {gitRef && shortRef && (
              <>
                <div className="mx-1.5 my-1 h-px bg-border" />
                <button
                  type="button"
                  className={cn(row, "h-7 text-xs text-muted-foreground hover:text-foreground")}
                  onClick={close(() => openExternal(`https://github.com/wham/kaja/tree/${gitRef}`))}
                >
                  <GitBranch size={13} />
                  <span className="truncate font-mono">{shortRef}</span>
                  <span className="ml-auto shrink-0">View on GitHub</span>
                </button>
              </>
            )}
          </PopoverContent>
        </Popover>
        {/* Absent until Kaja has failed at something: news, not a setting, so it stands
            beside the menu rather than inside it. */}
        <ErrorStatus phone={phone} />
      </div>
    </div>
  );
});
