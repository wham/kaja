import "../build/tailwind.css";
import * as monaco from "monaco-editor";
import React from "react";
import ReactDOM from "react-dom/client";

import { App } from "./App";
import { getPersistedValue, initializeStorage } from "./storage";
import { installUiLog } from "./uiLog";

export * from "@protobuf-ts/runtime";
export * from "@protobuf-ts/runtime-rpc";

installUiLog();

initializeStorage().then(() => {
  const colorMode = getPersistedValue<"day" | "night">("colorMode") ?? "night";
  monaco.editor.setTheme(colorMode === "night" ? "vs-dark" : "vs");
  document.body.style.backgroundColor = colorMode === "night" ? "#0d1117" : "#ffffff";
  document.documentElement.classList.toggle("dark", colorMode === "night");

  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
});
