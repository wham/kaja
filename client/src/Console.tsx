import { Monaco } from "@monaco-editor/react";
import { Box, Button, Text } from "@primer/react";
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
    <Box sx={{ fontSize: 12, fontFamily: "monospace", color: "fg.default", overflowY: "scroll", paddingX: 2, paddingY: 1 }}>
      <Box ref={containerRef}>
        {items.map((item, index) => {
          let itemElement;
          if (Array.isArray(item)) {
            itemElement = <Console.Logs logs={item} />;
          } else if ("method" in item) {
            itemElement = <Console.MethodCall methodCall={item} monaco={monaco} onInteract={onMethodCallInteract} />;
          }

          return <Box key={index}>{itemElement}</Box>;
        })}
      </Box>
      <Box ref={bottomRef} />
    </Box>
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
  monaco?: Monaco;
  onInteract: () => void;
}

Console.MethodCall = function ({ methodCall, monaco, onInteract }: MethodCallProps) {
  const [html, setHtml] = useState<string>("");
  const [showingOutput, setShowingOutput] = useState(true);

  const onInputClick = async () => {
    onInteract();
    setHtml(await formatAndColorizeJson(methodCall.input, monaco));
    setShowingOutput(false);
  };

  const onOutputClick = async () => {
    onInteract();
    setHtml(await formatAndColorizeJson(methodCall.output, monaco));
    setShowingOutput(true);
  };

  const onErrorClick = async () => {
    onInteract();
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
        <Text sx={{ color: colorForLogLevel(LogLevel.LEVEL_INFO) }}>{methodId(methodCall.service, methodCall.method) + "("}</Text>
        <Button inactive={!showingOutput} size="small" variant="invisible" onClick={onInputClick} sx={{ color: "#569cd6" }}>
          input
        </Button>
        <Text sx={{ color: colorForLogLevel(LogLevel.LEVEL_INFO) }}>):&nbsp;</Text>
        {methodCall.output && (
          <Button inactive={showingOutput} size="small" variant="invisible" onClick={onOutputClick} sx={{ color: "#569cd6" }}>
            output
          </Button>
        )}
        {methodCall.error && (
          <Button inactive={showingOutput} size="small" variant="invisible" onClick={onErrorClick} sx={{ color: colorForLogLevel(LogLevel.LEVEL_ERROR) }}>
            error
          </Button>
        )}
        {!methodCall.output && !methodCall.error && <Button size="small" loading={true} />}
      </Box>
      <pre style={{ whiteSpace: "pre-wrap" }} dangerouslySetInnerHTML={{ __html: html }} />
    </>
  );
};

function colorForLogLevel(level: LogLevel): string {
  switch (level) {
    case LogLevel.LEVEL_DEBUG:
      return "#979797";
    case LogLevel.LEVEL_INFO:
      return "#dcdcd";
    case LogLevel.LEVEL_WARN:
      return "#f9d948";
    case LogLevel.LEVEL_ERROR:
      return "#df5a53";
  }
}
