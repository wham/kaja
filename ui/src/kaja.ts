import { Method, Service } from "./project";

export class Kaja {
  readonly _internal: KajaInternal;

  constructor(onMethodCallUpdate: MethodCallUpdate) {
    this._internal = new KajaInternal(onMethodCallUpdate);
  }
}

export interface MethodCallHeaders {
  [key: string]: string;
}

export interface MethodCallHttp {
  method: string;
  url: string;
  status?: number;
  statusText?: string;
}

export interface MethodCall {
  service: Service;
  method: Method;
  input: any;
  output?: any;
  error?: any;
  requestHeaders?: MethodCallHeaders;
  responseHeaders?: MethodCallHeaders;
  http?: MethodCallHttp;
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
    this.#onMethodCallUpdate(methodCall);
  }
}
