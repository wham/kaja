import { Button, Text } from "@primer/react";
import { useEffect, useRef, useState } from "react";
import { formatAndColorizeJson } from "./formatter";
import { MethodCall } from "./kaja";
import { methodId } from "./project";
import { Log, LogLevel } from "./server/api";

export type ConsoleItem = Log[] | MethodCall;

interface ConsoleProps {
  items: ConsoleItem[];
}

export function Console({ items }: ConsoleProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);

  const scrollToBottom = () => {
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "start" });
    }
  };

  const onMethodCallInteract = () => {
    autoScrollRef.current = false;
  };

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const observer = new ResizeObserver(() => {
      if (autoScrollRef.current) {
        scrollToBottom();
      }
    });

    observer.observe(containerRef.current);
  }, []);

  useEffect(() => {
    autoScrollRef.current = true;
  }, [items]);

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        overflowY: "auto",
        fontSize: 12,
        fontFamily: "monospace",
        color: "var(--fgColor-default)",
        paddingLeft: 16,
        paddingRight: 8,
        paddingTop: 12,
        paddingBottom: 4,
      }}
    >
      <div ref={containerRef}>
        {items.map((item, index) => {
          let itemElement;
          if (Array.isArray(item)) {
            itemElement = <Console.Logs logs={item} />;
          } else if ("method" in item) {
            itemElement = <Console.MethodCall methodCall={item} onInteract={onMethodCallInteract} />;
          }

          return <div key={index}>{itemElement}</div>;
        })}
      </div>
      <div ref={bottomRef} />
    </div>
  );
}

interface LogsProps {
  logs: Log[];
}

Console.Logs = function ({ logs }: LogsProps) {
  return (
    <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>
      {logs.map((log, index) => (
        <span key={index} style={{ color: colorForLogLevel(log.level) }}>
          {log.message}
          {"\n"}
        </span>
      ))}
    </pre>
  );
};

interface MethodCallProps {
  methodCall: MethodCall;
  onInteract: () => void;
}

Console.MethodCall = function ({ methodCall, onInteract }: MethodCallProps) {
  const [html, setHtml] = useState<string>("");
  const [showingOutput, setShowingOutput] = useState(true);

  const onInputClick = async () => {
    onInteract();
    setHtml(await formatAndColorizeJson(methodCall.input));
    setShowingOutput(false);
  };

  const onOutputClick = async () => {
    onInteract();
    setHtml(await formatAndColorizeJson(methodCall.output));
    setShowingOutput(true);
  };

  const onErrorClick = async () => {
    onInteract();
    setHtml(await formatAndColorizeJson(methodCall.error));
    setShowingOutput(true);
  };

  useEffect(() => {
    formatAndColorizeJson(methodCall.output || methodCall.error).then((html) => {
      setHtml(html);
      setShowingOutput(true);
    });
  }, [methodCall]);

  return (
    <>
      <div style={{ display: "flex", alignItems: "center" }}>
        <span style={{ color: "var(--fgColor-muted)" }}>{methodId(methodCall.service, methodCall.method) + "("}</span>
        <Button inactive={!showingOutput} size="small" variant="invisible" onClick={onInputClick} style={{ color: "var(--fgColor-accent)" }}>
          input
        </Button>
        <span style={{ color: "var(--fgColor-muted)" }}>):&nbsp;</span>
        {methodCall.output && (
          <Button inactive={showingOutput} size="small" variant="invisible" onClick={onOutputClick} style={{ color: "var(--fgColor-accent)" }}>
            output
          </Button>
        )}
        {methodCall.error && (
          <Button inactive={showingOutput} size="small" variant="invisible" onClick={onErrorClick} style={{ color: "var(--fgColor-danger)" }}>
            error
          </Button>
        )}
        {!methodCall.output && !methodCall.error && <Button size="small" loading={true} />}
      </div>
      <pre style={{ whiteSpace: "pre-wrap" }} dangerouslySetInnerHTML={{ __html: html }} />
    </>
  );
};

function colorForLogLevel(level: LogLevel): string {
  switch (level) {
    case LogLevel.LEVEL_DEBUG:
      return "var(--fgColor-muted)";
    case LogLevel.LEVEL_INFO:
      return "var(--fgColor-default)";
    case LogLevel.LEVEL_WARN:
      return "var(--fgColor-attention)";
    case LogLevel.LEVEL_ERROR:
      return "var(--fgColor-danger)";
  }
}
