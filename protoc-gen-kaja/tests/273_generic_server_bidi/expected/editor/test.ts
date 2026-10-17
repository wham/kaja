import type { Call, CallOptions, Input } from "kaja";

export interface Alpha {
    a: string;
}

export interface Beta {
    b: string;
}

/**
 * Bidi streaming: the TS plugin's createBidi() encounters RpcOutputStream
 * (for requests param) BEFORE RpcInputStream (for responses param).
 * Since imports are prepended, RpcInputStream ends up above RpcOutputStream.
 * The Go plugin checks ss before cs in the import loop, so RpcInputStream
 * is prepended first, then RpcOutputStream goes on top — reversed order.
 */
export declare const MySvc: {
};
