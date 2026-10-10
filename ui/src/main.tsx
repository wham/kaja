import "./monacoClipboard";
import "../../server/build/tailwind.css";
import * as monaco from "monaco-editor";
import React from "react";
import ReactDOM from "react-dom/client";

import { App } from "./App";
import { monacoTheme, surfaceColor } from "./monacoTheme";
import { resetPayloadArchive } from "./payloadArchive";
import { getPersistedValue, initializeStorage, WorkspaceStorage } from "./storage";
import { pruneTypeMemory } from "./typeMemory";
import { installUiLog } from "./uiLog";
import { preloadConfiguration } from "./useCompilation";
import { desktop, isWailsEnvironment } from "./wails";
import { declareZoom, DEFAULT_ZOOM } from "./zoom";

export * from "@protobuf-ts/runtime";
export * from "@protobuf-ts/runtime-rpc";

installUiLog();
preloadConfiguration();

async function openWorkspace(): Promise<WorkspaceStorage | undefined> {
  if (!isWailsEnvironment()) return undefined;
  try {
    const { current } = await (await desktop()).Workspaces();
    return { dir: current.dir, default: current.default };
  } catch (error) {
    console.error("Failed to read the open workspace", error);
    return undefined;
  }
}

openWorkspace()
  .then(initializeStorage)
  .then(() => {
    pruneTypeMemory();
    // The shelf holds the payloads of rows a session was holding, and this session is
    // holding none yet.
    resetPayloadArchive();

    // The zoom itself is the webview's, set by the process behind it; what is read here is
    // the one thing the layout measures against it, before the first frame draws.
    declareZoom(getPersistedValue<number>("zoom") ?? DEFAULT_ZOOM);

    const colorMode = getPersistedValue<"day" | "night">("colorMode") ?? "night";
    monaco.editor.setTheme(monacoTheme(colorMode));
    document.body.style.backgroundColor = surfaceColor(colorMode);
    document.documentElement.classList.toggle("dark", colorMode === "night");

    ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    );
  });
