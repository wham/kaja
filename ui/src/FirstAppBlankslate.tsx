import { Plug, Plus } from "lucide-react";

import { Button } from "./components/button";
import { AGENT_END, APPS_END, KajaMap } from "./KajaMap";

interface FirstAppBlankslateProps {
  onNewAppClick?: () => void;
  // Absent where this build has no MCP server to point an agent at.
  onConnectAgentClick?: () => void;
  canUpdateConfiguration?: boolean;
}

/**
 * The screen a cold start opens on: no apps, so nothing to call and nothing to write a
 * script against.
 *
 * It names the two doors into Kaja and draws the map between them, with an action under
 * each end the map already has — the agent on the left, the protocols on the right. Two
 * full stops rather than an "or": an agent is additive, and it cannot add an app for
 * you, which is why adding one is the filled button and the heading says it first. The
 * third line is plain text: it says an agent is optional, and there is nowhere useful to
 * send you.
 *
 * A read-only configuration keeps the map and the agent, and says where apps come from
 * instead of offering a button for one.
 */
export function FirstAppBlankslate({ onNewAppClick, onConnectAgentClick, canUpdateConfiguration = true }: FirstAppBlankslateProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-[26px] overflow-hidden p-6">
      <div className="flex max-w-[600px] flex-col items-center gap-[7px]">
        <h2 className="m-0 text-[15px] font-semibold tracking-[-0.01em] text-foreground">
          {canUpdateConfiguration ? "Add an app. Connect an agent." : "Connect an agent."}
        </h2>
        <p className="m-0 text-center text-xs leading-[1.6] text-pretty text-muted-foreground">
          {canUpdateConfiguration ? (
            "You can also use Kaja to explore the APIs without an agent."
          ) : (
            <>
              This configuration is read-only, and it names no apps. They come from <code className="font-mono">kaja.json</code> in the workspace Kaja was
              started on.
            </>
          )}
        </p>
      </div>

      <div className="flex w-full max-w-[860px] min-h-0 flex-col gap-3.5">
        <KajaMap className="max-h-full w-full" />
        {/* Each action is pinned to the end of the map it belongs to rather than laid
            out in a row, so the button lands where the eye already is. */}
        <div className="relative h-8 shrink-0">
          {onConnectAgentClick && (
            <div className="absolute -translate-x-1/2" style={{ left: AGENT_END }}>
              <Button variant="outline" onClick={onConnectAgentClick}>
                <Plug size={14} />
                Connect an agent
              </Button>
            </div>
          )}
          {canUpdateConfiguration && (
            <div className="absolute -translate-x-1/2" style={{ left: APPS_END }}>
              <Button onClick={onNewAppClick}>
                <Plus size={14} />
                New app
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
