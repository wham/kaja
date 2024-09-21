import { BaseStyles, Box, ThemeProvider } from "@primer/react";
import { useState } from "react";
import { Compiler } from "./Compiler";
import { Content } from "./Content";
import { Endpoint, Method, Project, Service, getDefaultEndpoint } from "./project";
import { loadProject, registerGlobalTriggers } from "./projectLoader";
import { Sidebar } from "./Sidebar";

// https://github.com/GoogleChromeLabs/jsbi/issues/30#issuecomment-1006088574
(BigInt.prototype as any)["toJSON"] = function () {
  return this.toString();
};

export function App() {
  const [project, setProject] = useState<Project>();
  const [selectedEndpoint, setSelectedEndpoint] = useState<Endpoint>();

  console.log("Rendering App", project);

  const onCompile = async (sources: string[]) => {
    const project = await loadProject(sources);
    registerGlobalTriggers(project.services);
    setProject(project);
    setSelectedEndpoint(getDefaultEndpoint(project.services));
  };

  const onSelect = (service: Service, method: Method) => {
    setSelectedEndpoint({ service, method });
  };

  let content: JSX.Element;

  if (!project || !selectedEndpoint) {
    content = <Compiler onCompile={onCompile} />;
  } else {
    content = <Content project={project} service={selectedEndpoint.service} method={selectedEndpoint.method} />;
  }

  return (
    <ThemeProvider colorMode="night">
      <BaseStyles>
        <Box sx={{ display: "flex", height: "100vh", bg: "canvas.default" }}>
          <Box sx={{ width: 300, borderRightWidth: 1, borderRightStyle: "solid", borderRightColor: "border.default", flexShrink: 0, overflow: "scroll" }}>
            <Sidebar project={project} onSelect={onSelect} currentMethod={selectedEndpoint && selectedEndpoint.method} />
          </Box>
          <Box sx={{ flexGrow: 1 }}>{content}</Box>
        </Box>
      </BaseStyles>
    </ThemeProvider>
  );
}
