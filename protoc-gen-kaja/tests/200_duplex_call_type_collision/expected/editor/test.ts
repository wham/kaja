import type { Call, CallOptions, Input } from "kaja";

/**
 * A message named DuplexStreamingCall which collides with the runtime-rpc type.
 * Since the service has a duplex streaming method, DuplexStreamingCall is
 * actually imported from @protobuf-ts/runtime-rpc, causing a real collision.
 * The TS plugin aliases the runtime-rpc import; the Go plugin aliases the
 * proto import instead.
 */
export interface DuplexStreamingCall {
    data: string;
}

export interface Response {
    result: string;
}

export declare const TestService: {
    Process(input: Input<DuplexStreamingCall>, options?: CallOptions): Call<Response>;
};
