import { Braces, FileCode, ScrollText, Settings, type LucideIcon } from "lucide-react";
import * as monaco from "monaco-editor";
import { generateMethodEditorCode } from "./appLoader";
import { appType, appTypeLabel, getAppType } from "./appTypes";
import { createPendingApp, App, Method, Script, Service } from "./apps";
import { ConfigurationApp } from "./server/api";

// Every open document is one of these, and the list they live in is kept in
// most-recently-visited order: index 0 is the file the window is showing, index
// 1 is what ⌘P⏎ goes back to, and closing the current file falls through to
// whatever is next. There is no other notion of "active", and no positional
// order to preserve — the window has no tab strip to put one in.
interface TabBase {
  id: string;
  // Creation order. Tab bodies are rendered in it, so a live Monaco editor is
  // never moved in the DOM when the visit order changes.
  seq: number;
  // A preview tab reads in italics and is replaced by the next preview open
  // instead of stacking. Editing it, running it, or opening it deliberately
  // (double click) makes it permanent.
  preview: boolean;
}

export interface CompilerTab extends TabBase {
  type: "compiler";
}

export interface TaskTab extends TabBase {
  type: "task";
  originMethod: Method;
  originService: Service;
  originApp: App;
  model: monaco.editor.ITextModel;
  originalCode: string;
  viewState?: monaco.editor.ICodeEditorViewState;
}

export interface DefinitionTab extends TabBase {
  type: "definition";
  model: monaco.editor.ITextModel;
  startLineNumber: number;
  startColumn: number;
}

// An app's settings, opened from the sidebar. The tab is the app: it is named
// after it, and a new app is simply the unsaved instance of the same document.
export interface AppFormTab extends TabBase {
  type: "appForm";
  mode: "create" | "edit";
  editingAppName?: string;
  initialData?: ConfigurationApp;
  // Which view of the app the tab is showing. It lives here rather than in the
  // form because the command row owns the control that switches it.
  editMode: "form" | "json";
}

export interface ScriptTab extends TabBase {
  type: "script";
  // File-backed script in the global scripts directory; content auto-saves to disk.
  script: Script;
  model: monaco.editor.ITextModel;
  viewState?: monaco.editor.ICodeEditorViewState;
}

export interface VariablesTab extends TabBase {
  type: "variables";
  // Like the app form's, this lives here because the command row owns the
  // control that switches it.
  editMode: "table" | "json";
}

export type TabModel = CompilerTab | TaskTab | DefinitionTab | AppFormTab | ScriptTab | VariablesTab;

let sequence = 0;

function nextTab(type: string, preview: boolean): TabBase {
  sequence++;
  return { id: `${type}-${sequence}`, seq: sequence, preview };
}

function createModel(id: string, code: string): monaco.editor.ITextModel {
  return monaco.editor.createModel(code, "typescript", monaco.Uri.parse("ts:/" + id + ".ts"));
}

// --- Visiting, keeping, closing ---

// Bringing a tab to the front is the only way one becomes current.
export function activateTab(tabs: TabModel[], id: string): TabModel[] {
  const index = tabs.findIndex((tab) => tab.id === id);
  if (index <= 0) return tabs;
  return [tabs[index], ...tabs.slice(0, index), ...tabs.slice(index + 1)];
}

// A preview open takes the one preview slot with it; a permanent open leaves
// whatever was in it alone.
function open(tabs: TabModel[], tab: TabModel): TabModel[] {
  return [tab, ...(tab.preview ? tabs.filter((other) => !other.preview) : tabs)];
}

export function keepTab(tabs: TabModel[], id: string): TabModel[] {
  const index = tabs.findIndex((tab) => tab.id === id);
  if (index === -1 || !tabs[index].preview) return tabs;
  return tabs.map((tab, i) => (i === index ? { ...tab, preview: false } : tab));
}

export function closeTab(tabs: TabModel[], id: string): TabModel[] {
  return tabs.filter((tab) => tab.id !== id);
}

function update<T extends TabModel>(tabs: TabModel[], id: string, type: T["type"], changes: Partial<T>): TabModel[] {
  return tabs.map((tab) => (tab.id === id && tab.type === type ? ({ ...tab, ...changes } as TabModel) : tab));
}

// --- Opening ---

