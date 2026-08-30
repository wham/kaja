import { useEffect } from "react";
import { GetConfigurationResponse } from "./server/api";
import { getApiClient } from "./server/connection";

// How long to wait before opening the stream again. A watch ends when the process
// serving it does, which in development is every rebuild.
const RECONNECT_MS = 2000;

/**
 * Hook that watches the configuration file. WatchConfiguration streams the whole
 * configuration each time the file changes, so there is nothing to fetch after being
 * told - and nothing about the platform to ask, since the desktop's webview reaches
 * the same door a browser does.
 */
export function useConfigurationChanges(onConfigurationChanged: (response: GetConfigurationResponse) => void) {
  useEffect(() => {
    const abort = new AbortController();
    let reconnect: number | undefined;

    const watch = async () => {
      try {
        const call = getApiClient().watchConfiguration({}, { abort: abort.signal });
        for await (const response of call.responses) {
          onConfigurationChanged(response);
        }
      } catch {
        // A watch that ended lost nothing: the next one reports the file as it stands.
      }
      if (!abort.signal.aborted) {
        reconnect = window.setTimeout(watch, RECONNECT_MS);
      }
    };
    watch();

    return () => {
      abort.abort();
      window.clearTimeout(reconnect);
    };
  }, [onConfigurationChanged]);
}
