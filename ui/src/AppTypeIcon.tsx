import { getAppType } from "./appTypes";
import { cn } from "./cn";
import { SimpleTooltip } from "./components/tooltip";

// An app's type is its icon, the same one its New entry and its settings tab
// carry. The word is a hover away for whoever needs it.
//
// It lives here rather than in `appTypes.ts` because that module is the type
// registry and is imported by logic that never renders — `views.ts` among it —
// and rather than in `components/` because it is not a design-system primitive.
export function AppTypeIcon({ type, size = 16, className }: { type: string; size?: number; className?: string }) {
  const definition = getAppType(type);
  if (!definition) return null;
  const Icon = definition.icon;
  return (
    <SimpleTooltip text={definition.label}>
      <span role="img" aria-label={definition.label} className={cn("inline-flex shrink-0 items-center text-muted-foreground", className)}>
        <Icon size={size} />
      </span>
    </SimpleTooltip>
  );
}
