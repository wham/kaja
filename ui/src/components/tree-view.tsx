import { ChevronRight } from "lucide-react";
import * as React from "react";

import { cn } from "../cn";

// Covers what the sidebar uses: controlled expand/collapse, a current
// (selected) leaf, leading/trailing visuals, and a loading SubTree. Rows toggle
// when they have a SubTree, otherwise they call onSelect.
//
// Depth is drawn as a hairline rather than paid for in icons: a package and a
// service repeat the same glyph on every row, so the column costs width to say
// what the indent already says. Levels that branch nest inside a guide; a list
// of leaves takes the indent without one, because a line nothing hangs off is
// noise, and its rows drop the chevron slot they would never fill.
const LeafContext = React.createContext(false);

const GUIDE = "relative pl-3.5 before:absolute before:inset-y-0 before:left-3.5 before:w-px before:bg-border before:content-['']";
const LEAF = "pl-5";

function TreeView({
  children,
  guide,
  leaf,
  ...props
}: {
  children: React.ReactNode;
  // Nest the whole list under a hairline, for a tree hung off a header that is
  // not itself an Item (an app in the sidebar).
  guide?: boolean;
  // A list that never branches, indented but unguided.
  leaf?: boolean;
  "aria-label"?: string;
}) {
  return (
    <ul role="tree" className={cn("select-none", guide && GUIDE, leaf && LEAF)} {...props}>
      <LeafContext.Provider value={!!leaf}>{children}</LeafContext.Provider>
    </ul>
  );
}

interface ItemProps {
  id?: string;
  current?: boolean;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  // The event is passed so a caller can read a modifier, e.g. ⌥click.
  onSelect?: (event: React.MouseEvent) => void;
  // Double click, the editor gesture for "I mean it": a single click opens a
  // preview, this opens for good.
  onActivate?: () => void;
  // Makes the row focusable, for the rows that answer to a key of their own.
  onKeyDown?: (event: React.KeyboardEvent) => void;
  children: React.ReactNode;
}

const Item = React.forwardRef<HTMLDivElement, ItemProps>(({ id, current, expanded, onExpandedChange, onSelect, onActivate, onKeyDown, children }, ref) => {
  const leaf = React.useContext(LeafContext);

  let leading: React.ReactNode = null;
  let trailing: React.ReactNode = null;
  let subtree: React.ReactNode = null;
  const labels: React.ReactNode[] = [];
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) {
      labels.push(child);
      return;
    }
    if (child.type === LeadingVisual) leading = child;
    else if (child.type === TrailingVisual) trailing = child;
    else if (child.type === SubTree) subtree = child;
    else labels.push(child);
  });

  const hasSubtree = subtree !== null;

  return (
    <li role="treeitem" aria-expanded={hasSubtree ? expanded : undefined} aria-current={current || undefined}>
      <div
        ref={ref}
        id={id}
        tabIndex={onKeyDown ? 0 : undefined}
        onKeyDown={onKeyDown}
        onClick={(event) => (hasSubtree ? onExpandedChange?.(!expanded) : onSelect?.(event))}
        onDoubleClick={hasSubtree ? undefined : onActivate}
        className={cn(
          "group flex h-[22px] cursor-pointer items-center gap-1.5 pl-2 pr-1 text-[13px] outline-none",
          current ? "bg-accent text-accent-foreground" : "text-foreground hover:bg-accent/50",
          "focus-visible:bg-accent/50",
        )}
      >
        {!leaf && (
          <span className="flex size-3 shrink-0 items-center justify-center text-muted-foreground">
            {hasSubtree && <ChevronRight size={12} className={cn("transition-transform", expanded && "rotate-90")} />}
          </span>
        )}
        {leading}
        <span className="flex-1 truncate">
          {labels.map((label, index) => (
            <React.Fragment key={index}>{label}</React.Fragment>
          ))}
        </span>
        {trailing}
      </div>
      {hasSubtree && expanded && subtree}
    </li>
  );
});
Item.displayName = "TreeView.Item";

interface SubTreeProps {
  state?: "initial" | "loading" | "done";
  count?: number;
  leaf?: boolean;
  children?: React.ReactNode;
}

function SubTree({ state, count = 3, leaf, children }: SubTreeProps) {
  const className = cn("select-none", leaf ? LEAF : GUIDE);
  if (state === "loading") {
    return (
      <ul role="group" className={className}>
        {Array.from({ length: count }).map((_, index) => (
          <li key={index} role="treeitem">
            <div className="flex h-[22px] items-center gap-1.5 pl-2 pr-1">
              <span className="size-3 shrink-0" />
              <div className="h-2.5 w-24 animate-pulse rounded bg-muted" />
            </div>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <ul role="group" className={className}>
      <LeafContext.Provider value={!!leaf}>{children}</LeafContext.Provider>
    </ul>
  );
}

function LeadingVisual({ children }: { children: React.ReactNode }) {
  return <span className="flex shrink-0 items-center text-muted-foreground">{children}</span>;
}

// The slot keeps its width whether or not it holds anything, so a row that grows
// a kebab on hover doesn't move the label's truncation point under the cursor.
// A row whose hover actions are several buttons wide overrides the width, and
// buys the room back by dropping its leading glyph for as long as it is hovered.
function TrailingVisual({ className, children }: { className?: string; children: React.ReactNode }) {
  return <span className={cn("ml-auto flex w-6 shrink-0 items-center justify-center", className)}>{children}</span>;
}

TreeView.Item = Item;
TreeView.SubTree = SubTree;
TreeView.LeadingVisual = LeadingVisual;
TreeView.TrailingVisual = TrailingVisual;

export { TreeView };
