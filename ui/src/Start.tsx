import { AlignLeft, ArrowLeftRight, Gauge, Globe, MessageCircleQuestion, ShieldCheck, Table2, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { App, Script } from "./apps";
import { appFor } from "./appImports";
import { AppTypeIcon } from "./AppTypeIcon";
import { appType } from "./appTypes";
import { cn } from "./cn";
import { Spinner } from "./components/spinner";
import { FileName } from "./FileName";
import { FirstAppBlankslate } from "./FirstAppBlankslate";
import { BlankslateActions, NoFileBlankslate } from "./NoFileBlankslate";
import { readScriptFile } from "./scriptFiles";
import { ScriptKind, ScriptShape, scriptShape, topScripts } from "./scriptShape";
import { lastRunTimes } from "./runStore";

interface StartProps {
  // Which screen is right is a question about the workspace, so neither is drawn
  // until the workspace has answered it.
  workspaceLoaded: boolean;
  apps: App[];
  scripts: Script[] | undefined;
  runningFiles: Set<string>;
  // A file auto-saves under Start without the listing moving, so it is read again
  // each time Start comes back on screen.
  active: boolean;
  onNewAppClick: () => void;
  // Absent where this build has no MCP server to point an agent at.
  onConnectAgentClick?: () => void;
  canUpdateWorkspace: boolean;
  onOpenFinder: () => void;
  onNewDraft: () => void;
  onOpenScript: (script: Script) => void;
  phone?: boolean;
}

const KINDS: { [kind in ScriptKind]: { icon: LucideIcon; label: string } } = {
  perfTest: { icon: Gauge, label: "Load test" },
  approve: { icon: ShieldCheck, label: "Asks before it writes" },
  table: { icon: Table2, label: "Table" },
  ask: { icon: MessageCircleQuestion, label: "Asks a question" },
  text: { icon: AlignLeft, label: "Text" },
  calls: { icon: ArrowLeftRight, label: "Calls" },
};

/**
 * Where the window opens, and the one view there is always a way back to.
 *
 * It is two screens, and which one is right is a question about the workspace rather
 * than about the window: with no apps it is the cold start, which names the two doors
 * into Kaja and draws the map between them; with apps it is the sentence that says
 * picking a call in the tree writes you a script, over the workspace's scripts, the
 * ones run last first.
 */
export function Start({
  workspaceLoaded,
  apps,
  scripts,
  runningFiles,
  active,
  onNewAppClick,
  onConnectAgentClick,
  canUpdateWorkspace,
  onOpenFinder,
  onNewDraft,
  onOpenScript,
  phone = false,
}: StartProps) {
  const top = useMemo(() => (active ? topScripts(scripts ?? [], lastRunTimes(), phone ? 6 : 9) : []), [active, scripts, phone]);
  const shapes = useScriptShapes(top);

  if (!workspaceLoaded) return <div className="flex-1" />;

  if (apps.length === 0) {
    return <FirstAppBlankslate onNewAppClick={onNewAppClick} onConnectAgentClick={onConnectAgentClick} canUpdateWorkspace={canUpdateWorkspace} />;
  }

  if (!scripts || scripts.length === 0) {
    return <NoFileBlankslate onOpenFinder={onOpenFinder} onNewDraft={onNewDraft} phone={phone} />;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-background">
      <div className={cn("flex flex-col gap-6 py-[18px]", phone ? "px-4" : "px-5")}>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <p className="m-0 text-xs text-muted-foreground">Pick a method in the sidebar and Kaja drafts a script.</p>
          <BlankslateActions onOpenFinder={onOpenFinder} onNewDraft={onNewDraft} phone={phone} />
        </div>
        <section aria-label="Scripts" className="flex flex-col gap-2">
          <h2 className="m-0 text-xs font-semibold text-foreground">Scripts</h2>
          <div className={cn("grid gap-3", phone ? "grid-cols-1" : "grid-cols-[repeat(auto-fill,minmax(220px,1fr))]")}>
            {top.map((script) => (
              <ScriptCard
                key={script.path}
                script={script}
                shape={shapes.get(script.path)}
                apps={apps}
                running={runningFiles.has(script.path)}
                onOpen={() => onOpenScript(script)}
              />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function useScriptShapes(scripts: Script[]): Map<string, ScriptShape> {
  const [shapes, setShapes] = useState<Map<string, ScriptShape>>(new Map());
  const key = scripts.map((script) => script.path).join("\n");
  useEffect(() => {
    if (scripts.length === 0) return;
    let current = true;
    void Promise.all(
      scripts.map(async (script) => {
        const file = await readScriptFile(script).catch(() => undefined);
        const shape = file && scriptShape(file.content);
        return shape ? ([script.path, shape] as const) : undefined;
      }),
    ).then((read) => {
      if (current) setShapes(new Map(read.filter((entry) => entry !== undefined)));
    });
    return () => {
      current = false;
    };
    // The listing is a new array on every change, so it is keyed by what it names.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return shapes;
}

function ScriptCard({ script, shape, apps, running, onOpen }: { script: Script; shape?: ScriptShape; apps: App[]; running: boolean; onOpen: () => void }) {
  const kind = shape ? KINDS[shape.kind] : undefined;
  const Icon = kind?.icon;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex min-h-[96px] w-full flex-col gap-1 rounded-lg border border-border bg-card p-3 text-left outline-none hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="flex items-center gap-2">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          {Icon && <Icon size={14} aria-hidden />}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
          <FileName name={script.name} />
        </span>
        {running && <Spinner size="sm" className="shrink-0 text-muted-foreground" />}
      </span>
      <span className="truncate text-xs text-muted-foreground">{[kind?.label, script.folder].filter(Boolean).join(" · ")}</span>
      <span className="mt-auto flex flex-wrap items-center gap-1 pt-2">
        {shape?.imports.map(({ specifier, names }) => (
          <ImportChips key={specifier} app={appFor(apps, specifier)} specifier={specifier} names={names} />
        ))}
        {shape?.fetches && (
          <span className="flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
            <Globe size={11} aria-hidden />
            fetch
          </span>
        )}
      </span>
    </button>
  );
}

function ImportChips({ app, specifier, names }: { app?: App; specifier: string; names: string[] }) {
  return (
    <>
      <span className="flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[11px] text-foreground">
        {app && <AppTypeIcon type={appType(app.configuration)} size={11} />}
        {app?.configuration.name ?? specifier}
      </span>
      {names.map((name) => (
        <span key={name} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
          {name}
        </span>
      ))}
    </>
  );
}
