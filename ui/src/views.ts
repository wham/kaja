import { Braces, FileCode, PenLine, ScrollText, Settings, type LucideIcon } from "lucide-react";
import * as monaco from "monaco-editor";
import { appType, appTypeLabel, getAppType } from "./appTypes";
import { Script } from "./apps";
import { Scratch } from "./scratches";
import { ConfigurationApp } from "./server/api";

// How many views the pane keeps mounted. There is no "open files" set: this is
// a cache, so that going back to something is instant and keeps its cursor.
// It has no UI, nothing can be closed out of it, and its size is a performance
// choice rather than anything the user manages.
const MOUNTED_LIMIT = 10;

// One view per thing you can look at. They live in most-recently-visited order
// — `views[0]` is what the window is showing, `views[1]` is what ⌘P⏎ goes back
// to — and the tail is evicted once the cache is full.
interface ViewBase {
  id: string;
  // Creation order. Bodies are rendered in it, so a live Monaco editor is never
  // moved in the DOM when the visit order changes.
  seq: number;
}

export interface CompilerView extends ViewBase {
  type: "compiler";
}

// A window onto a scratch. The scratch itself lives in the scratch store and
// outlives the view — navigating away puts the buffer down, it doesn't throw
// the work out.
export interface ScratchView extends ViewBase {
  type: "scratch";
  scratchId: string;
  model: monaco.editor.ITextModel;
  viewState?: monaco.editor.ICodeEditorViewState;
}

export interface DefinitionView extends ViewBase {
  type: "definition";
  model: monaco.editor.ITextModel;
  startLineNumber: number;
  startColumn: number;
}

// An app's settings. The view is the app: it is named after it, and a new app
// is simply the unsaved instance of the same document.
export interface AppFormView extends ViewBase {
  type: "appForm";
  mode: "create" | "edit";
  editingAppName?: string;
  initialData?: ConfigurationApp;
  // Which view of the app is showing. It lives here rather than in the form
  // because the command row owns the control that switches it.
  editMode: "form" | "json";
}

export interface ScriptView extends ViewBase {
  type: "script";
  // File-backed script in the global scripts directory; content auto-saves to disk.
  script: Script;
  model: monaco.editor.ITextModel;
  viewState?: monaco.editor.ICodeEditorViewState;
}

export interface VariablesView extends ViewBase {
  type: "variables";
  // Like the app form's, this lives here because the command row owns the
  // control that switches it.
  editMode: "table" | "json";
}

export type View = CompilerView | ScratchView | DefinitionView | AppFormView | ScriptView | VariablesView;

let sequence = 0;

function nextView(type: string): ViewBase {
  sequence++;
  return { id: `${type}-${sequence}`, seq: sequence };
}

// A scratch keeps the same model URI across sessions, so its identity in the
// editor is the same one the store uses.
function editorModel(uri: string, code: string): monaco.editor.ITextModel {
  const parsed = monaco.Uri.parse("ts:/" + uri + ".ts");
  const existing = monaco.editor.getModel(parsed);
  if (existing) {
    if (existing.getValue() !== code) existing.setValue(code);
    return existing;
  }
  return monaco.editor.createModel(code, "typescript", parsed);
}

// A form holds edits that exist nowhere else, so it is never evicted to make
// room — navigating away from it and back has to find it as you left it.
function holdsWork(view: View): boolean {
  return view.type === "variables" || view.type === "appForm";
}

// --- Visiting ---

// Bringing a view to the front is the only way one becomes current.
export function visit(views: View[], id: string): View[] {
  const index = views.findIndex((view) => view.id === id);
  if (index <= 0) return views;
  return [views[index], ...views.slice(0, index), ...views.slice(index + 1)];
}

function show(views: View[], view: View): View[] {
  const next = [view, ...views];
  if (next.length <= MOUNTED_LIMIT) return next;

  // Drop the least recently visited view the cache is free to let go of.
  for (let index = next.length - 1; index > 0; index--) {
    if (!holdsWork(next[index])) return [...next.slice(0, index), ...next.slice(index + 1)];
  }
  return next;
}

// Taking a view out of the cache: the document it showed is untouched, this
// only stops rendering it (the app it belonged to went away, a preview was
// switched off, the scratch was deleted).
export function dropView(views: View[], id: string): View[] {
  return views.filter((view) => view.id !== id);
}

function update<T extends View>(views: View[], id: string, type: T["type"], changes: Partial<T>): View[] {
  return views.map((view) => (view.id === id && view.type === type ? ({ ...view, ...changes } as View) : view));
}

// --- Opening ---

export function showScratch(views: View[], scratch: Scratch): View[] {
  const existing = views.find((view) => view.type === "scratch" && view.scratchId === scratch.id);
  if (existing) return visit(views, existing.id);

  return show(views, { ...nextView("scratch"), type: "scratch", scratchId: scratch.id, model: editorModel(scratch.id, scratch.code) });
}

export function showScript(views: View[], script: Script, content: string): View[] {
  const existing = views.find((view) => view.type === "script" && view.script.path === script.path);
  if (existing?.type === "script") {
    // Refresh contents in case the file changed on disk.
    existing.model.setValue(content);
    existing.script = script;
    return visit([...views], existing.id);
  }

  const view = nextView("script");
  return show(views, { ...view, type: "script", script, model: editorModel(view.id, content) });
}

export function showDefinition(views: View[], model: monaco.editor.ITextModel, startLineNumber: number, startColumn: number): View[] {
  return show(views, { ...nextView("definition"), type: "definition", model, startLineNumber, startColumn });
}

