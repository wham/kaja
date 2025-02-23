import { useEffect, useRef, useState } from "react";
import { Console, ConsoleItem } from "./Console";
import { Project } from "./project";
import { loadProject } from "./projectLoader";
import { CompileStatus, ConfigurationProject } from "./server/api";
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

  const compile = async (ignoreToken: IgnoreToken, configurationProject: ConfigurationProject) => {
    const { response } = await client.compile({ logOffset: logsOffsetRef.current, force: true });

    if (ignoreToken.ignore) {
      return;
    }

    logsOffsetRef.current += response.logs.length;
    setConsoleItems((consoleItems) => [...consoleItems, response.logs]);

    if (response.status === CompileStatus.STATUS_RUNNING) {
      setTimeout(() => {
        compile(ignoreToken, configurationProject);
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

    client.getConfiguration({}).then(({ response }) => {
      console.log("Configuration", response.configuration);
      response.configuration?.projects.forEach((configurationProject) => {
        compile(ignoreToken, configurationProject);
      });
    });

    return () => {
      ignoreToken.ignore = true;
    };
  }, []);

  return <Console items={consoleItems} />;
}
