import { Braces, FileCode, House, PenLine, Plug, ScrollText, Settings, type LucideIcon } from "lucide-react";
import * as monaco from "monaco-editor";
import { appType, appTypeLabel, getAppType } from "./appTypes";
import { Script } from "./apps";
import { isUntouched, Draft } from "./drafts";
import { draftTitleText } from "./draftTitle";
import { ConfigurationApp } from "./server/api";

// How many views the pane keeps mounted. There is no "open files" set: this is a
// cache, so going back to something is instant and keeps its cursor. It has no UI and
// nothing can be closed out of it.
const MOUNTED_LIMIT = 10;

// Most-recently-visited order — `views[0]` is what the window is showing, `views[1]`
// is what ⌘P⏎ goes back to — and the tail is evicted once the cache is full.
interface ViewBase {
  id: string;
  // Creation order. Bodies are rendered in it, so a live Monaco editor is never moved
  // in the DOM when the visit order changes.
  seq: number;
}

export interface CompilerView extends ViewBase {
  type: "compiler";
}

// Where the window opens and where "back" ends up. It holds nothing of its own, so it
// costs nothing to keep mounted for the life of the session.
export interface StartView extends ViewBase {
  type: "start";
}

// The draft itself lives in the draft store and outlives the view.
export interface DraftView extends ViewBase {
  type: "draft";
  draftId: string;
  model: monaco.editor.ITextModel;
  viewState?: monaco.editor.ICodeEditorViewState;
}

export interface DefinitionView extends ViewBase {
  type: "definition";
  model: monaco.editor.ITextModel;
  startLineNumber: number;
  startColumn: number;
}

// The view is the app: it is named after it, and a new app is the unsaved instance
// of the same document.
export interface AppFormView extends ViewBase {
  type: "appForm";
  mode: "create" | "edit";
  editingAppName?: string;
  initialData?: ConfigurationApp;
  // Lives here rather than in the form because the command row owns the control that
  // switches it.
  editMode: "form" | "json";
}

export interface ScriptView extends ViewBase {
  type: "script";
  script: Script;
  model: monaco.editor.ITextModel;
  viewState?: monaco.editor.ICodeEditorViewState;
}

export interface VariablesView extends ViewBase {
  type: "variables";
}

// Kaja's own MCP server. Like the variables it saves as you go, so there is nothing
// here to protect from eviction.
export interface McpView extends ViewBase {
  type: "mcp";
}

export type View = CompilerView | DraftView | DefinitionView | AppFormView | ScriptView | VariablesView | McpView | StartView;

let sequence = 0;

function nextView(type: string): ViewBase {
  sequence++;
  return { id: `${type}-${sequence}`, seq: sequence };
}

// A draft keeps the same model URI across sessions, so its identity in the editor is
// the one the store uses.
function editorModel(uri: string, code: string): monaco.editor.ITextModel {
  const parsed = monaco.Uri.parse("ts:/" + uri + ".ts");
  const existing = monaco.editor.getModel(parsed);
  if (existing) {
    if (existing.getValue() !== code) existing.setValue(code);
    return existing;
  }
  return monaco.editor.createModel(code, "typescript", parsed);
}

// A form holds edits that exist nowhere else, so it is never evicted to make room.
function holdsWork(view: View): boolean {
  return view.type === "variables" || view.type === "appForm";
}

/**
 * Start, the permanent last entry of the list. Visiting it brings it to the front like
 * anything else and leaving it lets it fall back down, but it never leaves: it is the
 * one place there is always a way back to, which is what the empty pane it replaced
 * could not be.
 */
export function startView(): StartView {
  return { ...nextView("start"), type: "start" };
}

// Bringing a view to the front is the only way one becomes current.
export function visit(views: View[], id: string): View[] {
  const index = views.findIndex((view) => view.id === id);
  if (index <= 0) return views;
  return [views[index], ...views.slice(0, index), ...views.slice(index + 1)];
}

