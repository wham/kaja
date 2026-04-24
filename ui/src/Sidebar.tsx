import { useState, useEffect, useRef } from "react";
import { TreeView, IconButton } from "@primer/react";
import { CpuIcon, FoldIcon, PencilIcon, PlusIcon, TrashIcon, UnfoldIcon, ChevronRightIcon, PackageIcon } from "@primer/octicons-react";
import { Method, Project, Service, methodId } from "./project";
import { RpcProtocol } from "./server/api";
import { getPersistedValue, setPersistedValue } from "./storage";

function hasMultiplePackages(services: Service[]): boolean {
  if (services.length === 0) return false;
  const first = services[0].packageName;
  return services.some((s) => s.packageName !== first);
}

function groupServicesByPackage(services: Service[]): [string, Service[]][] {
  const groups = new Map<string, Service[]>();
  for (const service of services) {
    const pkg = service.packageName;
    if (!groups.has(pkg)) {
      groups.set(pkg, []);
    }
    groups.get(pkg)!.push(service);
  }
  return [...groups.entries()];
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

interface ScrollToMethod {
  method: Method;
  service: Service;
  project: Project;
}

interface SidebarProps {
  projects: Project[];
  currentMethod?: Method;
  scrollToMethod?: ScrollToMethod;
  canDeleteProjects?: boolean;
  onSelect: (method: Method, service: Service, project: Project) => void;
  onCompilerClick: () => void;
  onNewProjectClick: () => void;
  onEditProject: (projectName: string) => void;
  onDeleteProject: (projectName: string) => void;
}

export function Sidebar({
  projects,
  currentMethod,
  scrollToMethod,
  canDeleteProjects = true,
  onSelect,
  onCompilerClick,
  onNewProjectClick,
  onEditProject,
  onDeleteProject,
}: SidebarProps) {
  const hadPersistedState = useRef(getPersistedValue<string[]>("expandedProjects") !== undefined);

  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(() => {
    const stored = getPersistedValue<string[]>("expandedProjects");
    if (Array.isArray(stored)) {
      return new Set(stored.filter((v): v is string => typeof v === "string"));
    }
    return new Set<string>();
  });

  const [expandedServices, setExpandedServices] = useState<Set<string>>(() => {
    const stored = getPersistedValue<string[]>("expandedServices");
    if (Array.isArray(stored)) {
      return new Set(stored.filter((v): v is string => typeof v === "string"));
    }
    return new Set<string>();
  });

  const elementRefs = useRef<Map<string, HTMLElement>>(new Map());
  const pendingScrollRef = useRef<string | null>(null);

  // Helper to get service element id
  const getServiceElementId = (projectName: string, service: Service) => {
    const serviceKey = service.packageName ? `${service.packageName}.${service.name}` : service.name;
    return `${projectName}-${serviceKey}`;
  };

  // Helper to get package element id (used when multiple packages are shown as subtrees)
  const getPackageElementId = (projectName: string, packageName: string) => {
    return `${projectName}-pkg:${packageName}`;
  };

  // Persist expanded state
  useEffect(() => {
    setPersistedValue("expandedProjects", [...expandedProjects]);
  }, [expandedProjects]);

  useEffect(() => {
    setPersistedValue("expandedServices", [...expandedServices]);
  }, [expandedServices]);

  // On first visit, expand first two projects. On subsequent loads, prune stale keys.
  useEffect(() => {
    if (projects.length === 0) return;

    if (!hadPersistedState.current) {
      setExpandedProjects((prev) => {
        if (prev.size === 0) {
          return new Set(projects.slice(0, 2).map((p) => p.configuration.name));
        }
        return prev;
      });
      setExpandedServices((prev) => {
        if (prev.size === 0) {
          const initialServices = new Set<string>();
          projects.slice(0, 2).forEach((project) => {
            if (project.services.length > 0) {
              // If multiple packages, also expand the first package
              if (hasMultiplePackages(project.services)) {
                initialServices.add(getPackageElementId(project.configuration.name, project.services[0].packageName));
              }
              initialServices.add(getServiceElementId(project.configuration.name, project.services[0]));
            }
          });
          return initialServices;
        }
        return prev;
      });
      // Only mark initialized once services exist, so defaults retry after compilation finishes
      if (projects.some((p) => p.services.length > 0)) {
        hadPersistedState.current = true;
      }
      return;
    }

    // Prune stale entries that no longer match current projects/services
    const validProjects = new Set(projects.map((p) => p.configuration.name));
    const validServices = new Set<string>();
    const compilingPrefixes: string[] = [];
    for (const project of projects) {
      if (project.compilation.status === "running" || project.compilation.status === "pending") {
        compilingPrefixes.push(project.configuration.name + "-");
      }
      // Add package IDs as valid when multiple packages exist
      if (hasMultiplePackages(project.services)) {
        const seenPackages = new Set<string>();
        for (const service of project.services) {
          if (!seenPackages.has(service.packageName)) {
            seenPackages.add(service.packageName);
            validServices.add(getPackageElementId(project.configuration.name, service.packageName));
          }
        }
      }
      for (const service of project.services) {
        validServices.add(getServiceElementId(project.configuration.name, service));
      }
    }

    setExpandedProjects((prev) => {
      const pruned = new Set([...prev].filter((p) => validProjects.has(p)));
      if (pruned.size !== prev.size) return pruned;
      return prev;
    });

    setExpandedServices((prev) => {
      const pruned = new Set(
        [...prev].filter((s) => validServices.has(s) || compilingPrefixes.some((prefix) => s.startsWith(prefix))),
      );
      if (pruned.size !== prev.size) return pruned;
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

  // Scroll expanded element into view after state updates
  useEffect(() => {
    if (pendingScrollRef.current) {
      const elementId = pendingScrollRef.current;
      pendingScrollRef.current = null;
      scrollIntoView(elementId);
    }
  }, [expandedProjects, expandedServices]);

  // Handle scrollToMethod: expand project/service and scroll to method
  useEffect(() => {
    if (!scrollToMethod) return;

    const { method, service, project } = scrollToMethod;
    const projectName = project.configuration.name;
    const serviceElementId = getServiceElementId(projectName, service);
    const methodElementId = methodId(service, method);

    // Expand project if not already expanded
    setExpandedProjects((prev) => {
      if (!prev.has(projectName)) {
        const next = new Set(prev);
        next.add(projectName);
        return next;
      }
      return prev;
    });

    // Expand package if multiple packages and not already expanded
    if (hasMultiplePackages(project.services)) {
      const packageElementId = getPackageElementId(projectName, service.packageName);
      setExpandedServices((prev) => {
        if (!prev.has(packageElementId)) {
          const next = new Set(prev);
          next.add(packageElementId);
          return next;
        }
        return prev;
      });
    }

    // Expand service if not already expanded
    setExpandedServices((prev) => {
      if (!prev.has(serviceElementId)) {
        const next = new Set(prev);
        next.add(serviceElementId);
        return next;
      }
      return prev;
    });

    // Schedule scroll after React renders any expansions
    // Use setTimeout to ensure state updates have been processed
    setTimeout(() => {
      scrollIntoView(methodElementId);
    }, 0);
  }, [scrollToMethod]);

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

  const foldAll = () => {
    setExpandedProjects(new Set());
    setExpandedServices(new Set());
  };

  const unfoldAll = () => {
    const allProjects = new Set(projects.map((p) => p.configuration.name));
    const allServices = new Set<string>();
    for (const project of projects) {
      if (hasMultiplePackages(project.services)) {
        const seenPackages = new Set<string>();
        for (const service of project.services) {
          if (!seenPackages.has(service.packageName)) {
            seenPackages.add(service.packageName);
            allServices.add(getPackageElementId(project.configuration.name, service.packageName));
          }
        }
      }
      for (const service of project.services) {
        allServices.add(getServiceElementId(project.configuration.name, service));
      }
    }
    setExpandedProjects(allProjects);
    setExpandedServices(allServices);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <div style={{ display: "flex", alignItems: "center", padding: "4px 12px", flexShrink: 0 }}>
        <IconButton icon={PlusIcon} size="small" variant="invisible" aria-label="New Project" onClick={onNewProjectClick} />
        <IconButton icon={CpuIcon} size="small" variant="invisible" aria-label="Open Compiler" onClick={onCompilerClick} />
        <div style={{ flex: 1 }} />
        <IconButton icon={FoldIcon} size="small" variant="invisible" aria-label="Fold All" onClick={foldAll} />
        <IconButton icon={UnfoldIcon} size="small" variant="invisible" aria-label="Unfold All" onClick={unfoldAll} />
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
                    marginLeft: -12,
                    paddingLeft: 4,
                    color: "var(--fgColor-muted)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    cursor: "pointer",
                    userSelect: "none",
                    height: 28,
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
                    <span style={{ display: "flex", alignItems: "center", gap: 2 }}>
                      <IconButton
                        aria-label={`Edit ${projectName}`}
                        icon={PencilIcon}
                        size="small"
                        variant="invisible"
                        onClick={(e: React.MouseEvent) => {
                          e.stopPropagation();
                          onEditProject(projectName);
                        }}
                      />
                      {canDeleteProjects && (
                        <IconButton
                          aria-label={`Delete ${projectName}`}
                          icon={TrashIcon}
                          size="small"
                          variant="invisible"
                          onClick={(e: React.MouseEvent) => {
                            e.stopPropagation();
                            onDeleteProject(projectName);
                          }}
                        />
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
                      const multiplePackages = hasMultiplePackages(project.services);

                      const renderServiceItem = (service: Service) => {
                        const serviceKey = service.packageName ? `${service.packageName}.${service.name}` : service.name;
                        const svcId = `${projectName}-${serviceKey}`;
                        const isServiceExpanded = expandedServices.has(svcId);
                        return (
                          <TreeView.Item
                            id={svcId}
                            key={serviceKey}
                            ref={(el: HTMLElement | null) => {
                              if (el) elementRefs.current.set(svcId, el);
                              else elementRefs.current.delete(svcId);
                            }}
                            expanded={isServiceExpanded}
                            onExpandedChange={(expanded) => {
                              setExpandedServices((prev) => {
                                const next = new Set(prev);
                                if (expanded) {
                                  next.add(svcId);
                                } else {
                                  next.delete(svcId);
                                }
                                return next;
                              });
                              if (expanded) scrollIntoView(svcId);
                            }}
                          >
                            {service.name}
                            <TreeView.SubTree>
                              {service.methods.map((method) => {
                                const mId = methodId(service, method);
                                return (
                                  <TreeView.Item
                                    id={mId}
                                    key={mId}
                                    ref={(el: HTMLElement | null) => {
                                      if (el) elementRefs.current.set(mId, el);
                                      else elementRefs.current.delete(mId);
                                    }}
                                    onSelect={() => onSelect(method, service, project)}
                                    current={currentMethod === method}
                                  >
                                    {method.name}
                                    {method.serverStreaming && (
                                      <TreeView.TrailingVisual>
                                        <span style={{ fontSize: 10, color: "var(--fgColor-muted)" }}>stream</span>
                                      </TreeView.TrailingVisual>
                                    )}
                                  </TreeView.Item>
                                );
                              })}
                            </TreeView.SubTree>
                          </TreeView.Item>
                        );
                      };

                      if (!multiplePackages) {
                        return project.services.map(renderServiceItem);
                      }

                      return groupServicesByPackage(project.services).map(([packageName, services]) => {
                        const packageId = getPackageElementId(projectName, packageName);
                        const isPackageExpanded = expandedServices.has(packageId);
                        return (
                          <TreeView.Item
                            id={packageId}
                            key={packageId}
                            ref={(el: HTMLElement | null) => {
                              if (el) elementRefs.current.set(packageId, el);
                              else elementRefs.current.delete(packageId);
                            }}
                            expanded={isPackageExpanded}
                            onExpandedChange={(expanded) => {
                              setExpandedServices((prev) => {
                                const next = new Set(prev);
                                if (expanded) {
                                  next.add(packageId);
                                } else {
                                  next.delete(packageId);
                                }
                                return next;
                              });
                              if (expanded) scrollIntoView(packageId);
                            }}
                          >
                            <TreeView.LeadingVisual>
                              <PackageIcon size={16} />
                            </TreeView.LeadingVisual>
                            <span style={{ fontWeight: "normal", color: "var(--fgColor-muted)" }}>{packageName}</span>
                            <TreeView.SubTree>
                              {services.map(renderServiceItem)}
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
