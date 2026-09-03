import { useCallback, useEffect, useState } from "react";

import { rpcErrorMessage } from "./rpcMessage";
import { ScriptReference, scanScriptVariables } from "./scriptFiles";

// The Variables screen's script references, which are one call rather than a
// search per variable: the walk happens where the disk is, so the column is
// answered in one round trip and there is no queue for the screen to pace. It
// runs when the screen is shown and whenever the workspace names a different set
// of variables, which is what makes coming back from editing a script enough to
// bring the counts up to date.

export type VariableScan =
  { status: "scanning" } | { status: "scanned"; at: number; references: Map<string, ScriptReference[]>; truncated: boolean } | { status: "failed" };

export function useVariableScan(names: string[], active: boolean): { scan: VariableScan; rescan: () => void } {
  const [scan, setScan] = useState<VariableScan>({ status: "scanning" });
  const [attempt, setAttempt] = useState(0);
  const key = [...names].sort().join("\n");

  useEffect(() => {
    if (!active) return;
    let current = true;
    setScan({ status: "scanning" });

    void scanScriptVariables(key === "" ? [] : key.split("\n"))
      .then(({ references, truncated }) => {
        if (current) setScan({ status: "scanned", at: Date.now(), references, truncated });
      })
      .catch((error) => {
        // The scripts folder being unreadable is not a variables problem, so the
        // column says the scan failed rather than the footer saying kaja did.
        console.error(`Scanning scripts for variable references failed: ${rpcErrorMessage(error)}`);
        if (current) setScan({ status: "failed" });
      });

    return () => {
      current = false;
    };
  }, [active, attempt, key]);

  const rescan = useCallback(() => setAttempt((count) => count + 1), []);
  return { scan, rescan };
}
