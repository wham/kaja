import { XIcon } from "@primer/octicons-react";
import { IconButton } from "@primer/react";
import React, { ReactElement } from "react";

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
}

export function Tab({ children }: TabProps) {
  return <>{children}</>;
}

export function Tabs({ children, activeTabIndex, onSelectTab, onCloseTab }: TabsProps) {
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
          border-bottom: 1px solid var(--borderColor-default);
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
          border-bottom-color: transparent;
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
        className="tabs-header"
        style={{ display: "flex", overflowX: "auto", flexShrink: 0 }}
      >
        {React.Children.map(children, (child, index) => {
          const { tabId, tabLabel, isEphemeral } = child.props;
          const isActive = index === activeTabIndex;

          return (
            <div key={tabId} className={`tab-item ${isActive ? "active" : ""}`} onClick={() => onSelectTab(index)}>
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
                  onClick={() => onCloseTab(index)}
                />
              )}
            </div>
          );
        })}
        <div style={{ flexGrow: 1, borderBottom: "1px solid var(--borderColor-default)" }} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, overflow: "auto", WebkitOverflowScrolling: "touch" }}>
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
    </div>
  );
}
