import { Box } from "@primer/react";
import { formatAndColorizeJson } from "./formatter";
import { Log, LogLevel } from "./server/server";

interface ConsoleProps {
  children?: React.ReactNode;
}

export function Console({ children }: ConsoleProps) {
  return <Box>{children}</Box>;
}

interface LogsProps {
  logs: Log[];
}

Console.Logs = function ({ logs }: LogsProps) {
  return (
    <pre>
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

interface JsonProps {
  json: string;
}

Console.Json = function ({ json }: JsonProps) {
  return (
    <pre>
      <code style={{ whiteSpace: "pre-wrap" }} dangerouslySetInnerHTML={{ __html: formatAndColorizeJson(json) }} />
    </pre>
  );
};

function colorForLogLevel(level: LogLevel): string {
  switch (level) {
    case LogLevel.LEVEL_DEBUG:
      return "rgb(99, 108, 118)";
    case LogLevel.LEVEL_INFO:
      return "rgb(26, 127, 55)";
    case LogLevel.LEVEL_WARN:
      return "rgb(154, 103, 0)";
    case LogLevel.LEVEL_ERROR:
      return "rgb(209, 36, 47)";
  }
}
