import { FirstAppBlankslate } from "./FirstAppBlankslate";
import { NoFileBlankslate, RecentFile } from "./NoFileBlankslate";

interface StartProps {
  // Which screen is right is a question about the workspace, so neither is drawn
  // until the configuration has answered it.
  configurationLoaded: boolean;
  hasApps: boolean;
  onNewAppClick: () => void;
  // Absent where this build has no MCP server to point an agent at.
  onConnectAgentClick?: () => void;
  canUpdateConfiguration: boolean;
  onOpenFinder: () => void;
  onNewDraft: () => void;
  recent: RecentFile[];
}

/**
 * Where the window opens, and the one view there is always a way back to.
 *
 * It is two screens, and which one is right is a question about the workspace rather
 * than about the window: with no apps it is the cold start, which names the two doors
 * into Kaja and draws the map between them; with apps it is the sentence that says
 * picking a call in the tree writes you a script, over the last few things you were in.
 */
export function Start({
  configurationLoaded,
  hasApps,
  onNewAppClick,
  onConnectAgentClick,
  canUpdateConfiguration,
  onOpenFinder,
  onNewDraft,
  recent,
}: StartProps) {
  if (!configurationLoaded) return <div className="flex-1" />;

  if (!hasApps) {
    return <FirstAppBlankslate onNewAppClick={onNewAppClick} onConnectAgentClick={onConnectAgentClick} canUpdateConfiguration={canUpdateConfiguration} />;
  }

  return <NoFileBlankslate onOpenFinder={onOpenFinder} onNewDraft={onNewDraft} recent={recent} />;
}
