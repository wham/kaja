import { Check, ChevronDown, ExternalLink, FolderOpen } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "./components/dropdown-menu";
import { KajaTrace } from "./KajaTrace";

export interface WorkspaceFolder {
  dir: string;
  name: string;
  default: boolean;
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
      <DropdownMenuContent align="start" className="w-60">
        {control.known.map((workspace) => (
          <DropdownMenuItem key={workspace.dir} onSelect={() => control.onOpen(workspace.dir)} title={workspace.dir}>
            <Check size={16} className={workspace.dir === control.current.dir ? "" : "invisible"} />
            <span className="truncate">{workspace.name}</span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={control.onChoose}>
          <FolderOpen size={16} />
          Open workspace…
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={control.onReveal}>
          <ExternalLink size={16} />
          Reveal in Finder
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
