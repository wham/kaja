import { type ReactNode } from "react";

/**
 * What a screen says when the workspace it edits cannot be written.
 *
 * One statement in one place: every screen that drops its verbs leads with the same
 * sentence and adds the one thing that is its own — where an app comes from, where a
 * value comes from, where the switch is set.
 */
export function ReadOnlyBanner({ children }: { children?: ReactNode }) {
  return (
    <div className="shrink-0 bg-amber-500/10 px-4 py-2 text-sm text-amber-600 dark:text-amber-400">
      This configuration is read-only.{children ? <> {children}</> : null}
    </div>
  );
}
