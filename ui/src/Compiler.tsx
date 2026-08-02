import { Check, ChevronRight, X } from "lucide-react";
import { cn } from "./cn";
import { ActionList } from "./components/action-list";
import { Spinner } from "./components/spinner";
import { FirstAppBlankslate } from "./FirstAppBlankslate";
import { useEffect, useRef, useState } from "react";
import { CompilationStatus, App } from "./apps";
import { appType, appTypeLabel } from "./appTypes";

interface CompilerProps {
  apps: App[];
  configurationLoaded: boolean;
  onNewAppClick?: () => void;
  // The app the log was opened for; its logs are expanded and scrolled to.
  expandApp?: { name: string };
}

const CHEVRON_SIZE = 16;
const CHECK_ICON_SIZE = 12;

export function Compiler({ apps, configurationLoaded, onNewAppClick, expandApp }: CompilerProps) {
  const [expandedApps, setExpandedApps] = useState<Set<string>>(new Set());
  const itemRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  useEffect(() => {
    if (!expandApp) return;
    setExpandedApps((prev) => new Set(prev).add(expandApp.name));
    itemRefs.current.get(expandApp.name)?.scrollIntoView({ block: "nearest" });
  }, [expandApp]);

  const toggleExpand = (appName: string) => {
    setExpandedApps((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(appName)) {
        newSet.delete(appName);
      } else {
        newSet.add(appName);
      }
      return newSet;
    });
  };

  const getStatusVariant = (status: CompilationStatus) => {
    return status === "error" ? "danger" : undefined;
  };

  const renderSpinner = () => (
    <div className="flex size-5 items-center justify-center">
      <Spinner size="sm" />
    </div>
  );

  const getStatusIcon = (status: CompilationStatus) => {
    if (status === "running") return renderSpinner();
    if (status === "pending") return null;

    const isSuccess = status === "success";
    const Icon = isSuccess ? Check : X;

    return (
      <div
        className={cn(
          "flex size-5 items-center justify-center rounded-full",
          isSuccess ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-destructive/10 text-destructive",
        )}
      >
        <Icon size={CHECK_ICON_SIZE} />
      </div>
    );
  };

  if (apps.length === 0) {
    if (!configurationLoaded) {
      return (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center bg-muted text-muted-foreground">
          <div>
            <Spinner />
            <div className="mt-3">Loading configuration...</div>
          </div>
        </div>
      );
    }

    return <FirstAppBlankslate onNewAppClick={onNewAppClick} />;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-muted">
      <div className="min-h-0 flex-1 overflow-y-auto">
        {apps.map((app, index) => {
          const isExpanded = expandedApps.has(app.configuration.name);
          return (
            <div
              key={`app-${index}-${app.configuration.name}`}
              data-testid="compiler-item"
              className="relative"
              ref={(el) => {
                if (el) itemRefs.current.set(app.configuration.name, el);
                else itemRefs.current.delete(app.configuration.name);
              }}
            >
              <div className={cn(isExpanded && "sticky top-0 z-10 bg-background")}>
                <ActionList>
                  <ActionList.Item
                    variant={getStatusVariant(app.compilation.status)}
                    onSelect={() => toggleExpand(app.configuration.name)}
                    className={cn(isExpanded && "bg-accent")}
                  >
                    <ActionList.LeadingVisual>
                      <div className="flex items-center gap-1">
                        <ChevronRight
                          size={CHEVRON_SIZE}
                          className={cn("text-muted-foreground transition-transform duration-200", isExpanded && "rotate-90")}
                        />
                        {getStatusIcon(app.compilation.status)}
                      </div>
                    </ActionList.LeadingVisual>
                    {app.configuration.name}
                    <ActionList.Description>
                      {appTypeLabel(appType(app.configuration))}
                      {app.target ? ` • ${app.target}` : ""}
                    </ActionList.Description>
                    {app.compilation.duration && (
                      <ActionList.TrailingVisual>
                        <span className="text-xs text-muted-foreground">{app.compilation.duration}</span>
                      </ActionList.TrailingVisual>
                    )}
                  </ActionList.Item>
                </ActionList>
              </div>
              {isExpanded && (
                <div data-testid="compiler-logs" className="bg-muted">
                  <div className="px-4 py-3 font-mono text-xs">
                    {app.compilation.logs.map((log, logIndex) => (
                      <div key={logIndex} className="mb-px flex leading-5">
                        <span className="mr-4 min-w-10 select-none text-right text-muted-foreground">{logIndex + 1}</span>
                        <span className={cn("whitespace-pre-wrap", logClass(log.level))}>{log.message}</span>
                      </div>
                    ))}
                    {app.compilation.status === "running" && (
                      <div className="mt-2 flex items-center gap-2 text-muted-foreground">
                        {renderSpinner()}
                        Compiling...
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function logClass(level: number): string {
  switch (level) {
    case 0: // DEBUG
      return "text-muted-foreground";
    case 2: // WARN
      return "text-amber-600 dark:text-amber-400";
    case 3: // ERROR
      return "text-destructive";
    default: // INFO
      return "text-foreground";
  }
}
