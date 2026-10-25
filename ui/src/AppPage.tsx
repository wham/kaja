import { Braces, FileCode } from "lucide-react";
import { App, isReady } from "./apps";
import { AppTypeIcon } from "./AppTypeIcon";
import { appParameters, appType, appTypeLabel } from "./appTypes";
import { cn } from "./cn";
import { countMethods, isCompiling } from "./compileSummary";
import { IconButton } from "./components/icon-button";
import { Spinner } from "./components/spinner";
import { endpointLabel } from "./knownServers";
import { Story, StoryCollection, storyServices } from "./stories";
import { MissingVariable, missingVariableSentence } from "./variableUsage";

interface AppPageProps {
  appName: string;
  // Undefined once the app has left the workspace, or before it has loaded.
  app?: App;
  collection: StoryCollection;
  // The stories whose draft has a run in flight.
  running: Set<string>;
  missing?: MissingVariable[];
  phone: boolean;
  onRunStory: (story: Story) => void;
  onOpenStory: (story: Story) => void;
  onShowCompileLog: (appName: string) => void;
  onRevealVariable: (name: string) => void;
}

export function AppPage({ appName, app, collection, running, missing, phone, onRunStory, onOpenStory, onShowCompileLog, onRevealVariable }: AppPageProps) {
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