function show(views: View[], view: View): View[] {
  const next = [view, ...views];
  // Start sits outside the cap, so it never costs a real view its place.
  if (next.filter((candidate) => candidate.type !== "start").length <= MOUNTED_LIMIT) return next;

  // Drop the least recently visited view the cache is free to let go of.
  for (let index = next.length - 1; index > 0; index--) {
    if (next[index].type !== "start" && !holdsWork(next[index])) return [...next.slice(0, index), ...next.slice(index + 1)];
  }
  return next;
}

// The document it showed is untouched; this only stops rendering it.
export function dropView(views: View[], id: string): View[] {
  return views.filter((view) => view.id !== id);
}

function update<T extends View>(views: View[], id: string, type: T["type"], changes: Partial<T>): View[] {
  return views.map((view) => (view.id === id && view.type === type ? ({ ...view, ...changes } as View) : view));
}

export function showDraft(views: View[], draft: Draft): View[] {
  const existing = views.find((view) => view.type === "draft" && view.draftId === draft.id);
  if (existing) return visit(views, existing.id);

  return show(views, { ...nextView("draft"), type: "draft", draftId: draft.id, model: editorModel(draft.id, draft.code) });
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
  return show(views, { ...nextView("variables"), type: "variables" });
}

export function showMcp(views: View[]): View[] {
  const existing = views.find((view) => view.type === "mcp");
  if (existing) return visit(views, existing.id);
  return show(views, { ...nextView("mcp"), type: "mcp" });
}

export function showCompiler(views: View[]): View[] {
  const existing = views.find((view) => view.type === "compiler");
  if (existing) return visit(views, existing.id);
  return show(views, { ...nextView("compiler"), type: "compiler" });
}

export function setAppFormEditMode(views: View[], id: string, editMode: "form" | "json"): View[] {
  return update<AppFormView>(views, id, "appForm", { editMode });
}

export interface ViewIdentity {
  name: string;
  // Where it sits, for the finder's list: "theatre / Shows", "Drafts".
  path: string;
  // Empty where the name is already the whole answer.
  origin: string;
  icon: LucideIcon;
  // A browsing buffer: still exactly its generated code and never run, so the next call
  // you pick takes it over. Wherever it is named it is dimmed.
  provisional?: boolean;
  // The name is a filename, so its extension is dimmed wherever it is drawn. Stated
  // rather than read off the dot, because a draft's title is a call — `Sum · 5.3` has
  // no extension to find.
  file?: boolean;
}

export function viewIdentity(view: View, drafts: Draft[] = []): ViewIdentity {
  switch (view.type) {
    case "draft": {
      // The draft store owns the name — it is read from the code, so the view can't have
      // its own copy without the two drifting apart.
      const draft = drafts.find((candidate) => candidate.id === view.draftId);
      return {
        name: draft ? draftTitleText(draft.title) : "Draft",
        path: "Drafts",
        origin: draft?.originAppName ?? "",
        icon: PenLine,
        provisional: draft !== undefined && isUntouched(draft),
      };
    }
    case "script":
      // The folder is the qualifier, which tells two same-named files in different folders
      // apart.
      return {
        name: view.script.name,
        path: view.script.folder ? `Files / ${view.script.folder}` : "Files",
        origin: view.script.folder,
        icon: FileCode,
        file: true,
      };
    case "definition":
      return { name: fileName(view.model.uri.path), path: "Definition", origin: "", icon: FileCode };
    case "appForm":
      return { name: appFormName(view), path: "Settings", origin: "", icon: appFormIcon(view) };
    case "variables":
      return { name: "Variables", path: "Workspace", origin: "", icon: Braces };
    case "mcp":
      return { name: "MCP server", path: "Workspace", origin: "", icon: Plug };
    case "compiler":
      return { name: "Compile log", path: "Output", origin: "", icon: ScrollText };
    // No qualifier: it is one view of its own, and the finder row saying so twice is
    // the icon treatment it is not supposed to have.
    case "start":
      return { name: "Start", path: "", origin: "", icon: House };
  }
}

