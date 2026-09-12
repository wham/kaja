/**
 * A request line as the Headers view draws it — "GET https://api.example.com/orders?page=2"
 * split into the four parts it reads as. The verb and the path are what identify the
 * call; the origin and the query are context around them, and dimming them is what
 * lets the path be found in a line that wraps over three of them.
 *
 * Every part is optional because a request line is a string an app reported rather
 * than a URL kaja built: what cannot be read is left whole in `path` rather than
 * guessed at, so the line is always printed in full.
 */
export interface RequestLineParts {
  method?: string;
  origin?: string;
  path: string;
  query?: string;
}

export function splitRequestLine(line: string): RequestLineParts {
  const trimmed = line.trim();
  const space = trimmed.indexOf(" ");
  // A verb is an uppercase token before the first space — uppercase because that is
  // how every app reports one, and a lowercase word there is prose rather than a
  // method. Anything else is a line naming no method, which is what a bare URL is.
  const method = space > 0 && /^[A-Z]+$/.test(trimmed.slice(0, space)) ? trimmed.slice(0, space) : undefined;
  const target = method === undefined ? trimmed : trimmed.slice(space + 1).trim();

  let parsed: URL | undefined;
  try {
    parsed = new URL(target);
  } catch {
    parsed = undefined;
  }
  if (!parsed) {
    // A relative target, or something that is not a URL at all. Splitting a query off
    // it is still worth doing; inventing an origin for it is not.
    const mark = target.indexOf("?");
    return mark === -1 ? { method, path: target } : { method, path: target.slice(0, mark), query: target.slice(mark) };
  }
  return {
    method,
    origin: parsed.origin === "null" ? undefined : parsed.origin,
    path: `${parsed.pathname}${parsed.hash}`,
    query: parsed.search === "" ? undefined : parsed.search,
  };
}
