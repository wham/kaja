import { Check, Copy, Link2, Play } from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { cn } from "./cn";
import { Dialog } from "./components/dialog";
import { IconButton } from "./components/icon-button";
import { Input } from "./components/input";
import { SimpleTooltip } from "./components/tooltip";
import { FileName } from "./FileName";
import { LINK_SCHEME, scriptLinkParts } from "./scriptLink";

/**
 * The three doors that need values for a script: `copy` builds a deeplink, `arrived`
 * confirms one that came in, `run` is the Run button asking first. One sheet because
 * they are one middle — the same `Parameters` grid, whose keys are read from the
 * script and whose values are always real fields.
 */
export type ParameterDoor = "copy" | "arrived" | "run";

export interface ParameterSheetProps {
  door: ParameterDoor;
  /** What the sheet is about, named the way every other surface names it. */
  fileName: string;
  /**
   * The script's name within the scripts folder — what the deeplink's path holds,
   * without the extension. Absent on the `run` door, which builds no link, and on a
   * draft, which has no address.
   */
  address?: string;
  /** The parameters, in the order the script reads them. */
  parameters: string[];
  /** What the fields start with. The deeplink's own values, on `arrived`. */
  values?: { [key: string]: string };
  /** What this file was last run with, offered rather than applied. */
  lastRun?: { [key: string]: string };
  /** Absent on `copy`, whose exit is the clipboard. */
  onRun?: (input: { [key: string]: string }) => void;
  onClose: () => void;
}

/**
 * A script's parameters, before it runs or before its address leaves.
 *
 * Values are fields in every door, never static text: a field clips at its own edge,
 * scrolls on focus, and stays correctable right up to the run. Rendering an incoming
 * value as mono text is what used to push a pasted URL through the side of the dialog.
 */
export function ParameterSheet({ door, fileName, address, parameters, values, lastRun, onRun, onClose }: ParameterSheetProps) {
  const [entered, setEntered] = useState<{ [key: string]: string }>(() => values ?? {});
  const [copied, setCopied] = useState(false);
  const firstFieldRef = useRef<HTMLInputElement>(null);

  // Every parameter rides along, blank or not: the trailing `=` is where a launcher's
  // own token goes, so it has to be in what gets copied.
  const input = useMemo(() => Object.fromEntries(parameters.map((key) => [key, entered[key] ?? ""])), [parameters, entered]);
  const parts = useMemo(() => (address === undefined ? [] : scriptLinkParts(address, input)), [address, input]);
  const link = parts.map((part) => part.text).join("");
  // The desktop's own scheme, versus this page's address with the script in its
  // fragment. The link is the same sentence either way; who can open one is not.
  const schemeLink = link.startsWith(`${LINK_SCHEME}:`);

  // An illustration rather than the link again: the URL is already on screen whole, and
  // this line is about the shell, not about this script's values.
  const shellExample = useMemo(() => {
    const bare = parts
      .filter((part) => part.kind === "base" || part.kind === "script")
      .map((part) => part.text)
      .join("");
    const firstKey = parts.find((part) => part.kind === "key");
    return firstKey ? `${bare}${firstKey.text}…` : bare;
  }, [parts]);

  const copy = useCallback(() => {
    navigator.clipboard?.writeText(link).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      },
      () => {},
    );
  }, [link]);

  const submit = useCallback(() => {
    if (door === "copy") {
      navigator.clipboard?.writeText(link).catch(() => {});
      onClose();
      return;
    }
    onClose();
    onRun?.(input);
  }, [door, link, input, onRun, onClose]);

  // ⏎ is the whole gesture: a deeplink that arrived from a hotkey is one press from a
  // run. A button's own Enter is its click, so it is left to it.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || event.defaultPrevented) return;
      if ((event.target as HTMLElement | null)?.closest("button")) return;
      event.preventDefault();
      submit();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [submit]);

  // Offered only where it says something the fields don't: values from a run this file
  // actually made, that aren't already what is typed.
  const offerLastRun =
    door === "run" && lastRun !== undefined && parameters.some((key) => (lastRun[key] ?? "") !== "" && (lastRun[key] ?? "") !== (entered[key] ?? ""));

  return (
    <Dialog
      title={<SheetTitle door={door} fileName={fileName} />}
      width="md"
      onClose={onClose}
      initialFocusRef={parameters.length > 0 ? firstFieldRef : undefined}
      footerButtons={[
        { content: "Cancel", variant: "ghost", onClick: onClose },
        { content: door === "copy" ? "Copy deeplink" : "Run", variant: "default", onClick: submit },
      ]}
    >
      <div className={cn("flex flex-col py-3", parameters.length > 0 ? "gap-4" : "gap-3")}>
        {door === "copy" && (
          // The URL is the headline rather than a caption: shown whole, at body size, it
          // teaches where Kaja is, the script's address and the query syntax at once.
          <div className="relative rounded-md border border-border bg-muted/40 p-3 pr-10">
            <p className="m-0 break-all font-mono text-sm leading-[1.55] text-foreground">
              {parts.map((part, index) => (
                <span key={index} className={part.kind === "base" || part.kind === "key" ? "text-muted-foreground" : undefined}>
                  {part.text}
                </span>
              ))}
            </p>
            <div className="absolute right-1.5 top-1.5">
              <IconButton icon={copied ? Check : Copy} aria-label={copied ? "Copied" : "Copy deeplink"} variant="ghost" size="sm" onClick={copy} />
            </div>
          </div>
        )}

        {door === "arrived" && (
          // What arrived, stated rather than offered: it wraps rather than clipping, so nothing
          // in it is unreadable — the fields below are where it is corrected.
          <div className="rounded-md border border-border bg-muted/40 p-3">
            <p className="m-0 break-all font-mono text-xs leading-[1.55] text-muted-foreground">{link}</p>
          </div>
        )}

        {parameters.length > 0 && (
          <div className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between gap-2">
              <div className="flex items-baseline gap-2">
                <span className="text-xs font-medium text-muted-foreground">Parameters</span>
                <span className="text-xs text-muted-foreground opacity-75">{door === "arrived" ? "from the deeplink" : "read from the script"}</span>
              </div>
              {offerLastRun && (
                <button
                  type="button"
                  className="shrink-0 text-xs text-muted-foreground underline hover:text-foreground"
                  onClick={() => setEntered((previous) => ({ ...previous, ...lastRun }))}
                >
                  Use last run&rsquo;s values
                </button>
              )}
            </div>
            <div className="grid grid-cols-4 items-center gap-3">
              {parameters.map((key, index) => (
                <Fragment key={key}>
                  <label className="col-span-1 truncate font-mono text-sm text-foreground" htmlFor={`parameter-${index}`} title={key}>
                    {key}
                  </label>
                  <div className="col-span-3">
                    <ParameterField
                      id={`parameter-${index}`}
                      ref={index === 0 ? firstFieldRef : undefined}
                      value={entered[key] ?? ""}
                      placeholder={door === "copy" ? "leave blank to fill in later" : door === "run" ? "leave blank" : undefined}
                      onChange={(value) => setEntered((previous) => ({ ...previous, [key]: value }))}
                    />
                  </div>
                </Fragment>
              ))}
            </div>
            <p className="m-0 text-xs leading-[1.55] text-muted-foreground">
              <Guidance door={door} parameters={parameters} />
            </p>
          </div>
        )}

        {/* The copy door says it in its own closing line, which also says what
            to do about it — two sentences about the same nothing is one too
            many. */}
        {parameters.length === 0 && door !== "copy" && (
          <p className="m-0 text-xs leading-[1.6] text-muted-foreground">
            {door === "arrived" ? "This deeplink carries no parameters." : "This script reads no parameters."}
          </p>
        )}

        {door === "copy" &&
          (parameters.length > 0 ? (
            <div className="rounded-md border border-border px-3 py-2">
              <p className="m-0 text-xs leading-[1.6] text-muted-foreground">
                {schemeLink ? "Anything on this Mac that opens a URL can run this script" : "Anything that opens a URL can run this script"}: a{" "}
                {schemeLink ? "Raycast quicklink, an Alfred workflow, a Shortcut" : "bookmark, a Raycast quicklink, a link in a document"}, or{" "}
                <span className="font-mono text-foreground">open &ldquo;{shellExample}&rdquo;</span> in a shell.
              </p>
            </div>
          ) : (
            // A script that takes nothing still gets the sheet: the URL is the whole point of it.
            <p className="m-0 text-xs leading-[1.6] text-muted-foreground">
              This script takes no parameters. Anything that opens a URL can run it — a{" "}
              {schemeLink ? "Raycast quicklink, an Alfred workflow, a Shortcut" : "bookmark, a Raycast quicklink, a link in a document"}, or{" "}
              <span className="font-mono text-foreground">open</span> in a shell.
            </p>
          ))}
      </div>
    </Dialog>
  );
}

