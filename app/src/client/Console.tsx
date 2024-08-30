import { Log } from "../shared/api";

type ConsoleProps = {
  logs: Log[];
};

export function Console({ logs }: ConsoleProps) {
  return (
    <pre>
      <code style={{ whiteSpace: "pre-wrap" }}>{logs.map((log) => log.message).join("\n")}</code>
    </pre>
  );
}
