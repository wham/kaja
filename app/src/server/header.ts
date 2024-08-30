interface Header {
  name: string;
  value: string;
}

export function parseHeader(header: string): Header | undefined {
  const parts = header.split(":").map((part) => part.trim());

  if (parts.length < 1) {
    return undefined;
  }

  const name = parts[0];

  if (!name) {
    return undefined;
  }

  const value = parts[1] || "";

  return { name, value };
}
