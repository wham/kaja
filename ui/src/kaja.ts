import { IMessageType } from "@protobuf-ts/runtime";
import { Method, Service } from "./project";
import { captureValues } from "./typeMemory";

export class Kaja {
  readonly _internal: KajaInternal;

  constructor(onMethodCallUpdate: MethodCallUpdate) {
    this._internal = new KajaInternal(onMethodCallUpdate);
  }
}

export interface MethodCallHeaders {
  [key: string]: string;
}

export interface MethodCall {
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
