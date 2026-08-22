import { CircleAlert } from "lucide-react";
import { Dialog } from "./components/dialog";
import { formatBytes } from "./callFormat";
import { main } from "./wailsjs/go/models";

/**
 * What an export wrote, said once, at the only moment anybody is looking.
 *
 * Three things are worth saying and nothing else is. **Where it went**, because
 * a save dialog's folder is forgotten by the time it closes. **What it will and
 * will not run on**, because the runner inside it was built for the platform
 * this Kaja was built for, and a file that will not open on a colleague's
 * machine should say so here rather than there. And **what did not travel** —
 * a variable with nowhere to read a value from, an app that still opens over
 * the network — which is the export's one chance to be acted on, since the
 * machine it runs on is not this one.
 */
export function ExportedAppDialog({ app, onReveal, onClose }: { app: main.ExportedApp; onReveal: () => void; onClose: () => void }) {
  return (
    <Dialog
      title="Exported"
      width="md"
      onClose={onClose}
      footerButtons={[
        { content: "Done", onClick: onClose, variant: "default" },
        { content: "Reveal in Finder", onClick: onReveal, variant: "secondary" },
      ]}
    >
      <div className="flex flex-col gap-3 text-sm">
        <div>
          <div className="font-medium">{app.name}</div>
          <div className="text-muted-foreground">
            {formatBytes(app.size)} · runs on {app.platform}
          </div>
        </div>

        <p className="text-muted-foreground">
          One file, with the script, its apps and the screen it draws on inside it. Double-click it — it opens in a browser and needs no Kaja.
        </p>

        {app.warnings?.length > 0 && (
          <ul className="flex flex-col gap-2 rounded-md bg-amber-500/10 p-3 text-amber-600 dark:text-amber-400">
            {app.warnings.map((warning) => (
              <li key={warning} className="flex gap-2">
                <CircleAlert size={14} className="mt-0.5 shrink-0" />
                <span>{warning}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Dialog>
  );
}