function fileName(path: string): string {
  return path.split("/").pop() || path;
}

function appFormName(view: AppFormView): string {
  if (view.mode === "edit" && view.editingAppName) {
    return view.editingAppName;
  }
  // In create mode the type is picked in the New dialog, so name it for that.
  const type = view.initialData ? appType(view.initialData) : "";
  return type ? `New ${appTypeLabel(type)} app` : "New app";
}

function appFormIcon(view: AppFormView): LucideIcon {
  return (view.initialData ? getAppType(appType(view.initialData))?.icon : undefined) ?? Settings;
}

interface PersistedDraftView {
  type: "draft";
  draftId: string;
  viewState?: object;
}

interface PersistedScriptView {
  type: "script";
  scriptPath: string;
  scriptName: string;
  scriptFolder?: string;
  code: string;
  viewState?: object;
}

/**
 * What a build from before the word changed wrote for a draft. Read, never written.
 */
interface LegacyScratchView {
  type: "scratch";
  scratchId: string;
  viewState?: object;
}

type PersistedView = PersistedDraftView | PersistedScriptView | LegacyScratchView;

// The draft a persisted view is a window onto, under either spelling.
export function persistedDraftId(view: PersistedView): string | undefined {
  if (view.type === "draft") return view.draftId;
  if (view.type === "scratch") return view.scratchId;
  return undefined;
}

// The visit order is the order of the list, so nothing else has to be stored.
//
// The compile log is not among them: it is a report on this session's apps rather
// than a document, so starting on it means starting on an account of a compilation
// that hasn't run — and with no apps, on one that never can. Neither is Start, which
// is recreated on every launch by definition.
export interface PersistedViewState {
  views: PersistedView[];
}

export function serializeViews(views: View[], getViewState: (id: string) => monaco.editor.ICodeEditorViewState | null | undefined): PersistedViewState {
  const serialized: PersistedView[] = [];

  for (const view of views) {
    if (view.type === "draft") {
      serialized.push({ type: "draft", draftId: view.draftId, viewState: (getViewState(view.id) ?? view.viewState) as object | undefined });
    } else if (view.type === "script") {
      serialized.push({
        type: "script",
        scriptPath: view.script.path,
        scriptName: view.script.name,
        scriptFolder: view.script.folder,
        code: view.model.getValue(),
        viewState: (getViewState(view.id) ?? view.viewState) as object | undefined,
      });
    }
  }

  return { views: serialized };
}

export function restoreViews(state: PersistedViewState | undefined, drafts: Draft[]): View[] {
  const views: View[] = [];

  for (const persisted of state?.views ?? []) {
    if (persisted.type === "script") {
      const view = nextView("script");
      views.push({
        ...view,
        type: "script",
        script: { path: persisted.scriptPath, name: persisted.scriptName, folder: persisted.scriptFolder ?? "" },
        model: editorModel(view.id, persisted.code),
        viewState: persisted.viewState as monaco.editor.ICodeEditorViewState | undefined,
      });
      continue;
    }

    // State written by a build that persisted the compile log still names it.
    const draftId = persistedDraftId(persisted);
    if (draftId === undefined) continue;

    // A draft pruned while its view was cached simply doesn't come back.
    const draft = drafts.find((candidate) => candidate.id === draftId);
    if (!draft) continue;

    views.push({
      ...nextView("draft"),
      type: "draft",
      draftId: draft.id,
      model: editorModel(draft.id, draft.code),
      viewState: persisted.viewState as monaco.editor.ICodeEditorViewState | undefined,
    });
  }

  // Start is the bottom of every stack, which on a workspace that restored nothing
  // makes it the view the window opens on.
  views.push(startView());
  return views;
}
