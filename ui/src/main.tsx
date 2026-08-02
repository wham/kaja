import "../../server/build/tailwind.css";
import * as monaco from "monaco-editor";
import React from "react";
import ReactDOM from "react-dom/client";

import { App } from "./App";
import { monacoTheme, surfaceColor } from "./monacoTheme";
import { getPersistedValue, initializeStorage } from "./storage";
import { pruneTypeMemory } from "./typeMemory";
import { installUiLog } from "./uiLog";

export * from "@protobuf-ts/runtime";
export * from "@protobuf-ts/runtime-rpc";

installUiLog();

initializeStorage().then(() => {
  pruneTypeMemory();

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
