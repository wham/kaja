import { useState, useEffect, useRef } from "react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./components/ui/dropdown-menu";
import { IconButton } from "./components/ui/icon-button";
import { TreeView } from "./components/ui/tree-view";
import {
  CpuIcon,
  FileCodeIcon,
  FoldIcon,
  PencilIcon,
  PinIcon,
  PlusIcon,
  SlidersIcon,
  TrashIcon,
  UnfoldIcon,
  ChevronRightIcon,
  PackageIcon,
  KebabHorizontalIcon,
} from "./components/icons";
import { appType, appTypeLabel } from "./appTypes";
import { IconButtonXSmall } from "./IconButtonXSmall";
import { Method, App, Script, Service, methodId } from "./apps";
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

function AppPill({ type }: { type: string }) {
  return (
    <span
      style={{
        fontSize: 9,
        fontWeight: "bold",
        padding: "1px 5px",
        borderRadius: 4,
        marginLeft: 6,
        backgroundColor: "var(--bgColor-accent-muted)",
        color: "var(--fgColor-accent)",
      }}
    >
      {appTypeLabel(type)}
    </span>
  );
}

export function PreviewPill() {
  return (
    <span
      style={{
        fontSize: 9,
        fontWeight: "bold",
        padding: "1px 5px",
        borderRadius: 4,
        marginLeft: 6,
        backgroundColor: "var(--bgColor-accent-muted)",
        color: "var(--fgColor-accent)",
      }}
    >
      Preview
    </span>
  );
}

interface ScrollToMethod {
  method: Method;
  service: Service;
  app: App;
}

interface SidebarProps {
  apps: App[];
  scripts?: Script[];
  currentMethod?: Method;
  currentScriptPath?: string;
  // Path of the script pinned to the macOS "Run Kaja Script" text service.
  pinnedScriptPath?: string;
  scrollToMethod?: ScrollToMethod;
  canDeleteApps?: boolean;
  onSelect: (method: Method, service: Service, app: App) => void;
  onScriptSelect?: (script: Script) => void;
  onRenameScript?: (script: Script) => void;
  onDeleteScript?: (script: Script) => void;
  onPinScript?: (script: Script) => void;
  onCompilerClick: () => void;
  // Opens the create form to add an app (gRPC, Twirp, or a built-in integration).
  onNewAppClick: () => void;
  // Opens the variables manager tab. Undefined when the feature preview is off.
  onVariablesClick?: () => void;
  // One-shot signal to auto-expand a just-added app (and its first service).
  autoExpandApp?: { name: string };
  // macOS desktop: inset the header row to clear the window traffic lights and make
  // the empty parts draggable, so the controls share the title bar band (saves a row).
  reserveTrafficLights?: boolean;
  onEditApp: (appName: string) => void;
  onDeleteApp: (appName: string) => void;
}

