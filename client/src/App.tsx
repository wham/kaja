import { BaseStyles, Box, Spinner, ThemeProvider } from "@primer/react";
import { useEffect, useState } from "react";
import { Blankslate } from "./Blankslate";
import { Workspace } from "./Workspace";
import { Project, getDefaultEndpoint } from "./project";
import { loadProject, registerGlobalTriggers } from "./projectLoader";

// https://github.com/GoogleChromeLabs/jsbi/issues/30#issuecomment-1006088574
(BigInt.prototype as any)["toJSON"] = function () {
  return this.toString();
};

export function App() {
  const [project, setProject] = useState<Project>();
  console.log("Rendering App", project);

  useEffect(() => {
    const load = async () => {
      const project = await loadProject([]);
      registerGlobalTriggers(project.services);
      setProject(project);
    };

    load();
  }, []);

  const onCompile = async (sources: string[]) => {
    const project = await loadProject(sources);
    registerGlobalTriggers(project.services);
    setProject(project);
  };

  const defaultEndpoint = project ? getDefaultEndpoint(project.services) : undefined;

  let content: JSX.Element;

  if (!project) {
    content = (
      <Box>
        <Spinner /> Loading...
      </Box>
    );
  } else if (!defaultEndpoint) {
    content = <Blankslate onCompile={onCompile} />;
  } else {
    content = <Workspace project={project} defaultEndpoint={defaultEndpoint} />;
  }

  return (
    <ThemeProvider colorMode="night">
      <BaseStyles>
        <Box sx={{ display: "flex", height: "100vh", bg: "canvas.default" }}>{content}</Box>
      </BaseStyles>
    </ThemeProvider>
  );
}
