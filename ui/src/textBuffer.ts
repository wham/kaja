/**
 * The text of one file the editor knows about — a script, a draft, a generated module,
 * the `kaja` declaration — held apart from any editor showing it. A view is cached
 * while its editor comes and goes, and TypeScript has to see every module whether or
 * not one is on screen, so the text cannot live in the editor.
 *
 * The path is the file's name to TypeScript, flat for a script and a draft so that
 * `import … from "github"` resolves to the app's barrel the same way from all of them.
 */
export class TextBuffer {
  private text: string;
  private listeners = new Set<(origin: unknown) => void>();
  private disposed = false;

  constructor(
    readonly path: string,
    text: string,
  ) {
    this.text = text;
  }

  getValue(): string {
    return this.text;
  }

  /**
   * Replaces the text. An editor showing the buffer applies it as an edit of its own,
   * so its undo history survives; `origin` is the editor that made the change, which is
   * the one editor that has it already.
   */
  setValue(text: string, origin?: unknown): void {
    if (this.disposed || text === this.text) return;
    this.text = text;
    for (const listener of [...this.listeners]) listener(origin);
    notifyRegistry(this, "change");
  }

  onDidChange(listener: (origin: unknown) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  isDisposed(): boolean {
    return this.disposed;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.listeners.clear();
    buffers.delete(this.path);
    notifyRegistry(this, "dispose");
  }
}

const buffers = new Map<string, TextBuffer>();

type RegistryEvent = "create" | "change" | "dispose";
const registryListeners = new Set<(buffer: TextBuffer, event: RegistryEvent) => void>();

function notifyRegistry(buffer: TextBuffer, event: RegistryEvent) {
  for (const listener of registryListeners) listener(buffer, event);
}

export function getBuffer(path: string): TextBuffer | undefined {
  return buffers.get(path);
}

export function allBuffers(): TextBuffer[] {
  return [...buffers.values()];
}

// The buffer at a path, its text replaced where it already exists.
export function openBuffer(path: string, text: string): TextBuffer {
  const existing = buffers.get(path);
  if (existing) {
    existing.setValue(text);
    return existing;
  }
  const buffer = new TextBuffer(path, text);
  buffers.set(path, buffer);
  notifyRegistry(buffer, "create");
  return buffer;
}

export function subscribeBuffers(listener: (buffer: TextBuffer, event: RegistryEvent) => void): () => void {
  registryListeners.add(listener);
  return () => registryListeners.delete(listener);
}

export function lineColumnAt(text: string, offset: number): { line: number; column: number } {
  const before = text.slice(0, offset);
  const newline = before.lastIndexOf("\n");
  return { line: before.split("\n").length, column: offset - newline };
}

export function offsetAt(text: string, line: number, column: number): number {
  let offset = 0;
  for (let current = 1; current < line; current++) {
    const next = text.indexOf("\n", offset);
    if (next === -1) return text.length;
    offset = next + 1;
  }
  return Math.min(offset + Math.max(column, 1) - 1, text.length);
}
