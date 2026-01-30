import { KebabHorizontalIcon, XIcon } from "@primer/octicons-react";
import { ActionList, ActionMenu, IconButton, useResponsiveValue } from "@primer/react";
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
}

interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  tabIndex: number;
}

export function Tab({ children }: TabProps) {
  return <>{children}</>;
}

export function Tabs({ children, activeTabIndex, onSelectTab, onCloseTab, onCloseAll, onCloseOthers }: TabsProps) {
  const isNarrow = useResponsiveValue({ narrow: true, regular: false, wide: false }, false);
  const overflow = isNarrow ? "auto" : "hidden";
  const tabsHeaderRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const prevTabCount = useRef(React.Children.count(children));
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({ visible: false, x: 0, y: 0, tabIndex: -1 });
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
      const menuButtonWidth = onCloseAll ? 40 : 0;
      if (tabRight > visibleRight - menuButtonWidth) {
        container.scrollTo({
          left: tabRight - container.clientWidth + menuButtonWidth + 8,
          behavior: "smooth",
        });
      }
    }
  }, [onCloseAll]);

  useEffect(() => {
    const currentTabCount = React.Children.count(children);
    if (currentTabCount > prevTabCount.current) {
      scrollToTab(currentTabCount - 1);
    }
    prevTabCount.current = currentTabCount;
  }, [children, scrollToTab]);

  const handleContextMenu = useCallback((event: React.MouseEvent, index: number) => {
    event.preventDefault();
    setContextMenu({ visible: true, x: event.clientX, y: event.clientY, tabIndex: index });
  }, []);

  const closeContextMenu = useCallback(() => {
    setContextMenu((prev) => ({ ...prev, visible: false }));
  }, []);

  useEffect(() => {
    if (contextMenu.visible) {
      const handleClick = () => closeContextMenu();
      const handleEscape = (e: KeyboardEvent) => {
        if (e.key === "Escape") closeContextMenu();
      };
      document.addEventListener("click", handleClick);
      document.addEventListener("keydown", handleEscape);
      return () => {
        document.removeEventListener("click", handleClick);
        document.removeEventListener("keydown", handleEscape);
      };
    }
  }, [contextMenu.visible, closeContextMenu]);

  const tabCount = React.Children.count(children);

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <style>{`
        .tabs-header::-webkit-scrollbar {
          display: none;
        }
        .tabs-header::after {
          content: '';
          position: absolute;
          bottom: 0;
          left: 0;
          right: 0;
          height: 1px;
          background: var(--borderColor-default);
          pointer-events: none;
        }
        .tab-item {
          display: flex;
          align-items: center;
          padding: 8px 10px 8px 16px;
          border-top: 1px solid transparent;
          border-right: 1px solid var(--borderColor-default);
          border-bottom: 1px solid transparent;
          font-size: 14px;
          cursor: pointer;
          background-color: transparent;
        }
        .tab-item:hover {
          background-color: var(--bgColor-neutral-muted);
        }
        .tab-item.active {
          border-top-color: var(--fgColor-accent);
          border-bottom-color: var(--bgColor-muted);
          background-color: var(--bgColor-muted);
        }
        .tab-close-button:hover {
          opacity: 1 !important;
          background-color: var(--bgColor-neutral-muted);
        }
        .tab-item:hover .tab-close-button {
          opacity: 1 !important;
        }
        .tab-context-menu {
          position: fixed;
          background: var(--bgColor-default);
          border: 1px solid var(--borderColor-default);
          border-radius: 6px;
          box-shadow: 0 8px 24px rgba(0,0,0,0.12);
          z-index: 1000;
          min-width: 140px;
          padding: 4px 0;
        }
        .tab-context-menu-item {
          padding: 8px 12px;
          cursor: pointer;
          font-size: 14px;
          color: var(--fgColor-default);
        }
        .tab-context-menu-item:hover {
          background: var(--bgColor-neutral-muted);
        }
      `}</style>
      <div className="tabs-wrapper" style={{ position: "relative", flexShrink: 0 }} onMouseEnter={() => setShowScrollbar(true)} onMouseLeave={() => setShowScrollbar(false)}>
        <div
          ref={tabsHeaderRef}
          className="tabs-header"
          style={{ display: "flex", overflowX: "auto", paddingRight: onCloseAll && tabCount > 0 ? 32 : 0, position: "relative" }}
        >
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
          <div style={{ flexGrow: 1 }} />
        </div>
        {onCloseAll && tabCount > 0 && (
          <div style={{ position: "absolute", right: 0, top: 0, bottom: 0, display: "flex", alignItems: "center", paddingLeft: 4, paddingRight: 4, background: "var(--bgColor-default)", borderBottom: "1px solid var(--borderColor-default)" }}>
            <ActionMenu>
              <ActionMenu.Anchor>
                <IconButton icon={KebabHorizontalIcon} aria-label="Tab options" variant="invisible" size="small" />
              </ActionMenu.Anchor>
              <ActionMenu.Overlay>
                <ActionList>
                  <ActionList.Item onSelect={onCloseAll}>Close All</ActionList.Item>
                </ActionList>
              </ActionMenu.Overlay>
            </ActionMenu>
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
      {contextMenu.visible && (
        <div className="tab-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }}>
          {onCloseTab && (
            <div
              className="tab-context-menu-item"
              onClick={() => {
                onCloseTab(contextMenu.tabIndex);
                closeContextMenu();
              }}
            >
              Close
            </div>
          )}
          {onCloseOthers && tabCount > 1 && (
            <div
              className="tab-context-menu-item"
              onClick={() => {
                onCloseOthers(contextMenu.tabIndex);
                closeContextMenu();
              }}
            >
              Close Others
            </div>
          )}
        </div>
      )}
    </div>
  );
}