export function openTaskTab(tabs: TabModel[], method: Method, service: Service, app: App, permanent = false): TabModel[] {
  const code = generateMethodEditorCode(app, service, method);
  const existing = tabs.find((tab) => tab.type === "task" && tab.originalCode === code);
  if (existing) {
    return activateTab(permanent ? keepTab(tabs, existing.id) : tabs, existing.id);
  }

  const tab = nextTab("task", !permanent);
  return open(tabs, {
    ...tab,
    type: "task",
    originMethod: method,
    originService: service,
    originApp: app,
    model: createModel(tab.id, code),
    originalCode: code,
  });
}

export function openScriptTab(tabs: TabModel[], script: Script, content: string, permanent = false): TabModel[] {
  const existing = tabs.find((tab) => tab.type === "script" && tab.script.path === script.path);
  if (existing?.type === "script") {
    // Refresh contents in case the file changed on disk.
    existing.model.setValue(content);
    existing.script = script;
    return activateTab(permanent ? keepTab([...tabs], existing.id) : [...tabs], existing.id);
  }

  const tab = nextTab("script", !permanent);
  return open(tabs, { ...tab, type: "script", script, model: createModel(tab.id, content) });
}

// A definition is always a look, never a document you work in, so it is only
// ever a preview.
export function openDefinitionTab(tabs: TabModel[], model: monaco.editor.ITextModel, startLineNumber: number, startColumn: number): TabModel[] {
  return open(tabs, { ...nextTab("definition", true), type: "definition", model, startLineNumber, startColumn });
}

// The app's own tab wins if it is already open; otherwise this is a preview
// open, so browsing settings never stacks tabs.
export function openAppFormTab(tabs: TabModel[], mode: "create" | "edit", initialData?: ConfigurationApp): TabModel[] {
  const existing = tabs.find((tab) => tab.type === "appForm" && tab.mode === mode && tab.editingAppName === initialData?.name);
  if (existing) {
    return activateTab(tabs, existing.id);
  }

  return open(tabs, {
    ...nextTab("appForm", true),
    type: "appForm",
    mode,
    editingAppName: initialData?.name,
    initialData,
    editMode: "form",
  });
}

export function openVariablesTab(tabs: TabModel[]): TabModel[] {
  const existing = tabs.find((tab) => tab.type === "variables");
  if (existing) return activateTab(tabs, existing.id);
  return open(tabs, { ...nextTab("variables", false), type: "variables", editMode: "table" });
}

export function openCompilerTab(tabs: TabModel[]): TabModel[] {
  const existing = tabs.find((tab) => tab.type === "compiler");
  if (existing) return activateTab(tabs, existing.id);
  return open(tabs, { ...nextTab("compiler", false), type: "compiler" });
}

export function setAppFormEditMode(tabs: TabModel[], id: string, editMode: "form" | "json"): TabModel[] {
  return update<AppFormTab>(tabs, id, "appForm", { editMode });
}

export function setVariablesEditMode(tabs: TabModel[], id: string, editMode: "table" | "json"): TabModel[] {
  return update<VariablesTab>(tabs, id, "variables", { editMode });
}

// --- What a tab is called ---

export interface TabIdentity {
  name: string;
  // Where the file sits, for the switcher's list: "benchling / Folders".
  path: string;
  // The qualifier the trigger carries beside the name, empty where the name is
  // already the whole answer.
  origin: string;
  icon: LucideIcon;
}

export function tabIdentity(tab: TabModel): TabIdentity {
  switch (tab.type) {
    case "task":
      return {
        name: tab.originMethod.name,
        path: `${tab.originApp.configuration.name} / ${tab.originService.name}`,
        origin: tab.originApp.configuration.name,
        icon: FileCode,
      };
    case "script":
      return { name: tab.script.name, path: "Scripts", origin: "", icon: FileCode };
    case "definition":
      return { name: fileName(tab.model.uri.path), path: "Definition", origin: "", icon: FileCode };
    case "appForm":
      return { name: appFormTabName(tab), path: "Settings", origin: "", icon: appFormTabIcon(tab) };
    case "variables":
      return { name: "Variables", path: "Workspace", origin: "", icon: Braces };
    case "compiler":
      return { name: "Compile log", path: "Output", origin: "", icon: ScrollText };
  }
}

function fileName(path: string): string {
  return path.split("/").pop() || path;
}

function appFormTabName(tab: AppFormTab): string {
  if (tab.mode === "edit" && tab.editingAppName) {
    // The tab is the app, so it is named after it.
    return tab.editingAppName;
  }
  // In create mode the type is picked in the New dialog, so name the tab for it.
  const type = tab.initialData ? appType(tab.initialData) : "";
  return type ? `New ${appTypeLabel(type)} app` : "New app";
}