export function showAppForm(views: View[], mode: "create" | "edit", initialData?: ConfigurationApp): View[] {
  const existing = views.find((view) => view.type === "appForm" && view.mode === mode && view.editingAppName === initialData?.name);
  if (existing) return visit(views, existing.id);

  return show(views, { ...nextView("appForm"), type: "appForm", mode, editingAppName: initialData?.name, initialData, editMode: "form" });
}

export function showVariables(views: View[]): View[] {
  const existing = views.find((view) => view.type === "variables");
  if (existing) return visit(views, existing.id);
  return show(views, { ...nextView("variables"), type: "variables", editMode: "table" });
}

export function showCompiler(views: View[]): View[] {
  const existing = views.find((view) => view.type === "compiler");
  if (existing) return visit(views, existing.id);
  return show(views, { ...nextView("compiler"), type: "compiler" });
}

export function setAppFormEditMode(views: View[], id: string, editMode: "form" | "json"): View[] {
  return update<AppFormView>(views, id, "appForm", { editMode });
}

export function setVariablesEditMode(views: View[], id: string, editMode: "table" | "json"): View[] {
  return update<VariablesView>(views, id, "variables", { editMode });
}

// --- What a view is called ---

export interface ViewIdentity {
  name: string;
  // Where it sits, for the finder's list: "benchling / Folders", "Scripts".
  path: string;
  // The qualifier the trigger carries beside the name, empty where the name is
  // already the whole answer.
  origin: string;
  icon: LucideIcon;
}

export function viewIdentity(view: View, scratches: Scratch[] = []): ViewIdentity {
  switch (view.type) {
    case "scratch": {
      // The scratch store owns the name — it is read from the code, so the view
      // can't have its own copy without the two drifting apart. Same vocabulary
      // as a saved script: only the icon says it isn't on disk.
      const scratch = scratches.find((candidate) => candidate.id === view.scratchId);
      return { name: scratch?.title ?? "Scratch", path: "Scripts", origin: scratch?.origin?.appName ?? "", icon: PenLine };
    }
    case "script":
      return { name: view.script.name, path: "Scripts", origin: "", icon: FileCode };
    case "definition":
      return { name: fileName(view.model.uri.path), path: "Definition", origin: "", icon: FileCode };
    case "appForm":
      return { name: appFormName(view), path: "Settings", origin: "", icon: appFormIcon(view) };
    case "variables":
      return { name: "Variables", path: "Workspace", origin: "", icon: Braces };
    case "compiler":
      return { name: "Compile log", path: "Output", origin: "", icon: ScrollText };
  }
}

function fileName(path: string): string {
  return path.split("/").pop() || path;
}

function appFormName(view: AppFormView): string {
  if (view.mode === "edit" && view.editingAppName) {
    // The view is the app, so it is named after it.
    return view.editingAppName;
  }
  // In create mode the type is picked in the New dialog, so name it for that.
  const type = view.initialData ? appType(view.initialData) : "";
  return type ? `New ${appTypeLabel(type)} app` : "New app";
}

function appFormIcon(view: AppFormView): LucideIcon {
  return (view.initialData ? getAppType(appType(view.initialData))?.icon : undefined) ?? Settings;
}

// --- Persistence ---

interface PersistedScratchView {
  type: "scratch";
  scratchId: string;
  viewState?: object;
}

interface PersistedCompilerView {
  type: "compiler";
}

interface PersistedScriptView {
  type: "script";
  scriptPath: string;
  scriptName: string;
  code: string;
  viewState?: object;
}

type PersistedView = PersistedScratchView | PersistedCompilerView | PersistedScriptView;

// The visit order is the order of the list, so nothing else has to be stored:
// what was on screen is what restores first.
export interface PersistedViewState {
  views: PersistedView[];
}

export function serializeViews(views: View[], getViewState: (id: string) => monaco.editor.ICodeEditorViewState | null | undefined): PersistedViewState {
  const serialized: PersistedView[] = [];

  for (const view of views) {
    if (view.type === "compiler") {
      serialized.push({ type: "compiler" });
    } else if (view.type === "scratch") {
      serialized.push({ type: "scratch", scratchId: view.scratchId, viewState: (getViewState(view.id) ?? view.viewState) as object | undefined });
    } else if (view.type === "script") {
      serialized.push({
        type: "script",
        scriptPath: view.script.path,
        scriptName: view.script.name,
        code: view.model.getValue(),
        viewState: (getViewState(view.id) ?? view.viewState) as object | undefined,
      });
    }
  }

  return { views: serialized };
}

export function restoreViews(state: PersistedViewState | undefined, scratches: Scratch[]): View[] {
  const views: View[] = [];

  for (const persisted of state?.views ?? []) {
    if (persisted.type === "compiler") {
      views.push({ ...nextView("compiler"), type: "compiler" });
      continue;
    }

    if (persisted.type === "script") {
      const view = nextView("script");
      views.push({
        ...view,
        type: "script",
        script: { path: persisted.scriptPath, name: persisted.scriptName },
        model: editorModel(view.id, persisted.code),
        viewState: persisted.viewState as monaco.editor.ICodeEditorViewState | undefined,
      });
      continue;
    }

    // A scratch pruned while its view was cached simply doesn't come back.
    const scratch = scratches.find((candidate) => candidate.id === persisted.scratchId);
    if (!scratch) continue;

    views.push({
      ...nextView("scratch"),
      type: "scratch",
      scratchId: scratch.id,
      model: editorModel(scratch.id, scratch.code),
      viewState: persisted.viewState as monaco.editor.ICodeEditorViewState | undefined,
    });
  }

  return views;
}
