import { ChevronRight } from "lucide-react";
import * as React from "react";

import { cn } from "../cn";

// Covers what the sidebar uses: controlled expand/collapse, a current
// (selected) leaf, leading/trailing visuals, and a loading SubTree. Rows toggle
// when they have a SubTree, otherwise they call onSelect.
//
// Depth is the indent and nothing else: a package and a service repeat the same
// glyph on every row, so an icon column costs width to say what the indent
// already says, and a guide line beside it was a second way of saying it. A list
// of leaves drops the chevron slot its rows would never fill.
const LeafContext = React.createContext(false);

const NESTED = "pl-3.5";
const LEAF = "pl-5";

function TreeView({
  children,
  nested,
  leaf,
  ...props
}: {
  children: React.ReactNode;
  // Indent the whole list, for a tree hung off a header that is not itself an
  // Item (an app in the sidebar).
  nested?: boolean;
  // A list that never branches, indented but unguided.
  leaf?: boolean;
  "aria-label"?: string;
}) {
  return (
    <ul role="tree" className={cn("select-none", nested && NESTED, leaf && LEAF)} {...props}>
      <LeafContext.Provider value={!!leaf}>{children}</LeafContext.Provider>
    </ul>
  );
}

interface ItemProps {
  id?: string;
  current?: boolean;
  expanded?: boolean;
  // The event is passed so a caller can read a modifier, e.g. ⌥click to take the
  // whole subtree.
  onExpandedChange?: (expanded: boolean, event: React.MouseEvent) => void;
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
        onClick={(event) => (hasSubtree ? onExpandedChange?.(!expanded, event) : onSelect?.(event))}
        onDoubleClick={hasSubtree ? undefined : onActivate}
        className={cn(
          "group flex h-6 cursor-pointer items-center gap-1.5 rounded-md pl-2 text-sm outline-none",
          current ? "bg-accent/60 text-accent-foreground" : cn(leaf ? "text-foreground/90" : "text-foreground", "hover:bg-accent/40"),
          "focus-visible:bg-accent/40",
        )}
      >
        {!leaf && (
          <span className="flex size-3 shrink-0 items-center justify-center text-muted-foreground/70">
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
  const className = cn("select-none", leaf ? LEAF : NESTED);
  if (state === "loading") {
    return (
      <ul role="group" className={className}>
        {Array.from({ length: count }).map((_, index) => (
          <li key={index} role="treeitem">
            <div className="flex h-6 items-center gap-1.5 pl-2">
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
// 18px against the row's own 8px of padding, which is the column every control at
// the panel's right edge stands in.
function TrailingVisual({ className, children }: { className?: string; children: React.ReactNode }) {
  return <span className={cn("ml-auto flex w-[18px] shrink-0 items-center justify-center", className)}>{children}</span>;
}

TreeView.Item = Item;
TreeView.SubTree = SubTree;
TreeView.LeadingVisual = LeadingVisual;
TreeView.TrailingVisual = TrailingVisual;

export { TreeView };
