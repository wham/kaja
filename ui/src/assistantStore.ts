import { desktop, onWailsEvent } from "./wails";

/**
 * The conversation with the phone's own model, kept outside React so it outlives the
 * view being evicted from the cache. The transcript the model reasons over is Swift's;
 * this is only what the window draws of it.
 */

export interface AssistantStep {
  tool: string;
  detail: string;
  code: string;
  isError: boolean;
}

export type AssistantEntry =
  { kind: "prompt"; text: string } | { kind: "step"; step: AssistantStep } | { kind: "answer"; text: string } | { kind: "error"; text: string };

export interface AssistantState {
  entries: AssistantEntry[];
  thinking: boolean;
}

let state: AssistantState = { entries: [], thinking: false };
const listeners = new Set<() => void>();
let unsubscribeSteps: (() => void) | undefined;

function set(next: AssistantState) {
  state = next;
  for (const listener of listeners) listener();
}

export function subscribeAssistant(listener: () => void): () => void {
  listeners.add(listener);
  unsubscribeSteps ??= onWailsEvent<AssistantStep>("assistant:step", (step) => {
    set({ ...state, entries: [...state.entries, { kind: "step", step }] });
  });
  return () => listeners.delete(listener);
}

export function assistantState(): AssistantState {
  return state;
}

export async function askAssistant(prompt: string): Promise<void> {
  if (state.thinking) return;
  set({ entries: [...state.entries, { kind: "prompt", text: prompt }], thinking: true });
  let entry: AssistantEntry;
  try {
    const app = await desktop();
    entry = { kind: "answer", text: await app.AskAssistant(prompt) };
  } catch (error) {
    entry = { kind: "error", text: error instanceof Error ? error.message : String(error) };
  }
  set({ entries: [...state.entries, entry], thinking: false });
}

export function stopAssistant(): void {
  void desktop().then((app) => app.StopAssistant());
}

export function resetAssistant(): void {
  if (state.thinking) return;
  void desktop().then((app) => app.ResetAssistant());
  set({ entries: [], thinking: false });
}

export async function assistantStatus(): Promise<{ available: boolean; reason: string }> {
  try {
    const app = await desktop();
    return await app.AssistantStatus();
  } catch {
    return { available: false, reason: "The assistant is unavailable." };
  }
}

const TOOL_LABELS: Record<string, string> = {
  list_services: "Looked up the APIs",
  describe_method: "Read",
  run_script: "Ran",
};

/** What a step says it did, in the words a person reads it in. */
export function stepLabel(step: AssistantStep): string {
  const verb = TOOL_LABELS[step.tool] ?? step.tool;
  if (step.tool === "run_script" && !step.detail) return "Ran code";
  return step.detail ? `${verb} ${step.detail}` : verb;
}
