import { Box, Text } from "@primer/react";
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

export const Tabs: React.FC<TabsProps> = ({ children, defaultTab }) => {
  const [activeTab, setActiveTab] = useState(defaultTab || children[0].props.tabId);

  return (
    <TabsContext.Provider value={{ activeTab, setActiveTab }}>
      <Box>
        <Box display="flex" borderBottom="1px solid" borderColor="border.default">
          {React.Children.map(children, (child) => {
            const { tabId, tabLabel } = child.props;
            return (
              <Box
                key={tabId}
                padding="8px 16px"
                cursor="pointer"
                borderBottom={activeTab === tabId ? "2px solid" : "none"}
                borderColor={activeTab === tabId ? "accent.fg" : "transparent"}
                onClick={() => setActiveTab(tabId)}
              >
                <Text color={activeTab === tabId ? "accent.fg" : "fg.muted"}>{tabLabel}</Text>
              </Box>
            );
          })}
        </Box>
        <Box padding="16px">
          <TabsContext.Provider value={{ activeTab, setActiveTab }}>{children}</TabsContext.Provider>
        </Box>
      </Box>
    </TabsContext.Provider>
  );
};
