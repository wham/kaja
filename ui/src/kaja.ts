import { IMessageType } from "@protobuf-ts/runtime";
import { Method, Service } from "./project";
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
  projectName: string;
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
