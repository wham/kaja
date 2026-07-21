import { ChevronRight } from "lucide-react";
import * as React from "react";

import { cn } from "../lib/utils";

// A minimal replacement for Primer's TreeView covering what the sidebar uses:
// controlled expand/collapse, a current (selected) leaf, leading/trailing
// visuals, depth-based indentation, and a loading SubTree. Rows toggle when they
// have a SubTree, otherwise they call onSelect.
const DepthContext = React.createContext(0);
const INDENT = 16;
const BASE_PADDING = 8;

function TreeView({ children, ...props }: { children: React.ReactNode; "aria-label"?: string }) {
  return (
    <ul role="tree" className="select-none" {...props}>
      {children}
    </ul>
  );
}

interface ItemProps {
  id?: string;
  current?: boolean;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  onSelect?: () => void;
  children: React.ReactNode;
}

const Item = React.forwardRef<HTMLDivElement, ItemProps>(({ id, current, expanded, onExpandedChange, onSelect, children }, ref) => {
  const depth = React.useContext(DepthContext);

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
        onClick={() => (hasSubtree ? onExpandedChange?.(!expanded) : onSelect?.())}
        className={cn(
          "group flex h-7 items-center gap-1.5 rounded-md pr-1.5 text-sm",
          current ? "bg-accent text-accent-foreground" : "text-foreground hover:bg-accent/50",
        )}
        style={{ paddingLeft: BASE_PADDING + depth * INDENT, cursor: "pointer" }}
      >
        <span className="flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground">
          {hasSubtree && <ChevronRight size={16} className={cn("transition-transform", expanded && "rotate-90")} />}
        </span>
        {leading}
        <span className="flex-1 truncate">
          {labels.map((label, index) => (
            <React.Fragment key={index}>{label}</React.Fragment>
          ))}
        </span>
        {trailing}
      </div>
      {hasSubtree && expanded && <DepthContext.Provider value={depth + 1}>{subtree}</DepthContext.Provider>}
    </li>
  );
});
Item.displayName = "TreeView.Item";

interface SubTreeProps {
  state?: "initial" | "loading" | "done";
  count?: number;
  children?: React.ReactNode;
}

function SubTree({ state, count = 3, children }: SubTreeProps) {
  const depth = React.useContext(DepthContext);
  if (state === "loading") {
    return (
      <ul role="group">
        {Array.from({ length: count }).map((_, index) => (
          <li key={index} role="treeitem">
            <div className="flex h-7 items-center gap-1.5 pr-1.5" style={{ paddingLeft: BASE_PADDING + depth * INDENT }}>
              <span className="h-4 w-4 shrink-0" />
              <div className="h-3 w-24 animate-pulse rounded bg-muted" />
            </div>
          </li>
        ))}
      </ul>
    );
  }
  return <ul role="group">{children}</ul>;
}

function LeadingVisual({ children }: { children: React.ReactNode }) {
  return <span className="flex shrink-0 items-center text-muted-foreground">{children}</span>;
}

function TrailingVisual({ children }: { children: React.ReactNode }) {
  return <span className="ml-auto flex shrink-0 items-center">{children}</span>;
}

TreeView.Item = Item;
TreeView.SubTree = SubTree;
TreeView.LeadingVisual = LeadingVisual;
TreeView.TrailingVisual = TrailingVisual;

export { TreeView };
