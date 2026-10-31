import { ArrowUp, CircleAlert, Sparkles, Square, SquarePen } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";

import {
  askAssistant,
  assistantState,
  assistantStatus,
  resetAssistant,
  stepLabel,
  stopAssistant,
  subscribeAssistant,
  type AssistantEntry,
} from "./assistantStore";
import { cn } from "./cn";
import { IconButton } from "./components/icon-button";
import { Spinner } from "./components/spinner";

/**
 * A conversation with the phone's own model, which drives the same tools an agent on
 * the Mac drives over MCP. What it runs lands in its own draft, so the run it made is
 * one tap away in the sidebar.
 */
export function Assistant({ active }: { active: boolean }) {
  const { entries, thinking } = useSyncExternalStore(subscribeAssistant, assistantState);
  const [status, setStatus] = useState<{ available: boolean; reason: string }>();
  const [prompt, setPrompt] = useState("");
  const scroller = useRef<HTMLDivElement>(null);

  // Asked each time the view comes back, because the answer moves in Settings.
  useEffect(() => {
    if (active) void assistantStatus().then(setStatus);
  }, [active]);

  useLayoutEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [entries.length, thinking]);

  const send = () => {
    const text = prompt.trim();
    if (!text || thinking) return;
    setPrompt("");
    void askAssistant(text);
  };

  if (status && !status.available) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-background px-8 text-center">
        <Sparkles size={24} className="text-muted-foreground" />
        <p className="text-sm text-muted-foreground">{status.reason}</p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-4 pt-4 pb-2">
        {entries.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <Sparkles size={24} className="text-muted-foreground" />
            <p className="max-w-72 text-sm text-muted-foreground">Ask about the workspace's APIs, or ask for something to be called</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {entries.map((entry, index) => (
              <Entry key={index} entry={entry} />
            ))}
            {thinking && (
              <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
                <Spinner size="sm" />
                Thinking
              </div>
            )}
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-end gap-2 border-t border-border px-3 py-2">
        {entries.length > 0 && !thinking && (
          <IconButton icon={SquarePen} variant="ghost" size="lg" aria-label="New conversation" tooltip="none" onClick={resetAssistant} />
        )}
        <textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              send();
            }
          }}
          rows={1}
          placeholder="Ask Apple Intelligence"
          className="max-h-32 min-h-10 flex-1 resize-none rounded-2xl border border-input bg-card px-3.5 py-2 text-base outline-none field-sizing-content focus-visible:border-ring"
        />
        {thinking ? (
          <IconButton icon={Square} variant="outline" size="lg" className="rounded-full" aria-label="Stop" tooltip="none" onClick={stopAssistant} />
        ) : (
          <IconButton
            icon={ArrowUp}
            variant="default"
            size="lg"
            className="rounded-full"
            aria-label="Send"
            tooltip="none"
            disabled={!prompt.trim()}
            onClick={send}
          />
        )}
      </div>
    </div>
  );
}

function Entry({ entry }: { entry: AssistantEntry }) {
  switch (entry.kind) {
    case "prompt":
      return <div className="ml-10 self-end rounded-2xl bg-muted px-3.5 py-2 text-[15px] whitespace-pre-wrap">{entry.text}</div>;
    case "answer":
      return <div className="text-[15px] whitespace-pre-wrap">{entry.text}</div>;
    case "error":
      return (
        <div className="flex gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-[13px] text-destructive">
          <CircleAlert size={16} className="mt-px shrink-0" />
          <span className="whitespace-pre-wrap">{entry.text}</span>
        </div>
      );
    case "step":
      return (
        <div className="flex flex-col gap-1">
          <div className={cn("truncate font-mono text-[12px] text-muted-foreground", entry.step.isError && "text-destructive")}>{stepLabel(entry.step)}</div>
          {entry.step.code && <pre className="overflow-x-auto rounded-lg bg-card px-3 py-2 font-mono text-[12px] leading-relaxed">{entry.step.code}</pre>}
        </div>
      );
  }
}
