import { Box } from "@primer/react";
import { useEffect, useRef, useState } from "react";
import { Console } from "./Console";
import { CompileStatus, Log } from "./server/api";
import { getApiClient } from "./server/connection";

interface IgnoreToken {
  ignore: boolean;
}

interface CompilerProps {
  onCompile: (sources: string[]) => void;
}

export function Compiler({ onCompile }: CompilerProps) {
  const [logs, setLogs] = useState<Log[]>([]);
  const logsRef = useRef(logs);
  const client = getApiClient();

  const compile = (ignoreToken: IgnoreToken) => {
    console.log("Current logs", logsRef.current);
    client.compile({ logOffset: logsRef.current.length }).then(({ response }) => {
      if (ignoreToken.ignore) {
        return;
      }

      setLogs([...logsRef.current, ...response.logs]);
      logsRef.current = [...logsRef.current, ...response.logs];

      if (response.status === CompileStatus.STATUS_RUNNING) {
        setTimeout(() => {
          compile(ignoreToken);
        }, 1000);
      } else {
        onCompile(response.sources);
      }
    });
  };

  useEffect(() => {
    const ignoreToken: IgnoreToken = { ignore: false };
    console.log("useEffect");
    compile(ignoreToken);

    return () => {
      ignoreToken.ignore = true;
    };
  }, []);

  return (
    <Box sx={{ flexGrow: 1, padding: [1, 3] }}>
      <Console>
        <Console.Logs logs={logs} />
      </Console>
    </Box>
  );
}
