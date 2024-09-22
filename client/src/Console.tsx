import { Log, LogLevel } from "./server/server";

interface ConsoleProps {
  items: ConsoleItem[];
}

type ConsoleItem = Log | ConsoleJson;

interface ConsoleJson {
  json: string;
}

export function Console({ items }: ConsoleProps) {
  return (
    <pre>
      <code style={{ whiteSpace: "pre-wrap" }}>
        {items.map((log, index) => (
          <span key={index} style={{ color: colorForLogLevel(log.level) }}>
            {log.message}
            {"\n"}
          </span>
        ))}
      </code>
    </pre>
  );
}

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
