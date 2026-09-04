import { Fragment } from "react";
import { CircleDot, GitBranch, Moon, Sun } from "lucide-react";
import { IconButton } from "./components/icon-button";
import { isWailsEnvironment, openInBrowser } from "./wails";
import { FeaturePreview, FeaturePreviews } from "./FeaturePreviews";
import { CompileStatus } from "./CompileStatus";
import { ErrorStatus, useAppErrors } from "./ErrorStatus";
import { summarizeCompilation } from "./compileSummary";
import { App } from "./apps";

export type ColorMode = "day" | "night";

// Every icon in the status bar is the same 14px glyph on the same hit area.
export const statusBarIconClass = "h-6 w-6 [&_svg]:size-[14px]";

interface StatusBarProps {
  colorMode: ColorMode;
  onToggleColorMode: () => void;
  gitRef?: string;
  buildNumber?: string;
  featurePreviews: FeaturePreview[];
  onToggleFeaturePreview: (key: string) => void;
  apps: App[];
  configurationLoaded: boolean;
  onShowCompileLog: (appName?: string) => void;
  onRecompile: (appName?: string) => void;
}

const FEEDBACK_URL = "https://github.com/wham/kaja/issues/new?template=feedback.yml";

const externalLinkClass = "inline-flex items-center gap-2 text-xs text-muted-foreground no-underline hover:text-foreground";

function handleExternalLinkClick(e: React.MouseEvent<HTMLAnchorElement>) {
  if (isWailsEnvironment()) {
    e.preventDefault();
    openInBrowser(e.currentTarget.href);
  }
}

export function StatusBar({
  colorMode,
  onToggleColorMode,
  gitRef,
  buildNumber,
  featurePreviews,
  onToggleFeaturePreview,
  apps,
  configurationLoaded,
  onShowCompileLog,
  onRecompile,
}: StatusBarProps) {
  const appErrors = useAppErrors();
  const shortRef = gitRef ? (gitRef.length > 7 ? gitRef.slice(0, 7) : gitRef) : undefined;
  const githubUrl = gitRef ? `https://github.com/wham/kaja/tree/${gitRef}` : undefined;

  // The compile status sits at the end so its label can grow and shrink without moving
  // the ref and the build around.
  const leftItems: React.ReactNode[] = [];
  if (githubUrl && shortRef) {
    leftItems.push(
      <a key="ref" href={githubUrl} target="_blank" rel="noopener noreferrer" onClick={handleExternalLinkClick} className={externalLinkClass}>
        <GitBranch size={14} />
        <span>{shortRef}</span>
      </a>,
    );
  }
  if (buildNumber) {
    leftItems.push(
      <span key="build" className="font-mono text-xs text-muted-foreground">
        build {buildNumber}
      </span>,
    );
  }
  // Feedback opens an issue on the same repository the ref points at, so it reads as
  // the third thing said about this build rather than a tool beside the theme switch.
  leftItems.push(
    <a key="feedback" href={FEEDBACK_URL} target="_blank" rel="noopener noreferrer" onClick={handleExternalLinkClick} className={externalLinkClass}>
      <CircleDot size={14} />
      <span>Feedback</span>
    </a>,
  );
  if (summarizeCompilation(apps, configurationLoaded).state !== "empty") {
    leftItems.push(
      <CompileStatus key="compile" apps={apps} configurationLoaded={configurationLoaded} onShowLog={onShowCompileLog} onRecompile={onRecompile} />,
    );
  }
  // Last, and absent until Kaja has failed at something. It reads the error store
  // itself rather than taking it as a prop: what it reports is the window's, not this
  // bar's, and every writer already reaches it through `console.error`.
  if (appErrors.length > 0) {
    leftItems.push(<ErrorStatus key="errors" />);
  }

  // The right padding is 11, not 12: these glyphs are smaller than the rest of the
  // chrome's, so they need one pixel less to land on the same 16px right line.
  //
  // sticky left keeps the bar where the window is on a screen too narrow to hold the
  // panes side by side: the app pans horizontally there, and a footer that pans with it
  // takes its own buttons off the screen.
  return (
    <div className="sticky left-0 flex h-[30px] shrink-0 items-center border-t border-border bg-chrome pl-3 pr-[11px]">
      <div className="flex min-w-0 items-center gap-2">
        {leftItems.map((item, index) => (
          <Fragment key={index}>
            {index > 0 && <div className="h-3 w-px shrink-0 bg-border" />}
            {item}
          </Fragment>
        ))}
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-3 pl-2">
        <FeaturePreviews features={featurePreviews} onToggle={onToggleFeaturePreview} className={statusBarIconClass} />
        <IconButton
          size="xs"
          variant="ghost"
          tooltip="native"
          icon={colorMode === "night" ? Sun : Moon}
          aria-label={colorMode === "night" ? "Switch to light theme" : "Switch to dark theme"}
          onClick={onToggleColorMode}
          className={statusBarIconClass}
        />
      </div>
    </div>
  );
}
