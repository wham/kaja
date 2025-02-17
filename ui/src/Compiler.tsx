import { useEffect, useRef, useState } from "react";
import { Console, ConsoleItem } from "./Console";
import { Project } from "./project";
import { loadProject } from "./projectLoader";
import { CompileStatus } from "./server/api";
import { getApiClient } from "./server/connection";

interface IgnoreToken {
  ignore: boolean;
}

interface CompilerProps {
  onProject: (project: Project) => void;
}

export function Compiler({ onProject }: CompilerProps) {
  const [consoleItems, setConsoleItems] = useState<ConsoleItem[]>([]);
  const logsOffsetRef = useRef(0);
  const client = getApiClient();

  const compile = async (ignoreToken: IgnoreToken) => {
    const { response } = await client.compile({ logOffset: logsOffsetRef.current, force: true });

    if (ignoreToken.ignore) {
      return;
    }

    logsOffsetRef.current += response.logs.length;
    setConsoleItems((consoleItems) => [...consoleItems, response.logs]);

    if (response.status === CompileStatus.STATUS_RUNNING) {
      setTimeout(() => {
        compile(ignoreToken);
      }, 1000);
    } else {
      const project = await loadProject(response.sources, response.rpcProtocol);
      console.log("Project loaded", project);
      onProject(project);
      //setSelectedMethod(getDefaultMethod(project.services));
    }
  };

  useEffect(() => {
    const ignoreToken: IgnoreToken = { ignore: false };
    compile(ignoreToken);

    return () => {
      ignoreToken.ignore = true;
    };
  }, []);

  useEffect(() => {
    client.getConfiguration({}).then((config) => {
      console.log("Configuration", config);
    });
  }, []);

  return <Console items={consoleItems} />;
}
