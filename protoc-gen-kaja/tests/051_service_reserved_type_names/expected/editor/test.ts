import type { Call, CallOptions, Input } from "kaja";

export interface Request {}

export interface Response {}

/**
 * Service names that are reserved TypeScript type names should be escaped
 */
export declare const Array$: {
    Get(input: Input<Request>, options?: CallOptions): Call<Response>;
};

export declare const String$: {
    Set(input: Input<Request>, options?: CallOptions): Call<Response>;
};

export declare const Object: {
    Create(input: Input<Request>, options?: CallOptions): Call<Response>;
};
