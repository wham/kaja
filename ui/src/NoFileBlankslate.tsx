import { FileCode } from "lucide-react";
import { useShortcutLabel } from "./shortcuts";

interface NoFileBlankslateProps {
  onOpenFinder: () => void;
  onNewDraft: () => void;
  // On a phone the tree is in the finder and there is no key to press.
  phone?: boolean;
}

/**
 * The first screen of a new install, and where every "nothing open" moment
 * lands. It has one job: say that picking a method in the tree drafts you a
 * script, which is the entire model of the product and is said nowhere else.
 */
export function NoFileBlankslate({ onOpenFinder, onNewDraft, phone = false }: NoFileBlankslateProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-5 px-6">
      <div className="flex flex-col items-center gap-2">
        <FileCode size={28} className="text-muted-foreground" />
        <p className="m-0 text-sm text-foreground">Pick a method in the sidebar and Kaja drafts a script.</p>
        <p className="m-0 text-xs text-muted-foreground">Edit it, run it, save it as a file.</p>
      </div>
      <BlankslateActions onOpenFinder={onOpenFinder} onNewDraft={onNewDraft} phone={phone} />
    </div>
  );
}

export function BlankslateActions({ onOpenFinder, onNewDraft, phone = false }: NoFileBlankslateProps) {
  const finderKey = useShortcutLabel("finder");
  const newDraftKey = useShortcutLabel("newDraft");
  return (
    <div className="flex items-center gap-3">
      <button type="button" onClick={onOpenFinder} className="text-xs text-muted-foreground hover:text-foreground">
        {!phone && <span className="font-mono">{finderKey}</span>} find a call
      </button>
      <div className="h-3 w-px bg-border" />
      <button type="button" onClick={onNewDraft} className="text-xs text-muted-foreground hover:text-foreground">
        {!phone && <span className="font-mono">{newDraftKey}</span>} blank script
      </button>
    </div>
  );
}
