/**
 * A standalone object with every member the given host has, each function bound to it.
 *
 * Web platform objects — `console`, `crypto` — carry their methods on a prototype and
 * their data on the instance, and neither is reliably enumerable, so the chain is
 * walked by property name rather than spread or `for..in`. Binding is what makes a
 * method survive being called with a different receiver, which no engine promises to
 * tolerate.
 *
 * It is how a script is handed something that behaves like a global without being one:
 * the clone can be wrapped or filled in (the run's console, a `crypto` that mints ids
 * where the page is not a secure context) while the real global stays Kaja's.
 */
export function bindMembers<T extends object>(real: T): T {
  const clone: { [key: string]: unknown } = {};
  for (let object: object | null = real; object && object !== Object.prototype; object = Object.getPrototypeOf(object)) {
    for (const key of Object.getOwnPropertyNames(object)) {
      if (key in clone) continue;
      const value = (real as unknown as { [key: string]: unknown })[key];
      clone[key] = typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(real) : value;
    }
  }
  return clone as unknown as T;
}
