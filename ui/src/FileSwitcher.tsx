import { ChevronsUpDown, CircleAlert, Search, X, type LucideIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { cn } from "./cn";
import { Popover, PopoverContent, PopoverTrigger } from "./components/popover";

// The trigger caps here; over it the app label goes first, then the name
// truncates from the left so its tail — the part that identifies the call —
// survives.
const TRIGGER_MAX_WIDTH = 260;
// Icon, gaps, chevron and padding: what the trigger spends on everything that
// isn't the two labels.
const TRIGGER_CHROME = 66;
// With an empty query the list is the open files plus a glance at the rest,
// not the whole project.
const RESTING_OTHERS = 8;
const LIST_MAX_HEIGHT = 420;

export interface SwitcherFile {
  key: string;
  name: string;
  // Where the file sits: "benchling / Folders", "Scripts", "Workspace".
  path: string;
  // The qualifier the trigger carries beside the name, empty where the name is
  // already the whole answer.
  origin: string;
  icon: LucideIcon;
  onOpen: () => void;
}

export interface OpenSwitcherFile extends SwitcherFile {
  id: string;
  preview: boolean;
  dirty: boolean;
}

interface FileSwitcherProps {
  // Open files, most-recently-visited first: the first is the one on screen and
  // the second is what ⌘P⏎ goes back to.
  openFiles: OpenSwitcherFile[];
  // Everything else the sidebar can reach.
  otherFiles: SwitcherFile[];
  // Errors in the current file. The trigger says so, and Run beside it goes
  // disabled on the same condition.
  errorCount: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // ⌘P opens on the previous file so ⌘P⏎ is "back"; ⌘K and a click on the
  // trigger open on the first row.
  highlightPrevious: boolean;
  onClose: (id: string) => void;
  onCloseAll: () => void;
}

interface Row {
  file: SwitcherFile;
  openFile?: OpenSwitcherFile;
}

export function FileSwitcher({ openFiles, otherFiles, errorCount, open, onOpenChange, highlightPrevious, onClose, onCloseAll }: FileSwitcherProps) {
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const current = openFiles[0];

  const { openRows, otherRows } = useMemo(() => {
    const term = query.trim().toLowerCase();
    const matches = (file: SwitcherFile) => `${file.name} ${file.path}`.toLowerCase().includes(term);
    const open: Row[] = openFiles.filter(matches).map((file) => ({ file, openFile: file }));
    const others: Row[] = otherFiles.filter(matches).map((file) => ({ file }));
    return { openRows: open, otherRows: term ? others : others.slice(0, RESTING_OTHERS) };
  }, [openFiles, otherFiles, query]);

  const rows = useMemo(() => [...openRows, ...otherRows], [openRows, otherRows]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    // ⌘P⏎ is the ⌃Tab replacement, so the previous file starts highlighted.
    setHighlight(highlightPrevious && openFiles.length > 1 ? 1 : 0);
    const focus = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(focus);
  }, [open, highlightPrevious]);

  useEffect(() => {
    setHighlight((index) => Math.min(index, Math.max(0, rows.length - 1)));
  }, [rows.length]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`#switcher-row-${highlight}`)?.scrollIntoView({ block: "nearest" });
  }, [highlight, rows.length]);

  const select = (row: Row | undefined) => {
    if (!row) return;
    row.file.onOpen();
    onOpenChange(false);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlight((index) => (rows.length === 0 ? 0 : (index + 1) % rows.length));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight((index) => (rows.length === 0 ? 0 : (index - 1 + rows.length) % rows.length));
    } else if (event.key === "Enter") {
      event.preventDefault();
      select(rows[highlight]);
    } else if (event.key === "Backspace" && (event.metaKey || event.ctrlKey)) {
      // Closing a file from inside the list doesn't leave it.
      const id = rows[highlight]?.openFile?.id;
      if (id) {
        event.preventDefault();
        onClose(id);
      }
    }
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          data-testid="file-switcher"
          aria-expanded={open}
          aria-controls="file-switcher"
          aria-label={current ? `${current.name} — switch file` : "Open a file"}
          className={cn(
            "relative flex h-[26px] shrink-0 items-center gap-2 rounded-md border bg-card px-2.5 hover:bg-accent",
            open && "bg-accent",
            errorCount > 0 ? "border-destructive" : "border-border",
          )}
          style={{ maxWidth: TRIGGER_MAX_WIDTH }}
        >
          <TriggerContent file={current} errorCount={errorCount} />
          <ChevronsUpDown size={13} className="shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        id="file-switcher"
        align="start"
        sideOffset={2}
        // It is a finder: movement makes fast repeated ⌘P feel unstable, so it
        // only fades.
        className="flex w-[380px] flex-col overflow-hidden rounded-lg p-0 shadow-lg transition-opacity duration-[120ms] data-[ending-style]:scale-100 data-[starting-style]:scale-100"
      >
        <div className="flex h-[34px] shrink-0 items-center gap-2 border-b border-border px-3">
          <Search size={13} className="shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search files and calls…"
            aria-label="Search files and calls"
            aria-activedescendant={rows.length > 0 ? `switcher-row-${highlight}` : undefined}
            className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div ref={listRef} role="listbox" aria-label="Files" className="min-h-0 flex-1 overflow-y-auto" style={{ maxHeight: LIST_MAX_HEIGHT }}>
          {rows.length === 0 && <div className="px-3 py-3 text-sm text-muted-foreground">Nothing matches “{query}”.</div>}
          {openRows.length > 0 && <GroupHeader>{query.trim() ? "Open" : `Open · ${openRows.length}`}</GroupHeader>}
          {openRows.map((row, index) => (
            <SwitcherRow
              key={row.file.key}
              row={row}
              index={index}
              highlighted={highlight === index}
              onHighlight={setHighlight}
              onSelect={select}
              onClose={onClose}
            />
          ))}
          {otherRows.length > 0 && <GroupHeader border={openRows.length > 0}>All files</GroupHeader>}
          {otherRows.map((row, index) => (
            <SwitcherRow
              key={row.file.key}
              row={row}
              index={openRows.length + index}
              highlighted={highlight === openRows.length + index}
              onHighlight={setHighlight}
              onSelect={select}
              onClose={onClose}
            />
          ))}
        </div>
        <div className="flex h-[32px] shrink-0 items-center justify-between border-t border-border px-3">
          <span className="text-xs text-muted-foreground">↑↓ move · ⏎ open · ⌘⌫ close</span>
          <button
            type="button"
            className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
            disabled={openFiles.length === 0}
            onClick={() => {
              onCloseAll();
              onOpenChange(false);
            }}
          >
            Close all
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function GroupHeader({ border, children }: { border?: boolean; children: React.ReactNode }) {
  return (
    <div role="presentation" className={cn("px-3 pb-1 pt-2 text-xs text-muted-foreground", border && "mt-1 border-t border-border")}>
      {children}
    </div>
  );
}