// The one treatment a filename gets everywhere: mono, with the extension quiet behind
// the name.
function SheetTitle({ door, fileName }: { door: ParameterDoor; fileName: string }) {
  const name = (
    <span className="font-mono">
      <FileName name={fileName} />
    </span>
  );
  return (
    <span className="flex items-center gap-2">
      {door === "run" ? <Play size={14} className="shrink-0 text-muted-foreground" /> : <Link2 size={15} className="shrink-0 text-muted-foreground" />}
      <span>{door === "copy" ? <>Copy deeplink to {name}</> : door === "arrived" ? <>Run {name} from a deeplink</> : <>Run {name} with parameters</>}</span>
    </span>
  );
}

function Guidance({ door, parameters }: { door: ParameterDoor; parameters: string[] }) {
  if (door === "copy") {
    return (
      <>
        A value typed here is baked into the deeplink. Left blank, the key still ships — point a launcher&rsquo;s token at it, like Raycast&rsquo;s{" "}
        <span className="font-mono">{"{clipboard}"}</span>.
      </>
    );
  }
  if (door === "arrived") {
    return (
      <>
        Values came in on the deeplink. Edit any of them before running; the script&rsquo;s own <span className="font-mono">kaja.ask*</span> prompts still run
        in the console.
      </>
    );
  }
  return (
    <>
      Sets <span className="font-mono">{parameters.length === 1 ? `kaja.input.${parameters[0]}` : "kaja.input"}</span> for this run only. Blank behaves exactly
      like a plain Run.
    </>
  );
}

// A clipped field still hides its tail, so the whole value is one hover away. Only
// where there is one: a tooltip over an empty field says nothing.
function ParameterField({
  id,
  ref,
  value,
  placeholder,
  onChange,
}: {
  id: string;
  ref?: React.Ref<HTMLInputElement>;
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  const field = <Input id={id} ref={ref} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />;
  return value ? (
    <SimpleTooltip text={value} side="top">
      {field}
    </SimpleTooltip>
  ) : (
    field
  );
}
