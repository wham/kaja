import "./monacoClipboard";
import "../../server/build/tailwind.css";
import * as monaco from "monaco-editor";
import React from "react";
import ReactDOM from "react-dom/client";

import { App } from "./App";
import { monacoTheme, surfaceColor } from "./monacoTheme";
import { resetPayloadArchive } from "./payloadArchive";
import { getPersistedValue, initializeStorage } from "./storage";
import { pruneTypeMemory } from "./typeMemory";
import { installUiLog } from "./uiLog";
import { declareZoom, DEFAULT_ZOOM } from "./zoom";

export * from "@protobuf-ts/runtime";
export * from "@protobuf-ts/runtime-rpc";

installUiLog();

initializeStorage().then(() => {
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
