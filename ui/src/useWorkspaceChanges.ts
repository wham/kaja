import { useEffect } from "react";
import { onBrowserValuesChanged, setValuesWorkspace } from "./browserValues";
import { GetWorkspaceResponse } from "./server/api";
import { getApiClient } from "./server/connection";

// How long to wait before opening the stream again. A watch ends when the process
// serving it does, which in development is every rebuild.
const RECONNECT_MS = 2000;

/**
 * Hook that watches kaja.json. WatchWorkspace streams the whole
 * workspace each time the file changes, so there is nothing to fetch after being
 * told - and nothing about the platform to ask, since the desktop's webview reaches
 * the same door a browser does.
 */
export function useWorkspaceChanges(onWorkspaceChanged: (response: GetWorkspaceResponse) => void) {
  useEffect(() => {
    const abort = new AbortController();
    let call: AbortController | undefined;
    let reconnect: number | undefined;

    const watch = async () => {
      window.clearTimeout(reconnect);
      const current = new AbortController();
      call = current;
      abort.signal.addEventListener("abort", () => current.abort(), { once: true });
      try {
        const stream = getApiClient().watchWorkspace({}, { abort: current.signal });
        for await (const response of stream.responses) {
          setValuesWorkspace(response.workspace?.id ?? "");
          onWorkspaceChanged(response);
        }
      } catch {
        // A watch that ended lost nothing: the next one opens on the file as it stands,
        // and the window applies that only where its generation is news.
      }
      if (!abort.signal.aborted && call === current) {
        reconnect = window.setTimeout(watch, RECONNECT_MS);
      }
    };
    watch();

    // A watch reports what a variable resolves to against the values it opened with,
    // so a value this browser kept since is a watch to open again.
    const unsubscribe = onBrowserValuesChanged(() => {
      call?.abort();
      watch();
    });

    return () => {
      unsubscribe();
      abort.abort();
      window.clearTimeout(reconnect);
    };
  }, [onWorkspaceChanged]);
}
