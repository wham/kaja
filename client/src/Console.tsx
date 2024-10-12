import { Monaco } from "@monaco-editor/react";
import { Box, Button } from "@primer/react";
import { useEffect, useRef, useState } from "react";
import { formatAndColorizeJson } from "./formatter";
import { MethodCall } from "./kaja";
import { methodId } from "./project";
import { Log, LogLevel } from "./server/api";

export type ConsoleItem = Log[] | MethodCall;

interface ConsoleProps {
  items: ConsoleItem[];
  monaco?: Monaco;
}

export function Console({ items, monaco }: ConsoleProps) {
  const containerRef = useRef<HTMLDivElement>();
  const bottomRef = useRef<HTMLDivElement>();

  const scrollToBottom = () => {
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  };

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const observer = new ResizeObserver(() => {
      scrollToBottom();
    });

    observer.observe(containerRef.current);
  }, []);

  return (
    <Box sx={{ fontSize: 12, padding: 1 }} ref={containerRef}>
      {items.map((item, index) => {
        let itemElement;
        if (Array.isArray(item)) {
          itemElement = <Console.Logs logs={item} />;
        } else if ("method" in item) {
          itemElement = <Console.MethodCall methodCall={item} monaco={monaco} />;
        }

        return <Box key={index}>{itemElement}</Box>;
      })}
      <Box ref={bottomRef} />
    </Box>
  );
}

interface LogsProps {
  logs: Log[];
}

Console.Logs = function ({ logs }: LogsProps) {
  return (
    <pre style={{ margin: 0 }}>
      <code style={{ whiteSpace: "pre-wrap" }}>
        {logs.map((log, index) => (
          <span key={index} style={{ color: colorForLogLevel(log.level) }}>
            {log.message}
            {"\n"}
          </span>
        ))}
      </code>
    </pre>
  );
};

interface MethodCallProps {
  methodCall: MethodCall;
  monaco?: Monaco;
}

Console.MethodCall = function ({ methodCall, monaco }: MethodCallProps) {
  const [html, setHtml] = useState<string>("");
  const [showingOutput, setShowingOutput] = useState(true);

  const onInputClick = async () => {
    setHtml(await formatAndColorizeJson(methodCall.input, monaco));
    setShowingOutput(false);
  };

  const onOutputClick = async () => {
    setHtml(await formatAndColorizeJson(methodCall.output, monaco));
    setShowingOutput(true);
  };

  const onErrorClick = async () => {
    setHtml(await formatAndColorizeJson(methodCall.error, monaco));
    setShowingOutput(true);
  };

  useEffect(() => {
    formatAndColorizeJson(methodCall.output || methodCall.error, monaco).then((html) => {
      setHtml(html);
      setShowingOutput(true);
    });
  }, [methodCall, monaco]);

  return (
    <>
      <Box sx={{ display: "flex", alignItems: "center" }}>
        <code>
          <span style={{ color: colorForLogLevel(LogLevel.LEVEL_INFO) }}>{methodId(methodCall.service, methodCall.method) + "("}</span>
        </code>
        <Button inactive={!showingOutput} size="small" variant="invisible" onClick={onInputClick}>
          <code>input</code>
        </Button>
        <code>
          <span style={{ color: colorForLogLevel(LogLevel.LEVEL_INFO) }}>):&nbsp;</span>
        </code>
        {methodCall.output && (
          <Button inactive={showingOutput} size="small" variant="invisible" onClick={onOutputClick}>
            <code>output</code>
          </Button>
        )}
        {methodCall.error && (
          <Button inactive={showingOutput} size="small" variant="invisible" onClick={onErrorClick}>
            <code style={{ color: colorForLogLevel(LogLevel.LEVEL_ERROR) }}>error</code>
          </Button>
        )}
        {!methodCall.output && !methodCall.error && <Button size="small" loading={true} />}
      </Box>
      <pre>
        <code style={{ whiteSpace: "pre-wrap" }} dangerouslySetInnerHTML={{ __html: html }} />
      </pre>
    </>
  );
};

function colorForLogLevel(level: LogLevel): string {
  switch (level) {
    case LogLevel.LEVEL_DEBUG:
      return "rgb(99, 108, 118)";
    case LogLevel.LEVEL_INFO:
      return "#3dc9b0";
    case LogLevel.LEVEL_WARN:
      return "rgb(154, 103, 0)";
    case LogLevel.LEVEL_ERROR:
      return "rgb(209, 36, 47)";
  }
}
