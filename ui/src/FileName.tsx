import { cn } from "./cn";
import { scriptNameParts } from "./scriptTree";

/**
 * A filename, wherever one is named: the name at full weight and the extension
 * quiet behind it.
 *
 * The sidebar's dimmed extension was the right treatment and the only place it
 * was applied — so the same name read one way in the list and another in the
 * tab above it. It is one object, so it gets one treatment: the sidebar row,
 * the finder's trigger and rows, and every sheet title.
 *
 * The extension stays present and stays quiet. It says which language the file
 * is in without competing with the name that is actually scanned for — and
 * dropping it would give up the last cue that these are things on disk.
 *
 * It is a fragment rather than an element, so the caller owns the truncation,
 * the font and the weight: the same name is 13px in a row and mono in a title.
 */
export function FileName({ name, className }: { name: string; className?: string }) {
  const { base, extension } = scriptNameParts(name);
  return (
    <>
      {base}
      {extension && <span className={cn("text-muted-foreground", className)}>{extension}</span>}
    </>
  );
}
