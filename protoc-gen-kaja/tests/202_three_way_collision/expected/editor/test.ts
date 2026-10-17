import type { Call, CallOptions, Input } from "kaja";

/**
 * Message named after a call type
 */
export interface ServerStreamingCall {
    data: string;
}

export interface Request {
    query: string;
}

/**
 * Service that uses the message named ServerStreamingCall
 * AND also has a server streaming method (requiring the actual ServerStreamingCall type)
 */
export declare const MyService: {
    GetItems(input: Input<Request>, options?: CallOptions): Call<ServerStreamingCall>;
    SetItem(input: Input<ServerStreamingCall>, options?: CallOptions): Call<ServerStreamingCall>;
};
