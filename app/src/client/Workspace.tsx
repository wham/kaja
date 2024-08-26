import { Box } from "@primer/react";
import { useState } from "react";
import { Content } from "./Content";
import { Sidebar } from "./Sidebar";
import { Endpoint, Method, Project, Service } from "./project";

type WorkspaceProps = {
  project: Project;
  defaultEndpoint: Endpoint;
};

export function Workspace({ project, defaultEndpoint }: WorkspaceProps) {
  const [selectedEndpoint, setSelectedEndpoint] = useState<Endpoint>(defaultEndpoint);

  const onSelect = (service: Service, method: Method) => {
    setSelectedEndpoint({ service, method });
  };

  return (
    <>
      <Box sx={{ width: 300, borderRightWidth: 1, borderRightStyle: "solid", borderRightColor: "border.default", flexShrink: 0, overflow: "scroll" }}>
        <Sidebar project={project} onSelect={onSelect} currentMethod={selectedEndpoint.method} />
      </Box>
      <Box sx={{ flexGrow: 1 }}>
        <Content project={project} service={selectedEndpoint.service} method={selectedEndpoint.method} />
      </Box>
    </>
  );
}
