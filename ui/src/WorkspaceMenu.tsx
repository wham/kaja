import { ChevronDown, ExternalLink, FolderOpen } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "./components/dropdown-menu";
import { KajaTrace } from "./KajaTrace";

export interface WorkspaceFolder {
  dir: string;
  name: string;
  default: boolean;
  location: string;
}

// Absent on the web, which serves one workspace.
export interface WorkspaceControl {
  current: WorkspaceFolder;
  known: WorkspaceFolder[];
  onOpen: (dir: string) => void;
  onChoose: () => void;
  onReveal: () => void;
}

// Where the band has no traffic lights the mark and the name are one button, so the
// corner says which workspace rather than repeating "Kaja".
export function WorkspaceMenu({ control, withMark }: { control: WorkspaceControl; withMark?: boolean }) {
  const others = control.known.filter((workspace) => workspace.dir !== control.current.dir);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Workspace: ${control.current.name}`}
          title={control.current.dir}
          className="flex h-6 min-w-0 shrink items-center gap-1 rounded-md pl-2 pr-1.5 text-xs font-semibold text-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring data-[popup-open]:bg-muted"
        >
          {withMark && <KajaTrace width={18} height={11} className="mr-0.5 shrink-0" />}
          <span className="truncate">{control.current.name}</span>
          <ChevronDown size={12} className="shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <div className="flex items-center gap-3 px-2 py-1.5">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{control.current.name}</div>
            <div className="truncate font-mono text-xs text-muted-foreground" title={control.current.dir}>
              {control.current.location || control.current.dir}
            </div>
          </div>
          <DropdownMenuItem onSelect={control.onReveal} className="h-7 shrink-0 gap-1.5 border border-border px-2 py-0 text-xs">
            <ExternalLink size={14} />
            Reveal
          </DropdownMenuItem>
        </div>
        <DropdownMenuSeparator />
        {others.length > 0 && <div className="px-2 pb-1 pt-1.5 text-xs text-muted-foreground">Switch to</div>}
        {others.map((workspace) => (
          <DropdownMenuItem key={workspace.dir} onSelect={() => control.onOpen(workspace.dir)} title={workspace.dir}>
            <span className="truncate">{workspace.name}</span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuItem onSelect={control.onChoose}>
          <FolderOpen size={16} />
          Open workspace…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
