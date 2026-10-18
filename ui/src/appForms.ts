import { variableReferences } from "./variableExpansion";

// The browser is never handed what a ${NAME} expands to, so a value that reads one is
// taken on trust here and settled by the server.
export function holdsVariableReference(value: string): boolean {
  return variableReferences(value).length > 0;
}

export function isAbsoluteHttpUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return (url.protocol === "http:" || url.protocol === "https:") && url.host !== "";
  } catch {
    return false;
  }
}

// It only asks for an absolute HTTP URL: what is serving there is the server's to
// find out.
export function isReadableUrl(value: string): boolean {
  return isAbsoluteHttpUrl(value) || holdsVariableReference(value);
}

// Hosts that name the machine rather than the API, so a name derived from one says
// nothing.
function namesTheMachine(host: string): boolean {
  if (!host || host === "localhost" || host.endsWith(".localhost")) return true;
  // An IPv4 or IPv6 literal.
  return /^[\d.]+$/.test(host) || host.includes(":");
}

// nameFromHost names an app after its host: "seating.kaja.tools" by its first label,
// "api.example.com" by the one after the label `noise` says is only where it is
// deployed, and a two-label host as written, since it is already a handle.
export function nameFromHost(host: string, noise: Set<string>): string {
  if (namesTheMachine(host)) return "";
  const labels = host
    .replace(/^www\./i, "")
    .split(".")
    .filter(Boolean);
  if (labels.length < 3) return sanitizeName(labels.join("."));
  const first = labels.findIndex((label) => !noise.has(label.toLowerCase()));
  return sanitizeName(labels[first === -1 ? 0 : first]);
}

export function urlHost(url: string): string {
  try {
    return new URL(url.trim()).hostname;
  } catch {
    return "";
  }
}

const SEPARATORS = "._-";

// sanitizeName keeps only what an import path can carry. The trimming is a scan rather
// than an anchored `/^[._-]+|[._-]+$/` replace, which backtracks quadratically on a
// string that is whatever a server chose to call itself.
export function sanitizeName(value: string): string {
  const kept = value.replace(/[^\p{L}\p{N}._-]+/gu, "");
  let start = 0;
  let end = kept.length;
  while (start < end && SEPARATORS.includes(kept[start])) start++;
  while (end > start && SEPARATORS.includes(kept[end - 1])) end--;
  return kept.slice(start, end);
}

// uniqueAppName keeps a derived name a starting point rather than a collision.
export function uniqueAppName(name: string, taken: string[]): string {
  if (!name || !taken.includes(name)) return name;
  for (let suffix = 2; suffix < 1000; suffix++) {
    const candidate = `${name}${suffix}`;
    if (!taken.includes(candidate)) return candidate;
  }
  return name;
}

const INSPECTED_LIMIT = 20;

// remember keeps a successful read, so flipping between apps doesn't read what hasn't
// changed, letting go of the oldest past a bound.
export function remember<T>(inspected: Map<string, T>, key: string, value: T): void {
  inspected.delete(key);
  inspected.set(key, value);
  for (const oldest of inspected.keys()) {
    if (inspected.size <= INSPECTED_LIMIT) break;
    inspected.delete(oldest);
  }
}

// joinReading has two forms, or one form mounted twice, ask the server the same
// question once.
export function joinReading<T>(reading: Map<string, Promise<T>>, key: string, start: () => Promise<T>): Promise<T> {
  const pending = reading.get(key);
  if (pending) return pending;
  const started = start().finally(() => reading.delete(key));
  reading.set(key, started);
  return started;
}
