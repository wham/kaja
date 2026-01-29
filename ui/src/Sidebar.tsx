import { useState, useEffect, useRef } from "react";
import { TreeView, IconButton } from "@primer/react";
import { CpuIcon, PencilIcon, PlusIcon, TrashIcon, ChevronRightIcon, PackageIcon } from "@primer/octicons-react";
import { Method, Project, Service, methodId } from "./project";
import { RpcProtocol } from "./server/api";

function getDuplicateServiceNames(services: Service[]): Set<string> {
  const nameCount = new Map<string, number>();
  for (const service of services) {
    nameCount.set(service.name, (nameCount.get(service.name) || 0) + 1);
  }
  const duplicates = new Set<string>();
  for (const [name, count] of nameCount) {
    if (count > 1) {
      duplicates.add(name);
    }
  }
  return duplicates;
}

function ServiceName({ service, showPackage }: { service: Service; showPackage: boolean }) {
  if (!showPackage || !service.packageName) {
    return <>{service.name}</>;
  }
  return (
    <span>
      <span style={{ fontSize: 10, color: "var(--fgColor-muted)" }}>{service.packageName}.</span>
      {service.name}
    </span>
  );
}

function ProtocolPill({ protocol }: { protocol: RpcProtocol }) {
  const isGrpc = protocol === RpcProtocol.GRPC;
  return (
    <span
      style={{
        fontSize: 9,
        fontWeight: "bold",
        padding: "1px 5px",
        borderRadius: 4,
        marginLeft: 6,
        backgroundColor: isGrpc ? "var(--bgColor-severe-muted)" : "var(--bgColor-done-muted)",
        color: isGrpc ? "var(--fgColor-severe)" : "var(--fgColor-done)",
      }}
    >
      {isGrpc ? "gRPC" : "Twirp"}
    </span>
  );
}

interface SidebarProps {
  projects: Project[];
  currentMethod?: Method;
  canDeleteProjects?: boolean;
  onSelect: (method: Method, service: Service, project: Project) => void;
  onCompilerClick: () => void;
  onNewProjectClick: () => void;
  onEditProject: (projectName: string) => void;
  onDeleteProject: (projectName: string) => void;
}

export function Sidebar({ projects, currentMethod, canDeleteProjects = true, onSelect, onCompilerClick, onNewProjectClick, onEditProject, onDeleteProject }: SidebarProps) {
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const elementRefs = useRef<Map<string, HTMLElement>>(new Map());
  const pendingScrollRef = useRef<string | null>(null);

  // Expand first two projects when projects first load
  useEffect(() => {
    setExpandedProjects((prev) => {
      if (prev.size === 0 && projects.length > 0) {
        return new Set(projects.slice(0, 2).map((p) => p.configuration.name));
      }
      return prev;
    });
  }, [projects]);

  // Scroll expanded element into view after DOM updates
  const scrollIntoView = (elementId: string) => {
    requestAnimationFrame(() => {
      const element = elementRefs.current.get(elementId);
      if (element) {
        element.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    });
  };

  // Scroll expanded project into view after state updates
  useEffect(() => {
    if (pendingScrollRef.current) {
      const elementId = pendingScrollRef.current;
      pendingScrollRef.current = null;
      scrollIntoView(elementId);
    }
  }, [expandedProjects]);

  const toggleProjectExpanded = (projectName: string) => {
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(projectName)) {
        next.delete(projectName);
      } else {
        next.add(projectName);
        pendingScrollRef.current = projectName;
      }
      return next;
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <div style={{ display: "flex", alignItems: "center", padding: "4px 12px", flexShrink: 0 }}>
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
        <IconButton icon={PlusIcon} size="small" variant="invisible" aria-label="New Project" onClick={onNewProjectClick} />
        <IconButton icon={CpuIcon} size="small" variant="invisible" aria-label="Open Compiler" onClick={onCompilerClick} />
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "8px 12px", minHeight: 0 }}>
        {projects.map((project, projectIndex) => {
          const projectName = project.configuration.name;
          const isExpanded = expandedProjects.has(projectName);
          const showProjectHeader = true;

          return (
            <nav
              key={projectName}
              ref={(el) => {
                if (el) elementRefs.current.set(projectName, el);
                else elementRefs.current.delete(projectName);
              }}
              aria-label="Services and methods"
              style={{ marginTop: projectIndex > 0 ? 12 : 0 }}
            >
              {showProjectHeader && (
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: "bold",
                    padding: "2px 0",
                    marginLeft: -12,
                    paddingLeft: 4,
                    color: "var(--fgColor-muted)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    cursor: "pointer",
                    userSelect: "none",
                    minHeight: 24,
                  }}
                  onClick={() => toggleProjectExpanded(projectName)}
                >
                  <span style={{ display: "flex", alignItems: "center", gap: 2 }}>
                    <span
                      style={{
                        display: "inline-flex",
                        transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)",
                        transition: "transform 0.12s ease",
                        color: "var(--fgColor-muted)",
                      }}
                    >
                      <ChevronRightIcon size={16} />
                    </span>
                    {projectName}
                    <ProtocolPill protocol={project.configuration.protocol} />
                  </span>
                  {isExpanded && (
                    <span style={{ display: "flex", alignItems: "center", gap: 6, marginRight: 4 }}>
                      <span
                        role="button"
                        aria-label={`Edit ${projectName}`}
                        style={{ cursor: "pointer", display: "inline-flex", padding: 2 }}
                        onClick={(e) => {
                          e.stopPropagation();
                          onEditProject(projectName);
                        }}
                      >
                        <PencilIcon size={14} />
                      </span>
                      {canDeleteProjects && (
                        <span
                          role="button"
                          aria-label={`Delete ${projectName}`}
                          style={{ cursor: "pointer", display: "inline-flex", padding: 2 }}
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeleteProject(projectName);
                          }}
                        >
                          <TrashIcon size={14} />
                        </span>
                      )}
                    </span>
                  )}
                </div>
              )}
              {(isExpanded || !showProjectHeader) && (
                <TreeView aria-label="Services and methods">
                  {project.compilation.status === "running" || project.compilation.status === "pending" ? (
                    <LoadingTreeViewItem />
                  ) : (
                    (() => {
                      const duplicateNames = getDuplicateServiceNames(project.services);
                      return project.services.map((service, serviceIndex) => {
                        const serviceKey = service.packageName ? `${service.packageName}.${service.name}` : service.name;
                        const serviceId = `${projectName}-${serviceKey}`;
                        const showPackage = duplicateNames.has(service.name);
                        return (
                          <TreeView.Item
                            id={serviceId}
                            key={serviceKey}
                            ref={(el: HTMLElement | null) => {
                              if (el) elementRefs.current.set(serviceId, el);
                              else elementRefs.current.delete(serviceId);
                            }}
                            defaultExpanded={projectIndex < 2 && serviceIndex === 0}
                            onExpandedChange={(expanded) => {
                              if (expanded) scrollIntoView(serviceId);
                            }}
                          >
                            <TreeView.LeadingVisual>
                              <PackageIcon size={16} />
                            </TreeView.LeadingVisual>
                            <ServiceName service={service} showPackage={showPackage} />
                            <TreeView.SubTree>
                              {service.methods.map((method) => (
                                <TreeView.Item
                                  id={methodId(service, method)}
                                  key={methodId(service, method)}
                                  onSelect={() => onSelect(method, service, project)}
                                  current={currentMethod === method}
                                >
                                  {method.name}
                                </TreeView.Item>
                              ))}
                            </TreeView.SubTree>
                          </TreeView.Item>
                        );
                      });
                    })()
                  )}
                </TreeView>
              )}
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
