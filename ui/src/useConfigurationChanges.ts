import { useEffect } from "react";
import { isWailsEnvironment, onWailsEvent } from "./wails";

/**
 * Hook that listens for configuration file changes.
 * Uses Wails events in desktop mode and SSE in web mode.
 */
export function useConfigurationChanges(onConfigurationChanged: () => void) {
  useEffect(() => {
    if (isWailsEnvironment()) {
      // Desktop: use Wails events
      return onWailsEvent("configuration:changed", onConfigurationChanged);
    } else {
      // Web: use Server-Sent Events
      const eventSource = new EventSource("/configuration-changes");

      eventSource.addEventListener("changed", () => {
        onConfigurationChanged();
      });

      eventSource.onerror = () => {
        // SSE connection failed - this is expected if the server doesn't support it
        // or during development. Silent fail is fine here.
      };

      return () => {
        eventSource.close();
      };
    }
  }, [onConfigurationChanged]);
}