// The tab wears the icon of the app it edits, the same one the sidebar shows.
function appFormTabIcon(tab: AppFormTab): LucideIcon {
  return (tab.initialData ? getAppType(appType(tab.initialData))?.icon : undefined) ?? Settings;
}

// --- Persistence ---

interface PersistedTaskTab {
  type: "task";
  preview: boolean;
  appName: string;
  serviceName: string;
  methodName: string;
  code: string;
  originalCode: string;
  viewState?: object;
}

interface PersistedCompilerTab {
  type: "compiler";
  preview: boolean;
}

interface PersistedScriptTab {
  type: "script";
  preview: boolean;
  scriptPath: string;
  scriptName: string;
  code: string;
  viewState?: object;
}

type PersistedTab = PersistedTaskTab | PersistedCompilerTab | PersistedScriptTab;

// The visit order is the order of the list, so nothing else has to be stored:
// the file that was on screen is the one that restores first.
export interface PersistedTabState {
  tabs: PersistedTab[];
}

export function serializeTabs(tabs: TabModel[], getViewState: (tabId: string) => monaco.editor.ICodeEditorViewState | null | undefined): PersistedTabState {
  const serialized: PersistedTab[] = [];

  for (const tab of tabs) {
    if (tab.type === "compiler") {
      serialized.push({ type: "compiler", preview: tab.preview });
    } else if (tab.type === "task") {
      serialized.push({
        type: "task",
        preview: tab.preview,
        appName: tab.originApp.configuration.name,
        serviceName: tab.originService.name,
        methodName: tab.originMethod.name,
        code: tab.model.getValue(),
        originalCode: tab.originalCode,
        viewState: (getViewState(tab.id) ?? tab.viewState) as object | undefined,
      });
    } else if (tab.type === "script") {
      serialized.push({
        type: "script",
        preview: tab.preview,
        scriptPath: tab.script.path,
        scriptName: tab.script.name,
        code: tab.model.getValue(),
        viewState: (getViewState(tab.id) ?? tab.viewState) as object | undefined,
      });
    }
  }

  return { tabs: serialized };
}

export function restoreTabs(state: PersistedTabState | undefined): TabModel[] {
  const tabs: TabModel[] = [];

  for (const persisted of state?.tabs ?? []) {
    if (persisted.type === "compiler") {
      tabs.push({ ...nextTab("compiler", persisted.preview), type: "compiler" });
      continue;
    }

    if (persisted.type === "script") {
      const tab = nextTab("script", persisted.preview);
      tabs.push({
        ...tab,
        type: "script",
        script: { path: persisted.scriptPath, name: persisted.scriptName },
        model: createModel(tab.id, persisted.code),
        viewState: persisted.viewState as monaco.editor.ICodeEditorViewState | undefined,
      });
      continue;
    }

    const tab = nextTab("task", persisted.preview);
    const method: Method = { name: persisted.methodName };
    const service: Service = {
      name: persisted.serviceName,
      packageName: "",
      sourcePath: "",
      clientStubModuleId: "",
      methods: [method],
    };
    const configuration = ConfigurationApp.create({ name: persisted.appName });

    tabs.push({
      ...tab,
      type: "task",
      originMethod: method,
      originService: service,
      originApp: { ...createPendingApp(configuration), services: [service] },
      model: createModel(tab.id, persisted.code),
      originalCode: persisted.originalCode,
      viewState: persisted.viewState as monaco.editor.ICodeEditorViewState | undefined,
    });
  }

  return tabs;
}

// Re-bind restored task tabs to the compiled apps by name. A task tab whose
// app/service/method no longer exists (e.g. the app was deleted while the tab
// was closed) can no longer resolve its import, so it is dropped instead of
// lingering as a stale stub. Runs only once compilation has succeeded, so a
// missing app means removed, not still-compiling.
export function linkTabsToApps(tabs: TabModel[], apps: App[]): TabModel[] {
  const kept: TabModel[] = [];

  for (const tab of tabs) {
    if (tab.type === "task") {
      const app = apps.find((candidate) => candidate.configuration.name === tab.originApp.configuration.name);
      const service = app?.services.find((s) => s.name === tab.originService.name);
      const method = service?.methods.find((m) => m.name === tab.originMethod.name);
      if (!app || !service || !method) {
        continue;
      }

      tab.originApp = app;
      tab.originService = service;
      tab.originMethod = method;
    }
    kept.push(tab);
  }

  return kept;
}
