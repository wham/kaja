// Which way a method streams, read off the proto. Taken structurally rather than as
// a Method, since the flags reach here off a MethodInfo too — the generated stub is
// where the code a person clicks into is written.
export interface Streams {
  serverStreaming?: boolean;
  clientStreaming?: boolean;
}

export type StreamingKind = "server" | "client" | "bidirectional";

export function streamingKind(method: Streams): StreamingKind | undefined {
  if (method.serverStreaming && method.clientStreaming) return "bidirectional";
  if (method.serverStreaming) return "server";
  if (method.clientStreaming) return "client";
  return undefined;
}

// Both builds carry a stream from the server and neither carries one to it, so a
// method that streams from the client — a bidirectional one included — is listed
// wherever the app's surface is listed and called nowhere.
export function isCallable(method: Streams): boolean {
  const kind = streamingKind(method);
  return kind !== "client" && kind !== "bidirectional";
}

// The one sentence, wherever such a method is met: the tree's mark, the comment over
// the generated call, and the error the run is refused with. Said the same way three
// times because it is one fact, and a reader who meets it twice must not have to work
// out whether they are the same limit.
export const NOT_CALLABLE = "Kaja doesn't call this method: it streams from the client, and Kaja carries a stream from the server only.";

// What the refusal is labelled by. It is Kaja's own, not a status a server sent, so
// classifyFailure reads it directly rather than off an HTTP status or a gRPC code.
export const UNSUPPORTED_CODE = "unsupported";
