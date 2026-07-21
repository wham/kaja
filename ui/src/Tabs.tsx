import { EllipsisIcon, PlayIcon, XIcon } from "./components/icons";
import { Button } from "./components/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./components/dropdown-menu";
import { IconButton } from "./components/icon-button";
import { SimpleTooltip } from "./components/tooltip";
import { useMediaQuery } from "./useMediaQuery";

import React, { ReactElement, useCallback, useEffect, useRef, useState } from "react";

interface TabProps {
  tabId: string;
  tabLabel: string;
  children: React.ReactNode;
  isEphemeral?: boolean;
}

interface TabsProps {
  children: ReactElement<TabProps>[];
  activeTabIndex: number;
  onSelectTab: (index: number) => void;
  onCloseTab?: (index: number) => void;
  onCloseAll?: () => void;
  onCloseOthers?: (index: number) => void;
  // When set, a compact Run button is docked into the tab-strip control cluster.
  onRun?: () => void;
}

export function Tab({ children }: TabProps) {
  return <>{children}</>;
}

export function Tabs({ children, activeTabIndex, onSelectTab, onCloseTab, onCloseAll, onCloseOthers, onRun }: TabsProps) {
  const isNarrow = useMediaQuery("(max-width: 767px)");
  const overflow = isNarrow ? "auto" : "hidden";
  const tabsHeaderRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  // Width of the right-hand control cluster (Run + Tab options), measured so tabs
  // reserve room for it and scrolling keeps them clear of it.
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
  }, [onRun, onCloseAll, children]);

  const handleContextMenu = useCallback((event: React.MouseEvent, index: number) => {
    event.preventDefault();
    setContextMenu({ open: true, tabIndex: index, anchorPoint: { x: event.clientX, y: event.clientY } });
  }, []);

  const tabCount = React.Children.count(children);

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <style>{`
        .tabs-header::-webkit-scrollbar {
          display: none;
        }
        .tab-item {
          display: flex;
          align-items: center;
          flex-shrink: 0;
          padding: 0 10px 0 16px;
          border-top: 1px solid transparent;
          border-right: 1px solid var(--borderColor-muted);
          border-bottom: 1px solid var(--borderColor-muted);
          font-size: 14px;
          cursor: pointer;
          background-color: transparent;
          height: 35px;
          box-sizing: border-box;
        }
        .tab-item:hover {
          background-color: var(--bgColor-neutral-muted);
        }
        .tab-item.active {
          border-top-color: var(--fgColor-accent);
          border-bottom-color: transparent;
          background-color: var(--bgColor-muted);
        }
        .tab-close-button:hover {
          opacity: 1 !important;
          background-color: var(--bgColor-neutral-muted);
        }
        .tab-item:hover .tab-close-button {
          opacity: 1 !important;
        }
      `}</style>
      <div
        className="tabs-wrapper"
        style={{ position: "relative", flexShrink: 0 }}
        onMouseEnter={() => setShowScrollbar(true)}
        onMouseLeave={() => setShowScrollbar(false)}
      >
        <div ref={tabsHeaderRef} className="tabs-header" style={{ display: "flex", overflowX: "auto", paddingRight: tabCount > 0 ? controlsWidth : 0 }}>
          {React.Children.map(children, (child, index) => {
            const { tabId, tabLabel, isEphemeral } = child.props;
            const isActive = index === activeTabIndex;

            return (
              <div
                key={tabId}
                ref={(el) => {
                  if (el) tabRefs.current.set(index, el);
                  else tabRefs.current.delete(index);
                }}
                className={`tab-item ${isActive ? "active" : ""}`}
                onClick={() => onSelectTab(index)}
                onContextMenu={(e) => handleContextMenu(e, index)}
              >
                <span
                  style={{
                    fontSize: "inherit",
                    color: isActive ? "var(--fgColor-default)" : "var(--fgColor-muted)",
                    fontStyle: isEphemeral ? "italic" : "normal",
                    userSelect: "none",
                    whiteSpace: "nowrap",
                    marginRight: 8,
                  }}
                >
                  {tabLabel}
                </span>
                {onCloseTab && (
                  <IconButton
                    icon={XIcon}
                    aria-label={`Close ${tabLabel}`}
                    variant="invisible"
                    size="small"
                    tooltip={false}
                    className="tab-close-button"
                    style={{
                      padding: 1,
                      height: 16,
                      width: 16,
                      opacity: isActive ? 0.7 : 0,
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      onCloseTab(index);
                    }}
                  />
                )}
              </div>
            );
          })}
          <div style={{ flexGrow: 1, borderBottom: "1px solid var(--borderColor-muted)" }} />
        </div>
        {tabCount > 0 && (onRun || onCloseAll) && (
          <div
            ref={controlsRef}
            style={{
              position: "absolute",
              right: 0,
              top: 0,
              bottom: 0,
              display: "flex",
              alignItems: "center",
              gap: 6,
              paddingLeft: 4,
              paddingRight: 8,
              background: "var(--bgColor-default)",
              borderBottom: "1px solid var(--borderColor-muted)",
            }}
          >
            {onRun && (
              <SimpleTooltip text="Run (F5)" side="bottom">
                <Button
                  onClick={onRun}
                  size="sm"
                  style={{
                    height: "22px",
                    paddingLeft: "7px",
                    paddingRight: "9px",
                    fontSize: "12px",
                    fontWeight: 500,
                    borderRadius: "6px",
                  }}
                >
                  <PlayIcon size={14} />
                  Run
                </Button>
              </SimpleTooltip>
            )}
            {onCloseAll && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <IconButton icon={EllipsisIcon} aria-label="Tab options" variant="invisible" size="small" tooltip={false} />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={onCloseAll}>Close All</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        )}
        {showScrollbar && scrollMetrics.width > scrollMetrics.clientWidth && (
          <div
            style={{
              position: "absolute",
              bottom: 0,
              left: Math.max(0, Math.min((scrollMetrics.left / scrollMetrics.width) * scrollMetrics.clientWidth, scrollMetrics.clientWidth - 8)),
              width: Math.min((scrollMetrics.clientWidth / scrollMetrics.width) * scrollMetrics.clientWidth, scrollMetrics.clientWidth),
              height: 2,
              background: "var(--fgColor-muted)",
              borderRadius: 1,
              pointerEvents: "none",
              zIndex: 1,
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
