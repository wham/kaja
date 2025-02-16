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
      <Box display="flex" backgroundColor="canvas.subtle" borderBottom="1px solid" borderColor="border.default">
        {React.Children.map(children, (child, index) => {
          const { tabId, tabLabel, isEphemeral } = child.props;
          const isActive = index === activeTabIndex;

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
              onClick={() => onSelectTab(index)}
            >
              <Text
                sx={{
                  fontSize: "inherit",
                  color: isActive ? "fg.default" : "fg.muted",
                  fontStyle: isEphemeral ? "italic" : "normal",
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
