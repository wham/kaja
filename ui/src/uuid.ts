/**
 * A random version 4 UUID.
 *
 * `crypto.randomUUID` is only available in a secure context, which the desktop's
 * webview page (`wails://localhost`) and a kaja served over plain http are not — the
 * same rule that keeps `navigator.clipboard` out of reach there. So every id kaja
 * mints comes from here rather than from the global, or a call, a compilation or a
 * script's fetch throws where the value is generated.
 */
export function uuidV4(): string {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
