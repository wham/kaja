import "../../../server/build/tailwind.css";
import React from "react";
import ReactDOM from "react-dom/client";

import { loadBundle } from "./bundle";
import { Player } from "./Player";

// The stub is built with @protobuf-ts left external and reaches them through the
// import map in player.html, exactly as kaja's own generated code does.
export * from "@protobuf-ts/runtime";
export * from "@protobuf-ts/runtime-rpc";

// An exported app is one screen with one document on it, so it follows the
// system rather than carrying a theme switch of its own.
const dark = window.matchMedia("(prefers-color-scheme: dark)");
const applyColorMode = () => document.documentElement.classList.toggle("dark", dark.matches);
applyColorMode();
dark.addEventListener("change", applyColorMode);

const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);

loadBundle().then(
  (bundle) => {
    document.title = bundle.state.manifest.title ?? bundle.state.manifest.name;
    root.render(
      <React.StrictMode>
        <Player bundle={bundle} />
      </React.StrictMode>,
    );
  },
  (error: unknown) => {
    root.render(
      <div className="flex h-screen items-center justify-center bg-background p-8 text-center text-sm text-destructive">
        {error instanceof Error ? error.message : String(error)}
      </div>,
    );
  },
);
