import { Button } from "./components/button";
import { Spinner } from "./components/spinner";

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
