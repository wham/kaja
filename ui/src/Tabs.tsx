import { Box, Text } from "@primer/react";
import React, { useState } from "react";

interface Tab {
  id: string;
  label: string;
  content: React.ReactNode;
}

interface TabsProps {
  tabs: Tab[];
}

const Tabs: React.FC<TabsProps> = ({ tabs }) => {
  const [activeTab, setActiveTab] = useState(tabs[0].id);

  return (
    <Box>
      <Box display="flex" borderBottom="1px solid" borderColor="border.default">
        {tabs.map((tab) => (
          <Box
            key={tab.id}
            padding="8px 16px"
            cursor="pointer"
            borderBottom={activeTab === tab.id ? "2px solid" : "none"}
            borderColor={activeTab === tab.id ? "accent.fg" : "transparent"}
            onClick={() => setActiveTab(tab.id)}
          >
            <Text color={activeTab === tab.id ? "accent.fg" : "fg.muted"}>{tab.label}</Text>
          </Box>
        ))}
      </Box>
      <Box padding="16px">{tabs.map((tab) => (tab.id === activeTab ? <Box key={tab.id}>{tab.content}</Box> : null))}</Box>
    </Box>
  );
};

export default Tabs;
