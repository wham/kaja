import { Sparkles } from "lucide-react";
import { Button } from "./components/button";
import { Spinner } from "./components/spinner";

// DemoLink trails the idle caption of a form that can fill itself in from a demo.
export function DemoLink({ label, onDemo }: { label: string; onDemo: () => void }) {
  return (
    <>
      {" "}
      {/* The separator rides with the link, so a wrap never leaves it dangling. */}
      <span className="whitespace-nowrap">
        ·{" "}
        <button type="button" onClick={onDemo} className="inline-flex items-center gap-1 align-middle hover:text-foreground">
          <Sparkles size={11} />
          {label}
        </button>
      </span>
    </>
  );
}

// ReadingRow stands where a form's reading will land while it is on the wire.
export function ReadingRow({ label, onCancel }: { label: string; onCancel: () => void }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2">
      <Spinner size="sm" />
      <span className="text-sm text-muted-foreground">{label}</span>
      <Button variant="ghost" size="sm" className="ml-auto" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  );
}
