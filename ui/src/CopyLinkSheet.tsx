import { Check, Copy, Link2 } from "lucide-react";
import { Fragment, useCallback, useMemo, useRef, useState } from "react";

import { Script, scriptName } from "./apps";
import { cn } from "./cn";
import { Dialog } from "./components/dialog";
import { IconButton } from "./components/icon-button";
import { Input } from "./components/input";
import { linkName, scriptLinkParts } from "./scriptLink";

export interface CopyLinkSheetProps {
  script: Script;
  // The parameters the script reads, in the order it reads them. Read from its
  // own source, so the fields are the script's actual inputs.
  parameters: string[];
  onClose: () => void;
}

/**
 * A script's address outside Kaja, shown before it is copied.
 *
 * Nobody has seen a `kaja://` URL before, and the half of it worth having is
 * the query — so a silent copy hands over a string that says nothing and
 * carries no parameters. The URL is the headline here rather than a caption:
 * shown whole, at body size, it teaches the scheme, the script's address and
 * the query syntax at once, and no copy on screen has to explain any of it.
 *
 * The clipboard is the only exit. Running is two feet away in the command row,
 * with a console attached to catch the output.
 */
export function CopyLinkSheet({ script, parameters, onClose }: CopyLinkSheetProps) {
  const [values, setValues] = useState<{ [key: string]: string }>({});
  const [copied, setCopied] = useState(false);
  const firstFieldRef = useRef<HTMLInputElement>(null);

  const name = scriptName(script);
  // Every parameter rides along, blank or not: the trailing `=` is where a
  // launcher's own token goes, so it has to be in what gets copied.
  const parts = useMemo(() => scriptLinkParts(name, Object.fromEntries(parameters.map((key) => [key, values[key] ?? ""]))), [name, parameters, values]);
  const link = parts.map((part) => part.text).join("");
  // An illustration rather than the link again: the URL is already on screen
  // whole, and this line is about the shell, not about this script's values.
  const address = parts
    .filter((part) => part.kind === "scheme" || part.kind === "script")
    .map((part) => part.text)
    .join("");
  const firstKey = parts.find((part) => part.kind === "key");
  const shellExample = firstKey ? `${address}${firstKey.text}…` : address;

  const copy = useCallback(() => {
    navigator.clipboard?.writeText(link).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      },
      () => {},
    );
  }, [link]);

  const copyAndClose = useCallback(() => {
    navigator.clipboard?.writeText(link).catch(() => {});
    onClose();
  }, [link, onClose]);

  return (
    <Dialog
      title={
        <span className="flex items-center gap-2">
          <Link2 size={15} className="shrink-0 text-muted-foreground" />
          <span>
            Copy link to <span className="font-mono">{linkName(script.name)}</span>
          </span>
        </span>
      }
      onClose={onClose}
      initialFocusRef={parameters.length > 0 ? firstFieldRef : undefined}
      footerButtons={[
        { content: "Cancel", variant: "ghost", onClick: onClose },
        { content: "Copy link", variant: "default", onClick: copyAndClose },
      ]}
    >
      <div className={cn("flex flex-col py-3", parameters.length > 0 ? "gap-4" : "gap-3")}>
        <div className="relative rounded-md border border-border bg-muted/40 p-3 pr-10">
          <p className="m-0 break-all font-mono text-sm leading-[1.55] text-foreground">
            {parts.map((part, index) => (
              <span key={index} className={part.kind === "scheme" || part.kind === "key" ? "text-muted-foreground" : undefined}>
                {part.text}
              </span>
            ))}
          </p>
          <div className="absolute right-1.5 top-1.5">
            <IconButton icon={copied ? Check : Copy} aria-label={copied ? "Copied" : "Copy link"} variant="ghost" size="sm" onClick={copy} />
          </div>
        </div>

        {parameters.length > 0 && (
          <div className="flex flex-col gap-3">
            <div className="flex items-baseline gap-2">
              <span className="text-xs font-medium text-muted-foreground">Parameters</span>
              <span className="text-xs text-muted-foreground opacity-75">read from the script</span>
            </div>
            {/* The keys come from the source, so they are labels rather than
                fields: an empty key/value grid would ask for the thing this
                sheet exists to tell you. */}
            <div className="grid grid-cols-4 items-center gap-3">
              {parameters.map((key, index) => (
                <Fragment key={key}>
                  <label className="col-span-1 truncate font-mono text-sm text-foreground" htmlFor={`link-parameter-${index}`} title={key}>
                    {key}
                  </label>
                  <div className="col-span-3">
                    <Input
                      id={`link-parameter-${index}`}
                      ref={index === 0 ? firstFieldRef : undefined}
                      value={values[key] ?? ""}
                      placeholder="leave blank to fill in later"
                      onChange={(event) => setValues((prev) => ({ ...prev, [key]: event.target.value }))}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          copyAndClose();
                        }
                      }}
                    />
                  </div>
                </Fragment>
              ))}
            </div>
            <p className="m-0 text-xs leading-[1.55] text-muted-foreground">
              A value typed here is baked into the link. Left blank, the key still ships — point a launcher's token at it, like Raycast&rsquo;s{" "}
              <span className="font-mono">{"{clipboard}"}</span>.
            </p>
          </div>
        )}

        {parameters.length > 0 ? (
          <div className="rounded-md border border-border px-3 py-2">
            <p className="m-0 text-xs leading-[1.6] text-muted-foreground">
              Anything on this Mac that opens a URL can run this script: a Raycast quicklink, an Alfred workflow, a Shortcut, or{" "}
              <span className="font-mono text-foreground">open &ldquo;{shellExample}&rdquo;</span> in a shell.
            </p>
          </div>
        ) : (
          // A script that takes nothing still gets the sheet: the URL is the
          // whole point of it, and this is the shortest version of the lesson.
          <p className="m-0 text-xs leading-[1.6] text-muted-foreground">
            This script takes no parameters. Anything that opens a URL can run it — a Raycast quicklink, an Alfred workflow, a Shortcut, or{" "}
            <span className="font-mono text-foreground">open</span> in a shell.
          </p>
        )}
      </div>
    </Dialog>
  );
}