function SwitcherRow({
  row,
  index,
  highlighted,
  onHighlight,
  onSelect,
  onClose,
}: {
  row: Row;
  index: number;
  highlighted: boolean;
  onHighlight: (index: number) => void;
  onSelect: (row: Row) => void;
  onClose: (id: string) => void;
}) {
  const { file, openFile } = row;
  const Icon = file.icon;
  return (
    <div
      id={`switcher-row-${index}`}
      role="option"
      aria-selected={highlighted}
      className={cn("group flex h-[30px] cursor-pointer items-center gap-2 px-3", highlighted && "bg-accent")}
      onMouseEnter={() => onHighlight(index)}
      onClick={() => onSelect(row)}
    >
      <Icon size={13} className="shrink-0 text-muted-foreground" />
      <span className={cn("shrink-0 truncate text-sm", openFile ? "text-foreground" : "text-muted-foreground", openFile?.preview && "italic")}>
        {file.name}
      </span>
      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{file.path}</span>
      {highlighted && <span className="shrink-0 font-mono text-xs text-muted-foreground">⏎</span>}
      {openFile?.dirty ? (
        <span aria-label="Unsaved changes" className="size-[5px] shrink-0 rounded-full bg-muted-foreground" />
      ) : (
        openFile && (
          <button
            type="button"
            aria-label={`Close ${file.name}`}
            className={cn("shrink-0 text-muted-foreground hover:text-foreground", highlighted ? "opacity-100" : "opacity-0 group-hover:opacity-100")}
            onClick={(event) => {
              event.stopPropagation();
              onClose(openFile.id);
            }}
          >
            <X size={12} />
          </button>
        )
      )}
    </div>
  );
}

// The trigger carries everything the old active tab carried, in 26px: icon,
// name, and the one qualifier that tells two identically named calls apart.
function TriggerContent({ file, errorCount }: { file?: OpenSwitcherFile; errorCount: number }) {
  const [dropLabel, setDropLabel] = useState(false);
  const probeRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const probe = probeRef.current;
    setDropLabel(probe ? probe.offsetWidth > TRIGGER_MAX_WIDTH - TRIGGER_CHROME : false);
  }, [file?.name, file?.origin, errorCount]);

  if (!file) {
    return <span className="truncate text-sm text-muted-foreground">No file open</span>;
  }

  const Icon = errorCount > 0 ? CircleAlert : file.icon;
  const qualifier = errorCount > 0 ? `${errorCount} ${errorCount === 1 ? "error" : "errors"}` : file.origin;

  return (
    <>
      {/* Measured at its natural size, clipped to nothing, so dropping the label
          can never make it fit and then unfit. */}
      <span aria-hidden className="pointer-events-none invisible absolute h-0 w-0 overflow-hidden">
        <span ref={probeRef} className="inline-block whitespace-nowrap text-sm font-medium">
          {file.name}
          {qualifier && <span className="text-xs">{qualifier}</span>}
        </span>
      </span>
      <Icon size={13} className={cn("shrink-0", errorCount > 0 ? "text-destructive" : "text-muted-foreground")} />
      <span
        className={cn("min-w-0 truncate text-sm font-medium text-foreground", file.preview && "font-normal italic")}
        // Truncating from the left keeps the call name, which is the end of a
        // qualified one.
        style={{ direction: "rtl", textAlign: "left" }}
      >
        {file.name}
      </span>
      {file.dirty && <span aria-label="Unsaved changes" className="size-[5px] shrink-0 rounded-full bg-muted-foreground" />}
      {qualifier && !dropLabel && !file.dirty && (
        <span className={cn("shrink-0 text-xs", errorCount > 0 ? "text-destructive" : "text-muted-foreground")}>{qualifier}</span>
      )}
    </>
  );
}
