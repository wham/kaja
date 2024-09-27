import { BaseStyles, Box, ThemeProvider } from "@primer/react";
import { useState } from "react";
import { Compiler } from "./Compiler";
import { Content } from "./Content";
import { Gutter } from "./Gutter";
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
  const [sidebarWidth, setSidebarWidth] = useState(300);

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

  const onSidebarResize = (delta: number) => {
    setSidebarWidth((width) => width + delta);
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
        <Box sx={{ display: "flex", width: "100vw", height: "100vh", bg: "canvas.default" }}>
          <Box sx={{ width: sidebarWidth, minWidth: 100, maxWidth: 600, flexShrink: 0, overflow: "scroll" }}>
            <Sidebar project={project} onSelect={onSelect} currentMethod={selectedEndpoint && selectedEndpoint.method} />
          </Box>
          <Gutter orientation="vertical" onResize={onSidebarResize} />
          <Box sx={{ flexGrow: 1 }}>{content}</Box>
        </Box>
      </BaseStyles>
    </ThemeProvider>
  );
}
