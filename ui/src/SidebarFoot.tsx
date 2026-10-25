import { memo } from "react";
import { CircleHelp, GitBranch, Keyboard, Moon, Sun } from "lucide-react";
import { IconButton } from "./components/icon-button";
import { isWailsEnvironment, openInBrowser } from "./wails";
import { FeaturePreview, FeaturePreviews } from "./FeaturePreviews";
import { ErrorStatus, useAppErrors } from "./ErrorStatus";
import { DEFAULT_ZOOM } from "./zoom";

export type ColorMode = "day" | "night";

const footIconClass = "size-7 rounded-[7px] text-muted-foreground hover:text-foreground [&_svg]:size-[15px]";

interface SidebarFootProps {
  colorMode: ColorMode;
  onToggleColorMode: () => void;
  zoom: number;
  onResetZoom: () => void;
  gitRef?: string;
  featurePreviews: FeaturePreview[];
  onToggleFeaturePreview: (key: string) => void;
  onShowShortcuts: () => void;
}

const FEEDBACK_URL = "https://github.com/wham/kaja/issues/new?template=feedback.yml";

function openExternal(url: string) {
  if (isWailsEnvironment()) openInBrowser(url);
  else window.open(url, "_blank", "noopener,noreferrer");
}

/**
 * What the status bar said, at the foot of the sidebar: which build this is on the
 * left, the window's own settings on the right. The compile status is on the Apps tab
 * instead, since it reports on the apps.
 */
export const SidebarFoot = memo(function SidebarFoot({
  colorMode,
  onToggleColorMode,
  zoom,
  onResetZoom,
  gitRef,
  featurePreviews,
  onToggleFeaturePreview,
  onShowShortcuts,
}: SidebarFootProps) {
  const appErrors = useAppErrors();
  const shortRef = gitRef ? (gitRef.length > 7 ? gitRef.slice(0, 7) : gitRef) : undefined;

  return (
    <div className="flex h-10 shrink-0 items-center gap-1.5 pr-2 pl-4 text-xs text-muted-foreground">
      {gitRef && shortRef && (
        <a
          href={`https://github.com/wham/kaja/tree/${gitRef}`}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => {
            if (isWailsEnvironment()) {
              e.preventDefault();
              openInBrowser(e.currentTarget.href);
            }
          }}
          className="flex min-w-0 items-center gap-1.5 text-muted-foreground no-underline hover:text-foreground"
        >
          <GitBranch size={13} className="shrink-0" />
          <span className="truncate">{shortRef}</span>
        </a>
      )}
      {/* Absent until Kaja has failed at something. It reads the error store itself:
          what it reports is the window's, and every writer already reaches it through
          `console.error`. */}
      {appErrors.length > 0 && <ErrorStatus />}
      {/* Absent at 100%. It is the only thing that states the size the window is drawn
          at, and the only way back to 100% for someone who never learned the key. */}
      {zoom !== DEFAULT_ZOOM && (
        <button type="button" title="Reset zoom (⌘0)" onClick={onResetZoom} className="rounded px-1 font-mono tabular-nums hover:text-foreground">
          {zoom}%
        </button>
      )}
      <div className="ml-auto flex shrink-0 items-center gap-0.5">
        <IconButton
          size="xs"
          variant="ghost"
          icon={CircleHelp}
          aria-label="Send feedback"
          onClick={() => openExternal(FEEDBACK_URL)}
          className={footIconClass}
        />
        <IconButton size="xs" variant="ghost" icon={Keyboard} aria-label="Keyboard shortcuts" onClick={onShowShortcuts} className={footIconClass} />
        <FeaturePreviews features={featurePreviews} onToggle={onToggleFeaturePreview} className={footIconClass} />
        <IconButton
          size="xs"
          variant="ghost"
          icon={colorMode === "night" ? Sun : Moon}
          aria-label={colorMode === "night" ? "Switch to light theme" : "Switch to dark theme"}
          onClick={onToggleColorMode}
          className={footIconClass}
        />
      </div>
    </div>
  );
});
