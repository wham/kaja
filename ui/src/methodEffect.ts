import { Method, Service } from "./apps";

/**
 * Whether calling a method reads or writes, and whether that is known or
 * inferred. An HTTP verb settles it; a gRPC or Twirp method has no verb, so the
 * name is the only signal there is and a caller is told so rather than being
 * handed a guess dressed as a fact.
 *
 * There is one definition of what a write is, and it is here. The MCP server
 * labels its listings from it and the call guard below refuses by it, so the
 * word in `list_services` and the reason a call was refused can never disagree.
 * Go reads the answer off the catalog rather than deriving its own.
 */
export interface MethodEffect {
  read: boolean;
  certain: boolean;
}

// The HTTP verbs that only read. Everything else — including a verb an API
// invented — changes something.
const readingVerbs = ["GET", "HEAD", "OPTIONS", "TRACE"];

// The verbs an API uses to name a method that only reads. A prefix counts only
// when it ends the name or is followed by an upper-case letter, so "Get"
// matches "GetShow" and "Get", not "Generate".
const readingNamePrefixes = [
  "Get",
  "List",
  "Read",
  "Fetch",
  "Search",
  "Query",
  "Find",
  "Lookup",
  "Describe",
  "Count",
  "Check",
  "Watch",
  "Export",
  "Download",
  "Resolve",
  "Has",
  "Is",
  "Show",
  "View",
  "Peek",
  "Stream",
];

export function methodEffect(method: Method): MethodEffect {
  const space = method.http?.indexOf(" ") ?? -1;
  if (method.http && space > 0) {
    return { read: readingVerbs.includes(method.http.slice(0, space).toUpperCase()), certain: true };
  }
  return { read: readingName(method.name), certain: false };
}

export function readingName(name: string): boolean {
  return readingNamePrefixes.some((prefix) => {
    if (!name.startsWith(prefix)) return false;
    const rest = name.slice(prefix.length);
    return rest === "" || (rest[0] >= "A" && rest[0] <= "Z");
  });
}

/**
 * Thrown in place of a call a run may not make. It carries `refused` so the
 * failure survives being serialized into the run store and still classifies as
 * a refusal rather than as a broken exchange — the two look identical from the
 * outside (no status, no code) and mean opposite things about what to do next.
 */
export class CallRefusedError extends Error {
  readonly refused = true;

  constructor(message: string) {
    super(message);
    this.name = "CallRefusedError";
  }
}

export function isRefusal(error: unknown): boolean {
  return !!error && typeof error === "object" && (error as { refused?: unknown }).refused === true;
}

/**
 * The refusal a read-only run answers a write with, or undefined when the call
 * only reads and may proceed. The message says what to do about it, because a
 * refusal an agent can't act on just becomes a retry of the same call.
 */
export function refuseWrite(appName: string, service: Service, method: Method): CallRefusedError | undefined {
  const effect = methodEffect(method);
  if (effect.read) return undefined;

  const where = appName ? `${appName}/${service.name}.${method.name}` : `${service.name}.${method.name}`;
  const inferred = effect.certain ? "" : " Whether it writes was inferred from its name — the API does not state it.";
  return new CallRefusedError(
    `${where} writes, and a script that was never saved may not. Save it with create_script and run it by path: a file the user can read before it runs is where an effect belongs.${inferred}`,
  );
}
