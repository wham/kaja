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

  const scrollToTab = useCallback((index: number) => {
    const tabElement = tabRefs.current.get(index);
    if (tabElement && tabsHeaderRef.current) {
      tabElement.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
    }
  }, []);

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
          height: 2px;
        }
        .tabs-header::-webkit-scrollbar-track {
          background-color: var(--bgColor-neutral-muted);
        }
        .tabs-header:hover::-webkit-scrollbar-thumb {
          background-color: var(--fgColor-muted);
        }
        .tabs-header::-webkit-scrollbar-thumb {
          background-color: transparent;
        }
        .tab-item {
          display: flex;
          align-items: center;
          padding: 8px 10px 8px 16px;
          border-top: 1px solid transparent;
          border-right: 1px solid var(--borderColor-default);
          font-size: 14px;
          cursor: pointer;
          background-color: transparent;
        }
        .tab-item:hover {
          background-color: var(--bgColor-neutral-muted);
        }
        .tab-item.active {
          border-top-color: var(--fgColor-accent);
          background-color: var(--bgColor-neutral-muted);
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
      <div style={{ position: "relative", flexShrink: 0, borderBottom: "1px solid var(--borderColor-default)" }}>
        <div
          ref={tabsHeaderRef}
          className="tabs-header"
          style={{ display: "flex", overflowX: "scroll", overflowY: "hidden", paddingRight: onCloseAll && tabCount > 0 ? 32 : 0 }}
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
          <div style={{ position: "absolute", right: 0, top: 0, bottom: 0, display: "flex", alignItems: "center", paddingLeft: 4, paddingRight: 4, background: "var(--bgColor-default)" }}>
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
