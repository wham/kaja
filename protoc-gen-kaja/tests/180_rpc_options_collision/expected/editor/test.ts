import type { Call, CallOptions, Input } from "kaja";

/**
 * Message with the same name as the runtime-rpc import RpcOptions.
 * This should cause a collision in the client file where both
 * the proto type and the runtime type are imported.
 */
export interface RpcOptions {
    value: string;
}

export interface Request {
    query: string;
}

export declare const TestService: {
    Search(input: Input<Request>, options?: CallOptions): Call<RpcOptions>;
};
