import { IMessageType } from "@protobuf-ts/runtime";
import { Method, Service } from "./apps";
import { captureValues } from "./typeMemory";

// Thrown when the user cancels a `kaja.ask(...)` prompt. The task runner
// swallows it so a cancelled prompt quietly stops the script.
export class AskCancelledError extends Error {
  constructor() {
    super("Kaja prompt cancelled");
    this.name = "AskCancelledError";
  }
}

export interface AskRequest {
  (message: string): Promise<string>;
}

export class Kaja {
  readonly _internal: KajaInternal;
  // Text passed in when a script is run from the macOS "Run Kaja Script" text
  // service. Scripts can read it as `kaja.input`.
  input?: string;
  // User-defined variables from the configuration, readable as
  // `kaja.variables.<name>`. Kept in sync with the loaded configuration.
  variables: { [key: string]: string } = {};
  // UUID helpers for scripts, e.g. `kaja.uuid.v4()`.
  readonly uuid = {
    v4(): string {
      if (typeof crypto.randomUUID === "function") {
        return crypto.randomUUID();
      }
      // crypto.randomUUID is only available in secure contexts; fall back to
      // building a v4 UUID from random bytes.
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    },
  };
  #onAsk: AskRequest;

  constructor(onMethodCallUpdate: MethodCallUpdate, onAsk: AskRequest) {
    this._internal = new KajaInternal(onMethodCallUpdate);
    this.#onAsk = onAsk;
  }

  // Pause the script and pop up a dialog asking the user for input. Resolves
  // with the submitted text; rejects (aborting the script) if the user cancels.
  ask(message: string): Promise<string> {
    return this.#onAsk(message);
  }
}

export interface MethodCallHeaders {
  [key: string]: string;
}

export interface MethodCall {
  id: string;
  appName: string;
  service: Service;
  method: Method;
  input: any;
  inputTypeName?: string;
  inputType?: IMessageType<any>;
  output?: any;
  outputTypeName?: string;
  outputType?: IMessageType<any>;
  streamOutputs?: any[];
  streamComplete?: boolean;
  error?: any;
  requestHeaders?: MethodCallHeaders;
  responseHeaders?: MethodCallHeaders;
  url?: string;
  timestamp: number;
}

export interface MethodCallUpdate {
  (methodCall: MethodCall): void;
}

class KajaInternal {
  #onMethodCallUpdate: MethodCallUpdate;

  constructor(onMethodCallUpdate: MethodCallUpdate) {
    this.#onMethodCallUpdate = onMethodCallUpdate;
  }

  methodCallUpdate(methodCall: MethodCall) {
    if (methodCall.output && !methodCall.error) {
      // Capture input values by input type
      if (methodCall.inputTypeName) {
        captureValues(methodCall.inputTypeName, methodCall.input, methodCall.inputType);
      }
      // Capture output values by output type
      if (methodCall.outputTypeName) {
        captureValues(methodCall.outputTypeName, methodCall.output, methodCall.outputType);
      }
    }
    this.#onMethodCallUpdate(methodCall);
  }
}
