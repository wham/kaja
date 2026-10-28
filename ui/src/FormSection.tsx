import { createContext, useContext, type ReactNode } from "react";
import { AgentNotes, hintPending } from "./agentHints";
import { parameterKey } from "./appTypes";
import { cn } from "./cn";

export interface FormHints {
  notes: AgentNotes;
  // What the hints are about, as the form holds it now, so a hint that asked for
  // something dims once it has been given.
  parameters: Record<string, string>;
  // The type's own parameter keys. A hint about anything else goes with the first section.
  known: ReadonlySet<string>;
}

// Provided only where there is somewhere to write: not on a phone, and not without hints.
export const FormHintsContext = createContext<FormHints | undefined>(undefined);

interface FormSectionProps {
  // The parameters this section asks for, as the form keys them.
  fields?: string[];
  // The first section, which carries who the hints are from and every hint about a
  // field no section asks for.
  lead?: boolean;
  children: ReactNode;
}

// FormSection is one question on an app form, with what the agent that opened the form
// said about it written in the margin level with it. The hints belong to the section
// rather than to one input, because a custom form draws a field only in some states (a
// server the document declares is a choice, not a URL field) and the section is there
// in every one of them. Where the pane is too narrow for a margin, they go under it.
export function FormSection({ fields = [], lead = false, children }: FormSectionProps) {
  const context = useContext(FormHintsContext);
  if (!context) return <>{children}</>;

  const hints = Object.entries(context.notes.hints)
    .map(([field, hint]) => ({ field, key: parameterKey(field), hint }))
    .filter(({ key }) => fields.includes(key) || (lead && !context.known.has(key)))
    .sort((a, b) => rank(fields, a.key) - rank(fields, b.key));

  return (
    <div className="grid gap-x-8 gap-y-3 @min-[52rem]:grid-cols-[minmax(0,600px)_minmax(0,1fr)]">
      <div className="min-w-0">{children}</div>
      {(lead || hints.length > 0) && (
        <div className={cn("flex flex-col gap-3", lead ? "@min-[52rem]:pt-0.5" : "@min-[52rem]:pt-7")}>
          {lead && <span className="text-xs font-medium text-muted-foreground">{context.notes.agent || "Your agent"}</span>}
          {hints.map(({ field, key, hint }) => {
            const pending = hintPending(hint, context.known.has(key) ? context.parameters[key] : undefined);
            return (
              <div key={field} className="flex items-start gap-2 text-xs">
                <span className={cn("shrink-0", pending ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground")}>
                  <span className="@min-[52rem]:hidden">↑</span>
                  <span className="hidden @min-[52rem]:inline">←</span>
                </span>
                <p className={cn("min-w-0 text-pretty", pending ? "text-foreground" : "text-muted-foreground")}>{hint.text}</p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function rank(fields: string[], key: string): number {
  const index = fields.indexOf(key);
  return index === -1 ? fields.length : index;
}
