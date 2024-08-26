import { MarkGithubIcon } from "@primer/octicons-react";
import { Box, Link, Text, TreeView } from "@primer/react";
import { Method, Project, Service, methodId } from "./project";

type SidebarProps = {
  project: Project;
  onSelect: (service: Service, method: Method) => void;
  currentMethod?: Method;
};

export function Sidebar({ project, onSelect, currentMethod }: SidebarProps) {
  return (
    <Box sx={{ display: "flex", flexDirection: "column" }}>
      <Box sx={{ paddingX: 2, flexGrow: 1 }}>
        <nav aria-label="Services and methods">
          <TreeView aria-label="Services and methods">
            {project.services.map((service, index) => {
              return (
                <TreeView.Item id={service.name} key={service.name} defaultExpanded={index === 0}>
                  {service.name}
                  <TreeView.SubTree>
                    {service.methods.map((method) => {
                      return (
                        <TreeView.Item
                          id={methodId(service, method)}
                          key={methodId(service, method)}
                          onSelect={() => onSelect(service, method)}
                          current={currentMethod === method}
                        >
                          {method.name}
                        </TreeView.Item>
                      );
                    })}
                  </TreeView.SubTree>
                </TreeView.Item>
              );
            })}
          </TreeView>
        </nav>
      </Box>
      <Box
        sx={{
          position: "fixed",
          bottom: 0,
          width: 300,
          borderTopWidth: 1,
          paddingX: 2,
          borderTopStyle: "solid",
          borderTopColor: "border.default",
          display: "none",
        }}
      >
        <Link href="https://github.com/wham/kaja-twirp" sx={{ color: "btn.primary.text", fontSize: "12px" }} target="_blank">
          <MarkGithubIcon />
          <Text sx={{ paddingLeft: 1, verticalAlign: "1px" }}>kaja-twirp</Text>
        </Link>
      </Box>
    </Box>
  );
}
