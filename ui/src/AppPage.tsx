import { Braces } from "lucide-react";
import { App, isReady } from "./apps";
import { AppTypeIcon } from "./AppTypeIcon";
import { appParameters, appType, appTypeLabel } from "./appTypes";
import { cn } from "./cn";
import { countMethods, isCompiling } from "./compileSummary";
import { endpointLabel } from "./knownServers";
import { Story, StoryCollection } from "./stories";
import { StoryGrid } from "./StoryCards";
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
  onOpenStory: (story: Story) => void;
  onShowCompileLog: (appName: string) => void;
  onRevealVariable: (name: string) => void;
}

export function AppPage({ appName, app, collection, running, missing, phone, onOpenStory, onShowCompileLog, onRevealVariable }: AppPageProps) {
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
          <StoryGrid collection={collection} running={running} phone={phone} onOpenStory={onOpenStory} />
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
