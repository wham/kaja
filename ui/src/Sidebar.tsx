import { TreeView, IconButton } from "@primer/react";
import { CpuIcon, PencilIcon, PlusIcon, TrashIcon } from "@primer/octicons-react";
import { Method, Project, methodId } from "./project";
import { RpcProtocol } from "./server/api";

function ProtocolPill({ protocol }: { protocol: RpcProtocol }) {
  const isGrpc = protocol === RpcProtocol.GRPC;
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 500,
        padding: "1px 5px",
        borderRadius: 4,
        marginLeft: 6,
        backgroundColor: isGrpc ? "var(--bgColor-success-muted)" : "var(--bgColor-done-muted)",
        color: isGrpc ? "var(--fgColor-success)" : "var(--fgColor-done)",
      }}
    >
      {isGrpc ? "gRPC" : "Twirp"}
    </span>
  );
}

interface SidebarProps {
  projects: Project[];
  currentMethod?: Method;
  canUpdateConfiguration: boolean;
  onSelect: (method: Method) => void;
  onCompilerClick: () => void;
  onNewProjectClick: () => void;
  onEditProject: (projectName: string) => void;
  onDeleteProject: (projectName: string) => void;
}

export function Sidebar({ projects, currentMethod, canUpdateConfiguration, onSelect, onCompilerClick, onNewProjectClick, onEditProject, onDeleteProject }: SidebarProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          padding: "4px 12px",
        }}
      >
        <div
          style={{
            flex: 1,
            fontSize: 12,
            fontWeight: 600,
            color: "var(--fgColor-muted)",
            textTransform: "uppercase",
            letterSpacing: "0.5px",
            userSelect: "none",
          }}
        >
          Explorer
        </div>
        {canUpdateConfiguration && <IconButton icon={PlusIcon} size="small" variant="invisible" aria-label="New Project" onClick={onNewProjectClick} />}
        <IconButton icon={CpuIcon} size="small" variant="invisible" aria-label="Open Compiler" onClick={onCompilerClick} />
      </div>
      <div style={{ flex: 1, overflow: "auto", padding: "8px 12px" }}>
        {projects.map((project) => {
          return (
            <nav key={project.configuration.name} aria-label="Services and methods">
              {(projects.length > 1 || canUpdateConfiguration) && (
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: "bold",
                    padding: "2px 0",
                    color: "var(--fgColor-muted)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <span style={{ display: "flex", alignItems: "center" }}>
                      {project.configuration.name}
                      <ProtocolPill protocol={project.configuration.protocol} />
                    </span>
                  {canUpdateConfiguration && (
                    <span style={{ display: "flex", gap: 2 }}>
                      <IconButton
                        icon={PencilIcon}
                        size="small"
                        variant="invisible"
                        aria-label={`Edit ${project.configuration.name}`}
                        onClick={() => onEditProject(project.configuration.name)}
                      />
                      <IconButton
                        icon={TrashIcon}
                        size="small"
                        variant="invisible"
                        aria-label={`Delete ${project.configuration.name}`}
                        onClick={() => onDeleteProject(project.configuration.name)}
                      />
                    </span>
                  )}
                </div>
              )}
              <TreeView aria-label="Services and methods">
                {project.compilation.status === "running" || project.compilation.status === "pending" ? (
                  <LoadingTreeViewItem />
                ) : (
                  project.services.map((service, index) => (
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
                  ))
                )}
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
      <TreeView.SubTree state="loading" count={3} />
    </TreeView.Item>
  );
}
