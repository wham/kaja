import { Ban, Braces, ChevronRight, FileCode } from "lucide-react";
import { useState } from "react";
import { App, isReady, Method, Service, serviceId } from "./apps";
import { AppTypeIcon } from "./AppTypeIcon";
import { appParameters, appType, appTypeLabel } from "./appTypes";
import { cn } from "./cn";
import { countMethods, isCompiling } from "./compileSummary";
import { IconButton } from "./components/icon-button";
import { Spinner } from "./components/spinner";
import { endpointLabel } from "./knownServers";
import { methodTag } from "./phone";
import { Story, StoryCollection, storyServices } from "./stories";
import { unsupportedReason } from "./streaming";
import { MissingVariable, missingVariableSentence } from "./variableUsage";

interface AppPageProps {
  appName: string;
  // Undefined once the app has left the workspace, or before it has loaded.
  app?: App;
  collection?: StoryCollection;
  // The stories whose draft has a run in flight.
  running: Set<string>;
  missing?: MissingVariable[];
  phone: boolean;
  onRunStory: (story: Story) => void;
  onOpenStory: (story: Story) => void;
  onSelectMethod: (method: Method, service: Service, app: App) => void;
  onShowCompileLog: (appName: string) => void;
  onRevealVariable: (name: string) => void;
}

export function AppPage({
  appName,
  app,
  collection,
  running,
  missing,
  phone,
  onRunStory,
  onOpenStory,
  onSelectMethod,
  onShowCompileLog,
  onRevealVariable,
}: AppPageProps) {
  if (!app) {
    return <div className="flex flex-1 items-center justify-center px-6 text-sm text-muted-foreground">No app named {appName}.</div>;
  }
  const ready = isReady(app.compilation.status);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-background">
      <div className={cn("flex flex-col gap-5 py-[18px]", phone ? "px-4" : "px-5")}>
        <Header app={app} onShowCompileLog={onShowCompileLog} />

        {missing && missing.length > 0 && (
          <div className="flex flex-col gap-1">
            {missing.map((variable) => (
              <button
                key={variable.name}
                type="button"
                onClick={() => onRevealVariable(variable.name)}
                className="flex items-center gap-2 rounded-md bg-amber-500/10 px-2.5 py-1.5 text-left text-xs text-amber-700 hover:bg-amber-500/15 dark:text-amber-300"
              >
                <Braces size={13} className="shrink-0" />
                <span className="min-w-0 flex-1 truncate">{missingVariableSentence(variable)}</span>
              </button>
            ))}
          </div>
        )}

        {collection && (
          <section aria-label="Stories" className="flex flex-col gap-2">
            <div className="flex items-baseline gap-2">
              <h2 className="m-0 text-xs font-semibold text-foreground">Stories</h2>
              {!ready && <span className="text-xs text-muted-foreground">{isCompiling(app) ? "ready once the app compiles" : "the app didn't compile"}</span>}
            </div>
            <div
              className={cn(
                phone
                  ? "-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                  : "grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3",
              )}
            >
              {collection.stories.map((story) => (
                <StoryCard
                  key={story.name}
                  story={story}
                  services={storyServices(collection, story)}
                  disabled={!ready}
                  running={running.has(story.name)}
                  phone={phone}
                  onRun={() => onRunStory(story)}
                  onOpen={() => onOpenStory(story)}
                />
              ))}
            </div>
          </section>
        )}

        <section aria-label="Methods" className="flex flex-col gap-1">
          <h2 className="m-0 text-xs font-semibold text-foreground">Methods</h2>
          {isCompiling(app) ? (
            <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
              <Spinner size="sm" />
              Compiling…
            </div>
          ) : app.services.length === 0 ? (
            <div className="py-2 text-xs text-muted-foreground">Nothing to call yet</div>
          ) : (
            <MethodIndex app={app} phone={phone} onSelect={onSelectMethod} />
          )}
        </section>
      </div>
    </div>
  );
}

