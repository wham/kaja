import { appTypeLabel } from "./appTypes";

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
//
// A gRPC app is the only one whose calls are forwarded, so it is the only one a
// stream can come back through: every other app answers with one message. That is
// the app's own limit rather than Kaja's, so it is said without a "yet" and it
// covers all three kinds.
export function unsupportedReason(method: Streams, app?: string): string | undefined {
  const kind = streamingKind(method);
  if (kind === undefined) return undefined;
  if (app !== undefined && app !== "grpc") {
    return `${appTypeLabel(app)} has no streaming.`;
  }
  switch (kind) {
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
