import { Method, Service } from "./project";
import { captureMethodInput, captureResponseType } from "./typeMemory";

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
  output?: any;
  outputTypeName?: string;
  error?: any;
  requestHeaders?: MethodCallHeaders;
  responseHeaders?: MethodCallHeaders;
  url?: string;
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
      captureMethodInput(methodCall.projectName, methodCall.service.name, methodCall.method.name, methodCall.input);
      if (methodCall.outputTypeName) {
        captureResponseType(methodCall.outputTypeName, methodCall.output);
      }
    }
    this.#onMethodCallUpdate(methodCall);
  }
}
