import { Ellipsis, X, type LucideIcon } from "lucide-react";
import { cn } from "./cn";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./components/dropdown-menu";
import { IconButton } from "./components/icon-button";
import { useMediaQuery } from "./useMediaQuery";

import React, { ReactElement, useCallback, useEffect, useRef, useState } from "react";

interface TabProps {
  tabId: string;
  tabLabel: string;
  children: React.ReactNode;
  isEphemeral?: boolean;
  // Icon for a tab that isn't a document, so it reads as what it is at a glance.
  icon?: LucideIcon;
}

interface TabsProps {
  children: ReactElement<TabProps>[];
  activeTabIndex: number;
  onSelectTab: (index: number) => void;
  onCloseTab?: (index: number) => void;
  onCloseAll?: () => void;
  onCloseOthers?: (index: number) => void;
  // Double-clicking a preview tab's title keeps it, the same gesture editors use.
  onKeepTab?: (index: number) => void;
  // Controls the active tab contributes to the strip, left of the overflow menu.
  controls?: React.ReactNode;
}

export function Tab({ children }: TabProps) {
  return <>{children}</>;
}

export function Tabs({ children, activeTabIndex, onSelectTab, onCloseTab, onCloseAll, onCloseOthers, onKeepTab, controls }: TabsProps) {
  const isNarrow = useMediaQuery("(max-width: 767px)");
  const overflow = isNarrow ? "auto" : "hidden";
  const tabsHeaderRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  // Width of the overflow menu, the only control pinned to the strip, measured so
  // tabs reserve room for it and scrolling keeps them clear of it.
  const controlsRef = useRef<HTMLDivElement>(null);
  const controlsWidthRef = useRef(0);
  const [controlsWidth, setControlsWidth] = useState(0);
  controlsWidthRef.current = controlsWidth;
  const prevTabCount = useRef(React.Children.count(children));
  const [contextMenu, setContextMenu] = useState<{ open: boolean; tabIndex: number; anchorPoint: { x: number; y: number } }>({
    open: false,
    tabIndex: -1,
    anchorPoint: { x: 0, y: 0 },
  });
  const [showScrollbar, setShowScrollbar] = useState(false);
  const [scrollMetrics, setScrollMetrics] = useState({ left: 0, width: 0, clientWidth: 0 });

  const updateScrollMetrics = useCallback(() => {
    const el = tabsHeaderRef.current;
    if (el) {
      setScrollMetrics({ left: el.scrollLeft, width: el.scrollWidth, clientWidth: el.clientWidth });
    }
  }, []);

  useEffect(() => {
    const el = tabsHeaderRef.current;
    if (!el) return;
    el.addEventListener("scroll", updateScrollMetrics);
    const observer = new ResizeObserver(updateScrollMetrics);
    observer.observe(el);
    updateScrollMetrics();
    return () => {
      el.removeEventListener("scroll", updateScrollMetrics);
      observer.disconnect();
    };
  }, [children, updateScrollMetrics]);

  const scrollToTab = useCallback((index: number) => {
    const tabElement = tabRefs.current.get(index);
    const container = tabsHeaderRef.current;
    if (tabElement && container) {
      const tabRight = tabElement.offsetLeft + tabElement.offsetWidth;
      const visibleRight = container.scrollLeft + container.clientWidth;
      const controlsWidth = controlsWidthRef.current;
      if (tabRight > visibleRight - controlsWidth) {
        container.scrollTo({
          left: tabRight - container.clientWidth + controlsWidth + 8,
          behavior: "smooth",
        });
      }
    }
  }, []);

  useEffect(() => {
    const currentTabCount = React.Children.count(children);
    if (currentTabCount > prevTabCount.current) {
      scrollToTab(currentTabCount - 1);
    }
    prevTabCount.current = currentTabCount;
  }, [children, scrollToTab]);

  useEffect(() => {
    const el = controlsRef.current;
    if (!el) {
      setControlsWidth(0);
      return;
    }
    const update = () => setControlsWidth(el.offsetWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [onCloseAll, children]);

  const handleContextMenu = useCallback((event: React.MouseEvent, index: number) => {
    event.preventDefault();
    setContextMenu({ open: true, tabIndex: index, anchorPoint: { x: event.clientX, y: event.clientY } });
  }, []);

  const tabCount = React.Children.count(children);

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <div className="relative shrink-0" onMouseEnter={() => setShowScrollbar(true)} onMouseLeave={() => setShowScrollbar(false)}>
        <div
          ref={tabsHeaderRef}
          role="tablist"
          className="flex overflow-x-auto [&::-webkit-scrollbar]:hidden"
          style={{ paddingRight: tabCount > 0 ? controlsWidth : 0 }}
        >
          {React.Children.map(children, (child, index) => {
            const { tabId, tabLabel, isEphemeral, icon: Icon } = child.props;
            const isActive = index === activeTabIndex;

            return (
              <div
                key={tabId}
                ref={(el) => {
                  if (el) tabRefs.current.set(index, el);
                  else tabRefs.current.delete(index);
                }}
                role="tab"
                aria-selected={isActive}
                className={cn(
                  "group box-border flex h-[35px] shrink-0 cursor-pointer items-center border-b border-r border-t-2 border-r-border border-t-transparent pl-4 pr-2.5 text-sm hover:bg-accent",
                  isActive ? "border-b-transparent border-t-primary bg-background" : "border-b-border bg-chrome",
                )}
                onClick={() => onSelectTab(index)}
                onDoubleClick={() => onKeepTab?.(index)}
                onContextMenu={(e) => handleContextMenu(e, index)}
              >
                {Icon && <Icon size={14} className={cn("mr-1.5 shrink-0", isActive ? "text-foreground" : "text-muted-foreground")} />}
                <span
                  className={cn(
                    "mr-2 select-none whitespace-nowrap text-[length:inherit]",
                    isActive ? "text-foreground" : "text-muted-foreground",
                    isEphemeral && "italic",
                  )}
                >
                  {tabLabel}
                </span>
                {onCloseTab && (
                  <IconButton
                    icon={X}
                    aria-label={`Close ${tabLabel}`}
                    variant="ghost"
                    size="sm"
                    tooltip={false}
                    className={cn("h-4 w-4 p-px hover:bg-accent hover:opacity-100 group-hover:opacity-100", isActive ? "opacity-70" : "opacity-0")}
                    onClick={(e) => {
                      e.stopPropagation();
                      onCloseTab(index);
                    }}
                  />
                )}
              </div>
            );
          })}
          <div className="grow border-b border-border bg-chrome" />
        </div>
        {tabCount > 0 && (onCloseAll || controls) && (
          <>
            {/* Tabs scroll under the menu, so they fade out instead of being clipped mid-label. */}
            <div className="pointer-events-none absolute bottom-px top-0 w-6 bg-gradient-to-r from-transparent to-chrome" style={{ right: controlsWidth }} />
            <div ref={controlsRef} className="absolute bottom-0 right-0 top-0 flex items-center gap-1 border-b border-border bg-chrome pl-1 pr-2.5">
              {controls}
              {onCloseAll && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <IconButton icon={Ellipsis} aria-label="Tab options" variant="ghost" size="sm" tooltip={false} />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={onCloseAll}>Close All</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </>
        )}
        {showScrollbar && scrollMetrics.width > scrollMetrics.clientWidth && (
          <div
            className="pointer-events-none absolute bottom-0 z-[1] h-0.5 rounded-sm bg-muted-foreground"
            style={{
              left: Math.max(0, Math.min((scrollMetrics.left / scrollMetrics.width) * scrollMetrics.clientWidth, scrollMetrics.clientWidth - 8)),
              width: Math.min((scrollMetrics.clientWidth / scrollMetrics.width) * scrollMetrics.clientWidth, scrollMetrics.clientWidth),
            }}
          />
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, overflow, WebkitOverflowScrolling: isNarrow ? "touch" : undefined }}>
        {React.Children.map(children, (child, index) => (
          <div
            key={child.props.tabId}
            style={{
              display: index === activeTabIndex ? "flex" : "none",
              flexDirection: "column",
              flex: 1,
              minHeight: 0,
            }}
          >
            {child}
          </div>
        ))}
      </div>
      {contextMenu.open && (
        <DropdownMenu
          open={true}
          onOpenChange={(open) => {
            if (!open) setContextMenu((prev) => ({ ...prev, open: false }));
          }}
        >
          <DropdownMenuContent align="start" anchor={{ getBoundingClientRect: () => new DOMRect(contextMenu.anchorPoint.x, contextMenu.anchorPoint.y, 0, 0) }}>
            {onCloseTab && (
              <DropdownMenuItem
                onSelect={() => {
                  onCloseTab(contextMenu.tabIndex);
                  setContextMenu((prev) => ({ ...prev, open: false }));
                }}
              >
                Close
              </DropdownMenuItem>
            )}
            {onCloseOthers && tabCount > 1 && (
              <DropdownMenuItem
                onSelect={() => {
                  onCloseOthers(contextMenu.tabIndex);
                  setContextMenu((prev) => ({ ...prev, open: false }));
                }}
              >
                Close Others
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
