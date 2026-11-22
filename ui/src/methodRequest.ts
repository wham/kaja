export interface MethodRequest {
  verb: string;
  path: string;
  // Read off the verb, which is the only thing that states whether a call changes something.
  write: boolean;
}

const READS = new Set(["GET", "HEAD", "OPTIONS", "TRACE"]);

export function parseMethodRequest(http: string | undefined): MethodRequest | undefined {
  const [verb, ...rest] = (http ?? "").trim().split(/\s+/);
  if (!verb) return undefined;
  const upper = verb.toUpperCase();
  return { verb: upper, path: rest.join(" "), write: !READS.has(upper) };
}
