import { Box } from "@primer/react";
import { Blankslate as PrimerBlankslate } from "@primer/react/drafts";
import { useEffect, useRef, useState } from "react";
import { BootstrapStatus, Log } from "../shared/api";
import { getApiClient } from "./api";
import { Console } from "./Console";

interface IgnoreToken {
  ignore: boolean;
}

export function Blankslate() {
  const [logs, setLogs] = useState<Log[]>([]);
  const logsRef = useRef(logs);
  const client = getApiClient();

  const bootstrap = (ignoreToken: IgnoreToken) => {
    console.log("Current logs", logsRef.current);
    client.bootstrap({ logOffset: logsRef.current.length }).then(({ response }) => {
      if (ignoreToken.ignore) {
        return;
      }

      setLogs([...logsRef.current, ...response.logs]);
      logsRef.current = [...logsRef.current, ...response.logs];

      if (response.status === BootstrapStatus.STATUS_RUNNING) {
        setTimeout(() => {
          bootstrap(ignoreToken);
        }, 10000);
      }
    });
  };

  useEffect(() => {
    const ignoreToken: IgnoreToken = { ignore: false };
    console.log("useEffect");
    bootstrap(ignoreToken);

    return () => {
      ignoreToken.ignore = true;
    };
  }, []);

  return (
    <Box sx={{ flexGrow: 1 }}>
      <PrimerBlankslate>
        <Console logs={logs} />
      </PrimerBlankslate>
    </Box>
  );
}
