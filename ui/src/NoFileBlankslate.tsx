import { FileCode, type LucideIcon } from "lucide-react";
import { formatDayLabel } from "./callTime";
import { cn } from "./cn";

export interface RecentFile {
  key: string;
  name: string;
  icon: LucideIcon;
  // When it was last worked in, for the unsaved ones. A file on disk has no
  // timestamp worth showing here.
  updatedAt?: number;
  saved: boolean;
  go: () => void;
}

interface NoFileBlankslateProps {
  onOpenFinder: () => void;
  onNewScratch: () => void;
  // The last few things you looked at. This is the only moment the cache behind
  // the finder is worth showing as a list.
  recent: RecentFile[];
}

/**
 * The first screen of a new install, and where every "nothing open" moment
 * lands. It has one job: say that picking a call in the tree writes you a
 * script, which is the entire model of the product and is said nowhere else.
 *
 * Under the sentence sits your recent work, because the people who see this
 * screen most are not new — every missed ⌘P and every fresh window comes here,
 * and for them a shortcut beats an illustration. On a first run the list is
 * absent rather than an empty box, which is the right amount for someone who has
 * nothing yet.
 */
export function NoFileBlankslate({ onOpenFinder, onNewScratch, recent }: NoFileBlankslateProps) {
  const modifier = navigator.platform.startsWith("Mac") ? "⌘" : "Ctrl+";

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-5 px-6">
      <div className="flex flex-col items-center gap-2">
        <FileCode size={28} className="text-muted-foreground" />
        <p className="m-0 text-sm text-foreground">Pick a call in the sidebar and Kaja writes the script.</p>
        <p className="m-0 text-xs text-muted-foreground">Everything here is a script. Edit it, run it, save it if it's worth keeping.</p>
      </div>
      {recent.length > 0 && (
        <div className="flex w-[300px] flex-col gap-1">
          {recent.map((file) => {
            const Icon = file.icon;
            return (
              <button key={file.key} type="button" onClick={file.go} className="flex h-[30px] items-center gap-2 rounded-md px-2 text-left hover:bg-accent">
                <Icon size={14} className="shrink-0 text-muted-foreground" />
                <span className={cn("min-w-0 flex-1 truncate text-xs", file.saved ? "text-foreground" : "text-muted-foreground")}>{file.name}</span>
                {file.updatedAt !== undefined && (
                  <span className="shrink-0 font-mono text-xs text-muted-foreground opacity-70">{formatDayLabel(file.updatedAt)}</span>
                )}
              </button>
            );
          })}
        </div>
      )}
      <div className="flex items-center gap-3">
        <button type="button" onClick={onOpenFinder} className="text-xs text-muted-foreground hover:text-foreground">
          <span className="font-mono">{modifier}P</span> find a call
        </button>
        <div className="h-3 w-px bg-border" />
        <button type="button" onClick={onNewScratch} className="text-xs text-muted-foreground hover:text-foreground">
          <span className="font-mono">{modifier}N</span> blank script
        </button>
      </div>
    </div>
  );
}
