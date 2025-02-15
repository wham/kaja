import { XIcon } from "@primer/octicons-react";
import { Box, IconButton, Text } from "@primer/react";
import React, { ReactElement, useState } from "react";

export interface Tabbable {
  tabId: string;
  tabLabel: string;
}

interface TabsProps {
  children: ReactElement<Tabbable>[];
  onCloseTab?: (tabId: string) => void;
}

interface TabProps extends Tabbable {
  children: React.ReactNode;
}

export function Tab({ children }: TabProps) {
  return <Box>{children}</Box>;
}

export function Tabs({ children, onCloseTab }: TabsProps) {
  const [activeTab, setActiveTab] = useState(children[0]?.props.tabId);

  const handleCloseTab = (event: React.MouseEvent, tabId: string) => {
    event.stopPropagation();
    onCloseTab?.(tabId);
  };

  return (
    <Box>
      <Box display="flex" backgroundColor="canvas.subtle" borderBottom="1px solid" borderColor="border.default">
        {React.Children.map(children, (child) => {
          const { tabId, tabLabel } = child.props;
          const isActive = activeTab === tabId;

          return (
            <Box
              key={tabId}
              display="flex"
              alignItems="center"
              padding="4px 8px"
              cursor="pointer"
              borderTop="2px solid"
              borderColor={isActive ? "accent.fg" : "transparent"}
              backgroundColor={isActive ? "canvas.default" : "transparent"}
              sx={{
                fontSize: 12,
                "&:hover": {
                  backgroundColor: isActive ? "canvas.default" : "canvas.inset",
                },
              }}
              onClick={() => setActiveTab(tabId)}
            >
              <Text
                sx={{
                  fontSize: "inherit",
                  color: isActive ? "fg.default" : "fg.muted",
                }}
                marginRight={1}
              >
                {tabLabel}
              </Text>
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
                  onClick={(e) => handleCloseTab(e, tabId)}
                />
              )}
            </Box>
          );
        })}
      </Box>
      <Box>{React.Children.map(children, (child) => (child.props.tabId == activeTab ? child : null))}</Box>
    </Box>
  );
}
