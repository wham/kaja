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

// Why Kaja won't call this method, or undefined where it will. The one sentence,
// wherever such a method is met: the tree's mark, the comment over the generated
// call, and the error the run is refused with. It names the kind and says the plain
// thing about it, because a reader who meets it in the sidebar and again in a run
// must not have to work out whether they are the same limit.
export function unsupportedReason(method: Streams): string | undefined {
  switch (streamingKind(method)) {
    case "client":
      return "Client streaming is not supported by Kaja yet.";
    case "bidirectional":
      return "Bidirectional streaming is not supported by Kaja yet.";
  }
  return undefined;
}

// What the refusal is labelled by. It is Kaja's own, not a status a server sent, so
// classifyFailure reads it directly rather than off an HTTP status or a gRPC code.
export const UNSUPPORTED_CODE = "unsupported";
