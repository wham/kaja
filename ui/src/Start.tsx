import { App } from "./apps";
import { AppTypeIcon } from "./AppTypeIcon";
import { appType } from "./appTypes";
import { cn } from "./cn";
import { Draft } from "./drafts";
import { FirstAppBlankslate } from "./FirstAppBlankslate";
import { BlankslateActions, NoFileBlankslate } from "./NoFileBlankslate";
import { collectionFor, Story, StoryCollection } from "./stories";
import { runningStories, StoryGrid } from "./StoryCards";

interface StartProps {
  // Which screen is right is a question about the workspace, so neither is drawn
  // until the workspace has answered it.
  workspaceLoaded: boolean;
  apps: App[];
  drafts: Draft[];
  runningFiles: Set<string>;
  onNewAppClick: () => void;
  // Absent where this build has no MCP server to point an agent at.
  onConnectAgentClick?: () => void;
  canUpdateWorkspace: boolean;
  onOpenFinder: () => void;
  onNewDraft: () => void;
  onOpenStory: (appName: string, collection: StoryCollection, story: Story) => void;
  phone?: boolean;
}

/**
 * Where the window opens, and the one view there is always a way back to.
 *
 * It is two screens, and which one is right is a question about the workspace rather
 * than about the window: with no apps it is the cold start, which names the two doors
 * into Kaja and draws the map between them; with apps it is the sentence that says
 * picking a call in the tree writes you a script, over the stories of every app that
 * has some.
 */
export function Start({
  workspaceLoaded,
  apps,
  drafts,
  runningFiles,
  onNewAppClick,
  onConnectAgentClick,
  canUpdateWorkspace,
  onOpenFinder,
  onNewDraft,
  onOpenStory,
  phone = false,
}: StartProps) {
  if (!workspaceLoaded) return <div className="flex-1" />;

  if (apps.length === 0) {
    return <FirstAppBlankslate onNewAppClick={onNewAppClick} onConnectAgentClick={onConnectAgentClick} canUpdateWorkspace={canUpdateWorkspace} />;
  }

  const storied = apps.flatMap((app) => {
    const collection = collectionFor(app.configuration);
    return collection ? [{ app, collection }] : [];
  });
  if (storied.length === 0) {
    return <NoFileBlankslate onOpenFinder={onOpenFinder} onNewDraft={onNewDraft} phone={phone} />;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-background">
      <div className={cn("flex flex-col gap-6 py-[18px]", phone ? "px-4" : "px-5")}>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <p className="m-0 text-xs text-muted-foreground">Pick a method in the {phone ? "finder" : "sidebar"} and Kaja drafts a script.</p>
          <BlankslateActions onOpenFinder={onOpenFinder} onNewDraft={onNewDraft} phone={phone} />
        </div>
        {storied.map(({ app, collection }) => {
          const name = app.configuration.name;
          return (
            <section key={name} aria-label={`${name} stories`} className="flex flex-col gap-2">
              <h2 className="m-0 flex items-center gap-2 text-xs font-semibold text-foreground">
                <AppTypeIcon type={appType(app.configuration)} size={13} />
                <span className="truncate">{name}</span>
              </h2>
              <StoryGrid
                collection={collection}
                running={runningStories(collection, name, drafts, runningFiles)}
                phone={phone}
                onOpenStory={(story) => onOpenStory(name, collection, story)}
              />
            </section>
          );
        })}
      </div>
    </div>
  );
}