function Header({ app, onShowCompileLog }: { app: App; onShowCompileLog: (appName: string) => void }) {
  const type = appType(app.configuration);
  const parameters = appParameters(app.configuration);
  const address = parameters.baseUrl || parameters.url || parameters.endpoint || "";
  const methods = countMethods(app);
  return (
    <div className="flex min-w-0 items-center gap-3">
      <AppTypeIcon type={type} size={22} />
      <div className="flex min-w-0 flex-col">
        <h1 className="m-0 truncate text-lg font-semibold leading-tight text-foreground">{app.configuration.name}</h1>
        {app.compilation.status === "error" ? (
          <button type="button" onClick={() => onShowCompileLog(app.configuration.name)} className="self-start text-xs text-destructive hover:underline">
            Failed to compile
          </button>
        ) : (
          <span className="truncate text-xs text-muted-foreground">
            {[appTypeLabel(type), isCompiling(app) ? "compiling…" : `${methods} ${methods === 1 ? "method" : "methods"}`, address && endpointLabel(address)]
              .filter(Boolean)
              .join(" · ")}
          </span>
        )}
      </div>
    </div>
  );
}

function StoryCard({
  story,
  services,
  disabled,
  running,
  phone,
  onRun,
  onOpen,
}: {
  story: Story;
  services: string[];
  disabled: boolean;
  running: boolean;
  phone: boolean;
  onRun: () => void;
  onOpen: () => void;
}) {
  return (
    <div className={cn("relative flex", phone && "w-[80%] shrink-0 snap-start")}>
      <button
        type="button"
        onClick={onRun}
        disabled={disabled}
        aria-label={`Run ${story.title}`}
        className="flex min-h-[112px] w-full flex-col gap-1 rounded-lg border border-border bg-card p-3 text-left outline-none hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
      >
        <span className="flex items-center gap-2 pr-7">
          <span className="truncate text-sm font-medium text-foreground">{story.title}</span>
          {running && <Spinner size="sm" className="shrink-0 text-muted-foreground" />}
        </span>
        <span className="line-clamp-2 text-xs text-muted-foreground">{story.summary}</span>
        <span className="mt-auto flex flex-wrap gap-1 pt-2">
          {services.map((service) => (
            <span key={service} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
              {service}
            </span>
          ))}
        </span>
      </button>
      <IconButton
        icon={FileCode}
        aria-label={`Open ${story.title} without running it`}
        variant="ghost"
        size="sm"
        className="absolute right-1.5 top-1.5"
        onClick={onOpen}
      />
    </div>
  );
}

function MethodIndex({ app, phone, onSelect }: { app: App; phone: boolean; onSelect: (method: Method, service: Service, app: App) => void }) {
  const [open, setOpen] = useState<Set<string>>(() => new Set(app.services.length === 1 ? [serviceId(app.services[0])] : []));
  const type = appType(app.configuration);
  const toggle = (id: string) =>
    setOpen((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="flex flex-col">
      {app.services.map((service) => {
        const id = serviceId(service);
        const expanded = open.has(id);
        return (
          <div key={id}>
            <button
              type="button"
              aria-expanded={expanded}
              onClick={() => toggle(id)}
              className={cn("flex w-full items-center gap-1.5 rounded-md px-1.5 text-left hover:bg-accent/40", phone ? "h-11" : "h-7")}
            >
              <ChevronRight size={13} className={cn("shrink-0 text-muted-foreground transition-transform duration-[120ms]", expanded && "rotate-90")} />
              <span className="min-w-0 flex-1 truncate text-sm text-foreground">{service.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{service.methods.length}</span>
            </button>
            {expanded &&
              service.methods.map((method) => {
                const unsupported = unsupportedReason(method, type) !== undefined;
                const tag = methodTag(method);
                const summary = method.doc?.split("\n")[0]?.trim();
                return (
                  <button
                    key={method.name}
                    type="button"
                    onClick={() => onSelect(method, service, app)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md pl-[26px] pr-1.5 text-left hover:bg-accent/40",
                      phone ? "min-h-11 py-1" : "min-h-7 py-0.5",
                    )}
                  >
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span
                        className={cn(
                          "truncate text-sm",
                          unsupported || method.deprecated ? "text-muted-foreground" : "text-foreground",
                          method.deprecated && "line-through",
                        )}
                      >
                        {method.name}
                      </span>
                      {summary && summary !== method.name && <span className="truncate text-xs text-muted-foreground">{summary}</span>}
                    </span>
                    {tag === "write" && <span className="shrink-0 font-mono text-xs text-amber-600 dark:text-amber-400">write</span>}
                    {tag === "stream" && <span className="shrink-0 font-mono text-xs text-muted-foreground">stream</span>}
                    {unsupported && <Ban size={14} className="shrink-0 text-muted-foreground" />}
                  </button>
                );
              })}
          </div>
        );
      })}
    </div>
  );
}
