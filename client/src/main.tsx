import React from "react";
import ReactDOM from "react-dom/client";

import { App } from "./App";

export * from "@protobuf-ts/runtime";
export * from "@protobuf-ts/runtime-rpc";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
