import { XIcon } from "@primer/octicons-react";
import { Box, IconButton, Text } from "@primer/react";
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
  return <Box>{children}</Box>;
}

export function Tabs({ children, activeTabIndex, onSelectTab, onCloseTab }: TabsProps) {
  return (
    <Box>
      <Box display="flex">
        {React.Children.map(children, (child, index) => {
          const { tabId, tabLabel, isEphemeral } = child.props;
          const isActive = index === activeTabIndex;

          return (
            <Box
              key={tabId}
              display="flex"
              alignItems="center"
              padding="8px 12px"
              cursor="hand"
              borderTop="1px solid"
              borderTopColor={isActive ? "accent.fg" : "transparent"}
              backgroundColor={isActive ? "border.default" : "transparent"}
              sx={{
                fontSize: 14,
                "&:hover": {
                  backgroundColor: "border.default",
                },
              }}
              onClick={() => onSelectTab(index)}
            >
              <Text
                sx={{
                  fontSize: "inherit",
                  color: isActive ? "fg.default" : "fg.muted",
                  fontStyle: isEphemeral ? "italic" : "normal",
                }}
                cursor="pointer"
                marginRight={2}
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
                  onClick={() => onCloseTab(index)}
                />
              )}
            </Box>
          );
        })}
      </Box>
      <Box>{React.Children.map(children, (child, index) => (index === activeTabIndex ? child : null))}</Box>
    </Box>
  );
}
