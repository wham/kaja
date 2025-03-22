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
  onProjects: (projects: Project[]) => void;
}

export function Compiler({ onProjects }: CompilerProps) {
  const [consoleItems, setConsoleItems] = useState<ConsoleItem[]>([]);
  const numberOfProjects = useRef(0);
  const projects = useRef<Project[]>([]);
  const client = getApiClient();

  const compile = async (ignoreToken: IgnoreToken, configurationProject: ConfigurationProject, logOffset: number) => {
    const { response } = await client.compile({
      logOffset,
      force: true,
      projectName: configurationProject.name,
      workspace: configurationProject.workspace,
    });

    if (ignoreToken.ignore) {
      return;
    }

    setConsoleItems((consoleItems) => [...consoleItems, response.logs]);

    if (response.status === CompileStatus.STATUS_RUNNING) {
      setTimeout(() => {
        compile(ignoreToken, configurationProject, logOffset + response.logs.length);
      }, 1000);
    } else {
      const project = await loadProject(response.sources, configurationProject);
      console.log("Project loaded", project);
      projects.current.push(project);
      if (projects.current.length === numberOfProjects.current) {
        onProjects(projects.current);
      }
    }
  };

  useEffect(() => {
    const ignoreToken: IgnoreToken = { ignore: false };

    client.getConfiguration({}).then(({ response }) => {
      setConsoleItems((consoleItems) => [...consoleItems, response.logs]);
      console.log("Configuration", response.configuration);

      numberOfProjects.current = response.configuration?.projects.length ?? 0;
      response.configuration?.projects.forEach((configurationProject) => {
        compile(ignoreToken, configurationProject, 0);
      });
    });

    return () => {
      ignoreToken.ignore = true;
    };
  }, []);

  return <Console items={consoleItems} />;
}
