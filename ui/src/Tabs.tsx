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
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <style>{`
        .tabs-header::-webkit-scrollbar {
          height: 2px;
        }
        .tabs-header::-webkit-scrollbar-track {
          background-color: #1e1e1e;
        }
        .tabs-header:hover::-webkit-scrollbar-thumb {
          background-color: rgba(255, 255, 255, 0.5);
        }
        .tabs-header::-webkit-scrollbar-thumb {
          background-color: transparent;
        }
      `}</style>
      <div
        className="tabs-header"
        style={{
          display: "flex",
          overflowX: "auto",
          flexShrink: 0,
        }}
      >
        {React.Children.map(children, (child, index) => {
          const { tabId, tabLabel, isEphemeral } = child.props;
          const isActive = index === activeTabIndex;

          return (
            <div
              key={tabId}
              style={{
                display: "flex",
                alignItems: "center",
                padding: "8px 10px 8px 16px",
                borderTop: "1px solid",
                borderTopColor: isActive ? "var(--fgColor-accent)" : "transparent",
                backgroundColor: isActive ? "#1e1e1e" : "transparent",
                borderBottom: "1px solid",
                borderBottomColor: isActive ? "transparent" : "var(--borderColor-default)",
                borderRight: "1px solid",
                borderRightColor: "var(--borderColor-default)",
                fontSize: 14,
                cursor: "pointer",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = "#1e1e1e";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = isActive ? "#1e1e1e" : "transparent";
              }}
              onClick={() => onSelectTab(index)}
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
                  sx={{
                    padding: 1,
                    height: 16,
                    width: 16,
                    opacity: isActive ? 0.7 : 0,
                    "&:hover": {
                      opacity: 1,
                      backgroundColor: "neutral.muted",
                    },
                    "[role='tab']:hover &": {
                      opacity: 1,
                    },
                  }}
                  onClick={() => onCloseTab(index)}
                />
              )}
            </div>
          );
        })}
        <div style={{ flexGrow: 1, borderBottom: "1px solid", borderBottomColor: "var(--borderColor-default)" }} />
      </div>
      <div style={{ flexGrow: 1, display: "flex", flexDirection: "column" }}>
        {React.Children.map(children, (child, index) => (
          <div
            key={child.props.tabId}
            style={{
              display: index === activeTabIndex ? "flex" : "none",
              flexDirection: "column",
              height: "100%",
            }}
          >
            {child}
          </div>
        ))}
      </div>
    </div>
  );
}
