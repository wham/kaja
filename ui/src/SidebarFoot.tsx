import { memo, useState, type ReactNode } from "react";
import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { CircleHelp, ExternalLink, GitBranch, Keyboard, Minus, Moon, Plus, Settings, Sun, X } from "lucide-react";
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

  if (phone) {
    return (
      <PhoneSettings
        open={open}
        onOpenChange={setOpen}
        close={close}
        colorMode={colorMode}
        onToggleColorMode={onToggleColorMode}
        zoom={zoom}
        onZoom={onZoom}
        gitRef={gitRef}
        shortRef={shortRef}
        featurePreviews={featurePreviews}
        onToggleFeaturePreview={onToggleFeaturePreview}
        onShowShortcuts={onShowShortcuts}
      />
    );
  }

  const row = "flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-left text-[13px] text-foreground hover:bg-accent";
  const label = "px-2 pt-2 pb-1 text-xs text-muted-foreground";
  const icon = 15;

  return (
    <div className="relative h-0 shrink-0">
      <div className="absolute flex items-center gap-1.5" style={{ left: 12, bottom: 12 }}>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="flex h-8 items-center gap-1.5 rounded-full border border-border bg-card pr-3 pl-2.5 text-xs text-muted-foreground shadow-md transition-colors hover:text-foreground data-[popup-open]:text-foreground"
            >
              <Settings size={icon} className="shrink-0" />
              Settings
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" side="top" sideOffset={8} className="w-[256px] rounded-xl p-1.5 shadow-xl">
            <div className={label}>Theme</div>
            <SegmentedControl aria-label="Theme" className="flex w-full">
              {(["day", "night"] as const).map((mode) => (
                <SegmentedControl.Button
                  key={mode}
                  selected={colorMode === mode}
                  leadingIcon={mode === "day" ? Sun : Moon}
                  onClick={() => colorMode !== mode && onToggleColorMode()}
                  className="flex-1 justify-center text-xs"
                >
                  {mode === "day" ? "Light" : "Dark"}
                </SegmentedControl.Button>
              ))}
            </SegmentedControl>
            {onZoom && (
              <>
                <div className={label}>Zoom</div>
                <ZoomControl zoom={zoom} onZoom={onZoom} />
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
        <ErrorStatus />
      </div>
    </div>
  );
});

function ZoomControl({ zoom, onZoom }: { zoom: number; onZoom: (gesture: ZoomGesture) => void }) {
  return (
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
  );
}

interface PhoneSettingsProps extends Omit<SidebarFootProps, "phone"> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  close: (then: () => void) => () => void;
  shortRef?: string;
}

function PhoneGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section>
      <div className="px-4 pt-5 pb-1.5 text-[13px] text-muted-foreground">{label}</div>
      <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-background">{children}</div>
    </section>
  );
}

const phoneRow = "flex min-h-12 w-full items-center gap-3 px-4 text-left text-[15px] text-foreground active:bg-accent";

function PhoneSettings({
  open,
  onOpenChange,
  close,
  colorMode,
  onToggleColorMode,
  zoom,
  onZoom,
  gitRef,
  shortRef,
  featurePreviews,
  onToggleFeaturePreview,
  onShowShortcuts,
}: PhoneSettingsProps) {
  return (
    <div className="relative h-0 shrink-0">
      <div className="absolute flex items-center gap-1.5" style={{ left: 16, bottom: "max(12px, calc(env(safe-area-inset-bottom) - 8px))" }}>
        <BaseDialog.Root open={open} onOpenChange={onOpenChange}>
          <BaseDialog.Trigger className="flex h-11 items-center gap-2 rounded-full border border-border bg-card pr-4 pl-3.5 text-[15px] text-muted-foreground shadow-md transition-colors data-[popup-open]:text-foreground">
            <Settings size={18} className="shrink-0" />
            Settings
          </BaseDialog.Trigger>
          <BaseDialog.Portal>
            <BaseDialog.Backdrop className="fixed inset-0 z-50 bg-black/55 transition-opacity duration-200 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
            <BaseDialog.Popup
              aria-label="Settings"
              initialFocus={false}
              className="fixed inset-x-0 bottom-0 z-50 flex max-h-[calc(100dvh-env(safe-area-inset-top)-40px)] flex-col rounded-t-[14px] border-t border-border bg-popover text-popover-foreground shadow-lg outline-none transition-transform duration-200 data-[ending-style]:translate-y-full data-[starting-style]:translate-y-full"
            >
              <div className="relative flex h-14 shrink-0 items-center justify-center px-4">
                <BaseDialog.Title className="text-[17px] font-semibold">Settings</BaseDialog.Title>
                <BaseDialog.Close
                  aria-label="Close"
                  className="absolute right-4 flex size-[44px] items-center justify-center rounded-full border border-border bg-background text-foreground outline-none active:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X size={20} />
                </BaseDialog.Close>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4" style={{ paddingBottom: "max(16px, env(safe-area-inset-bottom))" }}>
                <PhoneGroup label="Appearance">
                  <div className="p-2">
                    <SegmentedControl aria-label="Theme" className="flex w-full">
                      {(["day", "night"] as const).map((mode) => (
                        <SegmentedControl.Button
                          key={mode}
                          selected={colorMode === mode}
                          leadingIcon={mode === "day" ? Sun : Moon}
                          onClick={() => colorMode !== mode && onToggleColorMode()}
                          className="h-9 flex-1 justify-center text-sm"
                        >
                          {mode === "day" ? "Light" : "Dark"}
                        </SegmentedControl.Button>
                      ))}
                    </SegmentedControl>
                  </div>
                  {onZoom && (
                    <div className="p-2">
                      <ZoomControl zoom={zoom} onZoom={onZoom} />
                    </div>
                  )}
                </PhoneGroup>
                {featurePreviews.length > 0 && (
                  <PhoneGroup label="Feature previews">
                    {featurePreviews.map((feature) => {
                      const labelId = `feature-preview-${feature.key}`;
                      return (
                        <div key={feature.key} className={cn(phoneRow, "active:bg-transparent")}>
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
                  </PhoneGroup>
                )}
                <PhoneGroup label="About">
                  {!isIPhone() && (
                    <button type="button" className={phoneRow} onClick={close(onShowShortcuts)}>
                      <Keyboard size={18} className="text-muted-foreground" />
                      Keyboard shortcuts
                    </button>
                  )}
                  <button type="button" className={phoneRow} onClick={close(() => openExternal(FEEDBACK_URL))}>
                    <CircleHelp size={18} className="text-muted-foreground" />
                    Send feedback
                    <ExternalLink size={15} className="ml-auto text-muted-foreground" />
                  </button>
                  {gitRef && shortRef && (
                    <button type="button" className={phoneRow} onClick={close(() => openExternal(`https://github.com/wham/kaja/tree/${gitRef}`))}>
                      <GitBranch size={18} className="text-muted-foreground" />
                      View on GitHub
                      <span className="ml-auto truncate font-mono text-sm text-muted-foreground">{shortRef}</span>
                    </button>
                  )}
                </PhoneGroup>
              </div>
            </BaseDialog.Popup>
          </BaseDialog.Portal>
        </BaseDialog.Root>
        <ErrorStatus phone />
      </div>
    </div>
  );
}
