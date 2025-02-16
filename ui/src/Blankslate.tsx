import { Box, Text } from "@primer/react";

export function Blankslate() {
  return (
    <Box display="flex" flexDirection="column" alignItems="center" justifyContent="center" height="100vh" bg="canvas.default">
      <Text as="h1" fontSize={4} mt={3} color="fg.default">
        Welcome to kaja
      </Text>
      <Text as="p" fontSize={2} mt={2} color="fg.muted">
        Select a method from the sidebar to get started.
      </Text>
    </Box>
  );
}
