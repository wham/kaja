import { XIcon } from "@primer/octicons-react";
import { Box, IconButton, Text } from "@primer/react";
import React, { createContext, ReactElement, useContext, useState } from "react";

interface TabsContextType {
  activeTab: string;
  setActiveTab: (id: string) => void;
}

const TabsContext = createContext<TabsContextType | null>(null);

export interface Tabbable {
  tabId: string;
  tabLabel: string;
}

interface TabsProps {
  children: ReactElement<Tabbable>[];
  defaultTab?: string;
  onCloseTab?: (tabId: string) => void;
}

interface TabProps extends Tabbable {
  children: React.ReactNode;
}

export const Tab: React.FC<TabProps> = ({ children, tabId }) => {
  const context = useContext(TabsContext);
  if (!context) throw new Error("Tab must be used within Tabs");

  const { activeTab } = context;
  const isActive = activeTab === tabId;

  return isActive ? <Box>{children}</Box> : null;
};

export const Tabs: React.FC<TabsProps> = ({ children, defaultTab, onCloseTab }) => {
  const [activeTab, setActiveTab] = useState(defaultTab || children[0]?.props.tabId);

  const handleCloseTab = (event: React.MouseEvent, tabId: string) => {
    event.stopPropagation();
    onCloseTab?.(tabId);
  };

  return (
    <TabsContext.Provider value={{ activeTab, setActiveTab }}>
      <Box>
        <Box display="flex" borderBottom="1px solid" borderColor="border.default">
          {React.Children.map(children, (child) => {
            const { tabId, tabLabel } = child.props;
            return (
              <Box
                key={tabId}
                display="flex"
                alignItems="center"
                padding="8px 12px"
                cursor="pointer"
                borderBottom={activeTab === tabId ? "2px solid" : "none"}
                borderColor={activeTab === tabId ? "accent.fg" : "transparent"}
                onClick={() => setActiveTab(tabId)}
                sx={{
                  "&:hover": {
                    backgroundColor: "canvas.subtle",
                  },
                }}
              >
                <Text color={activeTab === tabId ? "accent.fg" : "fg.muted"} marginRight={2}>
                  {tabLabel}
                </Text>
                {onCloseTab && (
                  <IconButton
                    icon={XIcon}
                    aria-label={`Close ${tabLabel}`}
                    variant="invisible"
                    size="small"
                    sx={{
                      padding: "4px",
                      opacity: activeTab === tabId ? 1 : 0,
                      "&:hover": {
                        backgroundColor: "canvas.default",
                      },
                      ":hover&": {
                        opacity: 1,
                      },
                    }}
                    onClick={(e) => handleCloseTab(e, tabId)}
                  />
                )}
              </Box>
            );
          })}
        </Box>
        <Box>{children}</Box>
      </Box>
    </TabsContext.Provider>
  );
};