export function Sidebar({
  apps,
  scripts,
  currentMethod,
  currentScriptPath,
  pinnedScriptPath,
  scrollToMethod,
  canDeleteApps = true,
  onSelect,
  onScriptSelect,
  onRenameScript,
  onDeleteScript,
  onPinScript,
  onCompilerClick,
  onNewAppClick,
  onVariablesClick,
  autoExpandApp,
  reserveTrafficLights = false,
  onEditApp,
  onDeleteApp,
}: SidebarProps) {
  const [scriptsExpanded, setScriptsExpanded] = useState<boolean>(() => getPersistedValue<boolean>("scriptsExpanded") ?? true);
  // Right-click context menu for a script, anchored at the cursor.
  const [scriptMenu, setScriptMenu] = useState<{ script: Script; top: number; left: number } | null>(null);
  const scriptMenuAnchorRef = useRef<HTMLDivElement>(null);
  // Script row hovered, used to reveal the kebab actions button.
  const [hoveredScript, setHoveredScript] = useState<string | null>(null);
  // Right-click context menu for an app, anchored at the cursor.
  const [appMenu, setAppMenu] = useState<{ appName: string; top: number; left: number } | null>(null);
  const appMenuAnchorRef = useRef<HTMLDivElement>(null);
  // App row hovered, used to reveal the kebab actions button.
  const [hoveredApp, setHoveredApp] = useState<string | null>(null);

  useEffect(() => {
    setPersistedValue("scriptsExpanded", scriptsExpanded);
  }, [scriptsExpanded]);
  const hadPersistedState = useRef(getPersistedValue<string[]>("expandedApps") !== undefined);

  const [expandedApps, setExpandedApps] = useState<Set<string>>(() => {
    const stored = getPersistedValue<string[]>("expandedApps");
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
  const getServiceElementId = (appName: string, service: Service) => {
    const serviceKey = service.packageName ? `${service.packageName}.${service.name}` : service.name;
    return `${appName}-${serviceKey}`;
  };

  // Helper to get package element id (used when multiple packages are shown as subtrees)
  const getPackageElementId = (appName: string, packageName: string) => {
    return `${appName}-pkg:${packageName}`;
  };

  // Persist expanded state
  useEffect(() => {
    setPersistedValue("expandedApps", [...expandedApps]);
  }, [expandedApps]);

  useEffect(() => {
    setPersistedValue("expandedServices", [...expandedServices]);
  }, [expandedServices]);

  // On first visit, expand first two apps. On subsequent loads, prune stale keys.
  useEffect(() => {
    if (apps.length === 0) return;

    if (!hadPersistedState.current) {
      setExpandedApps((prev) => {
        if (prev.size === 0) {
          return new Set(apps.slice(0, 2).map((p) => p.configuration.name));
        }
        return prev;
      });
      setExpandedServices((prev) => {
        if (prev.size === 0) {
          const initialServices = new Set<string>();
          apps.slice(0, 2).forEach((app) => {
            if (app.services.length > 0) {
              // If multiple packages, also expand the first package
              if (hasMultiplePackages(app.services)) {
                initialServices.add(getPackageElementId(app.configuration.name, app.services[0].packageName));
              }
              initialServices.add(getServiceElementId(app.configuration.name, app.services[0]));
            }
          });
          return initialServices;
        }
        return prev;
      });
      // Only mark initialized once services exist, so defaults retry after compilation finishes
      if (apps.some((p) => p.services.length > 0)) {
        hadPersistedState.current = true;
      }
      return;
    }

    // Prune stale entries that no longer match current apps/services
    const validApps = new Set(apps.map((p) => p.configuration.name));
    const validServices = new Set<string>();
    const compilingPrefixes: string[] = [];
    for (const app of apps) {
      if (app.compilation.status === "running" || app.compilation.status === "pending") {
        compilingPrefixes.push(app.configuration.name + "-");
      }
      // Add package IDs as valid when multiple packages exist
      if (hasMultiplePackages(app.services)) {
        const seenPackages = new Set<string>();
        for (const service of app.services) {
          if (!seenPackages.has(service.packageName)) {
            seenPackages.add(service.packageName);
            validServices.add(getPackageElementId(app.configuration.name, service.packageName));
          }
        }
      }
      for (const service of app.services) {
        validServices.add(getServiceElementId(app.configuration.name, service));
      }
    }

    setExpandedApps((prev) => {
      const pruned = new Set([...prev].filter((p) => validApps.has(p)));
      if (pruned.size !== prev.size) return pruned;
      return prev;
    });

    setExpandedServices((prev) => {
      const pruned = new Set([...prev].filter((s) => validServices.has(s) || compilingPrefixes.some((prefix) => s.startsWith(prefix))));
      if (pruned.size !== prev.size) return pruned;
      return prev;
    });
  }, [apps]);

  // Auto-expand a just-added app. The app is expanded immediately;
  // its first service (and first package, when several exist) is expanded once
  // compilation finishes and services become available.
  const pendingFirstServiceExpand = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!autoExpandApp) return;
    const { name } = autoExpandApp;
    setExpandedApps((prev) => {
      if (prev.has(name)) return prev;
      const next = new Set(prev);
      next.add(name);
      return next;
    });
    pendingFirstServiceExpand.current.add(name);
    pendingScrollRef.current = name;
  }, [autoExpandApp]);

  useEffect(() => {
    if (pendingFirstServiceExpand.current.size === 0) return;
    const idsToExpand: string[] = [];
    const ready: string[] = [];
    for (const name of pendingFirstServiceExpand.current) {
      const app = apps.find((p) => p.configuration.name === name);
      if (app && app.services.length > 0) {
        if (hasMultiplePackages(app.services)) {
          idsToExpand.push(getPackageElementId(name, app.services[0].packageName));
        }
        idsToExpand.push(getServiceElementId(name, app.services[0]));
        ready.push(name);
      }
    }
    if (idsToExpand.length > 0) {
      setExpandedServices((prev) => {
        const next = new Set(prev);
        idsToExpand.forEach((id) => next.add(id));
        return next;
      });
      ready.forEach((n) => pendingFirstServiceExpand.current.delete(n));
    }
  }, [apps]);

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
  }, [expandedApps, expandedServices]);

  // Handle scrollToMethod: expand app/service and scroll to method
  useEffect(() => {
    if (!scrollToMethod) return;

    const { method, service, app } = scrollToMethod;
    const appName = app.configuration.name;
    const serviceElementId = getServiceElementId(appName, service);
    const methodElementId = methodId(service, method);

    // Expand app if not already expanded
    setExpandedApps((prev) => {
      if (!prev.has(appName)) {
        const next = new Set(prev);
        next.add(appName);
        return next;
      }
      return prev;
    });

    // Expand package if multiple packages and not already expanded
    if (hasMultiplePackages(app.services)) {
      const packageElementId = getPackageElementId(appName, service.packageName);
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

  const toggleAppExpanded = (appName: string) => {
    setExpandedApps((prev) => {
      const next = new Set(prev);
      if (next.has(appName)) {
        next.delete(appName);
      } else {
        next.add(appName);
        pendingScrollRef.current = appName;
      }
      return next;
    });
  };

  const foldAll = () => {
    setExpandedApps(new Set());
    setExpandedServices(new Set());
  };

  const unfoldAll = () => {
    const allApps = new Set(apps.map((p) => p.configuration.name));
    const allServices = new Set<string>();
    for (const app of apps) {
      if (hasMultiplePackages(app.services)) {
        const seenPackages = new Set<string>();
        for (const service of app.services) {
          if (!seenPackages.has(service.packageName)) {
            seenPackages.add(service.packageName);
            allServices.add(getPackageElementId(app.configuration.name, service.packageName));
          }
        }
      }
      for (const service of app.services) {
        allServices.add(getServiceElementId(app.configuration.name, service));
      }
    }
    setExpandedApps(allApps);
    setExpandedServices(allServices);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <div
        style={
          reserveTrafficLights
            ? ({
                display: "flex",
                alignItems: "center",
                flexShrink: 0,
                height: 28,
                paddingLeft: 78,
                paddingRight: 8,
                "--wails-draggable": "drag",
              } as React.CSSProperties)
            : { display: "flex", alignItems: "center", padding: "4px 12px", flexShrink: 0 }
        }
      >
        <div
          style={
            reserveTrafficLights
              ? ({ display: "flex", alignItems: "center", "--wails-draggable": "no-drag" } as React.CSSProperties)
              : { display: "flex", alignItems: "center" }
          }
        >
          <IconButton icon={PlusIcon} size="small" variant="invisible" aria-label="New app" onClick={onNewAppClick} />
          <IconButton icon={CpuIcon} size="small" variant="invisible" aria-label="Open Compiler" onClick={onCompilerClick} />
          {onVariablesClick && <IconButton icon={SlidersIcon} size="small" variant="invisible" aria-label="Variables" onClick={onVariablesClick} />}
        </div>
        <div style={{ flex: 1 }} />
        <div
          style={
            reserveTrafficLights
              ? ({ display: "flex", alignItems: "center", "--wails-draggable": "no-drag" } as React.CSSProperties)
              : { display: "flex", alignItems: "center" }
          }
        >
          <IconButton icon={FoldIcon} size="small" variant="invisible" aria-label="Fold All" onClick={foldAll} />
          <IconButton icon={UnfoldIcon} size="small" variant="invisible" aria-label="Unfold All" onClick={unfoldAll} />
        </div>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "8px 12px", minHeight: 0 }}>
        {scripts && scripts.length > 0 && (
          <nav aria-label="Scripts">
            <div
              style={{
                fontSize: 12,
                fontWeight: "bold",
                marginLeft: -12,
                paddingLeft: 4,
                color: "var(--fgColor-muted)",
                display: "flex",
                alignItems: "center",
                cursor: "pointer",
                userSelect: "none",
                height: 28,
                gap: 2,
              }}
              onClick={() => setScriptsExpanded((v) => !v)}
            >
              <span
                style={{
                  display: "inline-flex",
                  transform: scriptsExpanded ? "rotate(90deg)" : "rotate(0deg)",
                  transition: "transform 0.12s ease",
                  color: "var(--fgColor-muted)",
                }}
              >
                <ChevronRightIcon size={16} />
              </span>
              <FileCodeIcon size={16} />
              <span style={{ marginLeft: 4 }}>Scripts</span>
              <PreviewPill />
            </div>
            {scriptsExpanded && (
              <TreeView aria-label="Scripts">
                {scripts.map((script) => (
                  <TreeView.Item
                    id={`script-${script.path}`}
                    key={script.path}
                    ref={(el: HTMLElement | null) => {
                      // TreeView.Item doesn't forward these handlers, so attach them to the DOM node.
                      if (el) {
                        el.oncontextmenu = (e) => {
                          e.preventDefault();
                          setScriptMenu({ script, top: e.clientY, left: e.clientX });
                        };
                        el.onmouseenter = () => setHoveredScript(script.path);
                        el.onmouseleave = () => setHoveredScript((prev) => (prev === script.path ? null : prev));
                      }
                    }}
                    onSelect={() => onScriptSelect?.(script)}
                    current={currentScriptPath === script.path}
                  >
                    {/* Pin lives in the leading slot so it never shifts when the kebab appears on
                        hover, and it lines a pinned script up with the package/expand icons above. */}
                    {pinnedScriptPath === script.path && (
                      <TreeView.LeadingVisual>
                        <PinIcon size={12} />
                      </TreeView.LeadingVisual>
                    )}
                    {script.name}
                    <TreeView.TrailingVisual>
                      {(hoveredScript === script.path || scriptMenu?.script.path === script.path) && (
                        <IconButtonXSmall
                          aria-label={`Actions for ${script.name}`}
                          icon={KebabHorizontalIcon}
                          rounded
                          style={{ minHeight: 0, minWidth: 0 }}
                          onClick={(e: React.MouseEvent) => {
                            e.stopPropagation();
                            setScriptMenu({ script, top: e.clientY, left: e.clientX });
                          }}
                        />
                      )}
                    </TreeView.TrailingVisual>
                  </TreeView.Item>
                ))}
              </TreeView>
            )}
          </nav>
        )}
        {apps.map((app, appIndex) => {
          const appName = app.configuration.name;
          const isExpanded = expandedApps.has(appName);
          const showAppHeader = true;
          const showTopMargin = appIndex > 0 || (scripts && scripts.length > 0);

          return (
            <nav
              key={appName}
              ref={(el) => {
                if (el) elementRefs.current.set(appName, el);
                else elementRefs.current.delete(appName);
              }}
              aria-label="Services and methods"
              style={{ marginTop: showTopMargin ? 12 : 0 }}
            >
              {showAppHeader && (
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: "bold",
                    marginLeft: -12,
                    paddingLeft: 4,
                    paddingRight: 4,
                    borderRadius: 6,
                    color: "var(--fgColor-muted)",
                    backgroundColor: hoveredApp === appName || appMenu?.appName === appName ? "var(--control-transparent-bgColor-hover)" : "transparent",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    cursor: "pointer",
                    userSelect: "none",
                    height: 28,
                  }}
                  onMouseEnter={() => setHoveredApp(appName)}
                  onMouseLeave={() => setHoveredApp((prev) => (prev === appName ? null : prev))}
                  onClick={() => toggleAppExpanded(appName)}
                  onContextMenu={(e: React.MouseEvent) => {
                    e.preventDefault();
                    setAppMenu({ appName, top: e.clientY, left: e.clientX });
                  }}
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
                    {appName}
                    <AppPill type={appType(app.configuration)} />
                  </span>
                  {(hoveredApp === appName || appMenu?.appName === appName) && (
                    <IconButtonXSmall
                      aria-label={`Actions for ${appName}`}
                      icon={KebabHorizontalIcon}
                      rounded
                      style={{ minHeight: 0, minWidth: 0 }}
                      onClick={(e: React.MouseEvent) => {
                        e.stopPropagation();
                        setAppMenu({ appName, top: e.clientY, left: e.clientX });
                      }}
                    />
                  )}
                </div>
              )}
              {(isExpanded || !showAppHeader) && (
                <TreeView aria-label="Services and methods">
                  {app.compilation.status === "running" || app.compilation.status === "pending" ? (
                    <LoadingTreeViewItem />
                  ) : (
                    (() => {
                      const multiplePackages = hasMultiplePackages(app.services);

                      const renderServiceItem = (service: Service) => {
                        const serviceKey = service.packageName ? `${service.packageName}.${service.name}` : service.name;
                        const svcId = `${appName}-${serviceKey}`;
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
                                    onSelect={() => onSelect(method, service, app)}
                                    current={currentMethod === method}
                                  >
                                    {method.name}
                                  </TreeView.Item>
                                );
                              })}
                            </TreeView.SubTree>
                          </TreeView.Item>
                        );
                      };

                      if (!multiplePackages) {
                        return <>{app.services.map(renderServiceItem)}</>;
                      }

                      const packageNodes = groupServicesByPackage(app.services).map(([packageName, services]) => {
                        const packageId = getPackageElementId(appName, packageName);
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
                            <TreeView.SubTree>{services.map(renderServiceItem)}</TreeView.SubTree>
                          </TreeView.Item>
                        );
                      });
                      return <>{packageNodes}</>;
                    })()
                  )}
                </TreeView>
              )}
            </nav>
          );
        })}
      </div>
      {/* Cursor-anchored context menu for a script. */}
      <DropdownMenu open={!!scriptMenu} onOpenChange={(open) => !open && setScriptMenu(null)}>
        <DropdownMenuTrigger asChild>
          <div
            ref={scriptMenuAnchorRef}
            style={{ position: "fixed", top: scriptMenu?.top ?? 0, left: scriptMenu?.left ?? 0, width: 1, height: 1, pointerEvents: "none" }}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-48">
          {onPinScript && (
            <DropdownMenuItem
              onSelect={() => {
                const script = scriptMenu?.script;
                if (script) onPinScript(script);
              }}
            >
              <PinIcon size={16} />
              {pinnedScriptPath === scriptMenu?.script.path ? "Unpin from context menu" : "Pin to context menu"}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            onSelect={() => {
              const script = scriptMenu?.script;
              if (script) onRenameScript?.(script);
            }}
          >
            <PencilIcon size={16} />
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="danger"
            onSelect={() => {
              const script = scriptMenu?.script;
              if (script) onDeleteScript?.(script);
            }}
          >
            <TrashIcon size={16} />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {/* Cursor-anchored context menu for an app. */}
      <DropdownMenu open={!!appMenu} onOpenChange={(open) => !open && setAppMenu(null)}>
        <DropdownMenuTrigger asChild>
          <div
            ref={appMenuAnchorRef}
            style={{ position: "fixed", top: appMenu?.top ?? 0, left: appMenu?.left ?? 0, width: 1, height: 1, pointerEvents: "none" }}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-48">
          <DropdownMenuItem
            onSelect={() => {
              const appName = appMenu?.appName;
              if (appName) onEditApp(appName);
            }}
          >
            <PencilIcon size={16} />
            Edit
          </DropdownMenuItem>
          {canDeleteApps && (
            <DropdownMenuItem
              variant="danger"
              onSelect={() => {
                const appName = appMenu?.appName;
                if (appName) onDeleteApp(appName);
              }}
            >
              <TrashIcon size={16} />
              Delete
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
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
