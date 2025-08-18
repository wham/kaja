import { TreeView } from "@primer/react";
import { Method, Project, methodId } from "./project";
import { ActivityBar } from "./ActivityBar";

interface SidebarProps {
  projects: Project[];
  currentMethod?: Method;
  onSelect: (method: Method) => void;
  onCompilerClick: () => void;
}

export function Sidebar({ projects, currentMethod, onSelect, onCompilerClick }: SidebarProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <ActivityBar onCompilerClick={onCompilerClick} />
      <div style={{ flex: 1, overflow: "auto", padding: "4px 8px" }}>
      {projects.map((project) => {
        return (
          <nav key={project.name} aria-label="Services and methods">
            {projects.length > 1 && (
              <div
                style={{
                  fontSize: 12,
                  fontWeight: "bold",
                  padding: "2px 4px",
                  color: "var(--fgColor-muted)",
                }}
              >
                {project.name}
              </div>
            )}
            <TreeView aria-label="Services and methods">
              {project.services.map((service, index) => (
                <TreeView.Item id={service.name} key={service.name} defaultExpanded={index === 0}>
                  {service.name}
                  <TreeView.SubTree>
                    {service.methods.map((method) => (
                      <TreeView.Item
                        id={methodId(service, method)}
                        key={methodId(service, method)}
                        onSelect={() => onSelect(method)}
                        current={currentMethod === method}
                      >
                        {method.name}
                      </TreeView.Item>
                    ))}
                  </TreeView.SubTree>
                </TreeView.Item>
              ))}
            </TreeView>
          </nav>
        );
      })}
      </div>
    </div>
  );
}

function LoadingTreeViewItem() {
  return (
    <TreeView.Item id="loading-tree-view-item" expanded={true}>
      Loading...
      <TreeView.SubTree state="loading" count={20} />
    </TreeView.Item>
  );
}
