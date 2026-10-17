import type { Call, CallOptions, Input } from "kaja";

/**
 * Top-level message in a deprecated file
 *
 * @deprecated
 */
export interface DeprecatedMessage {
    name: string;
    age: number;
}

/**
 * Top-level enum in a deprecated file
 *
 * @deprecated
 */
export enum DeprecatedStatus {
    UNKNOWN = 0,
    ACTIVE = 1,
    INACTIVE = 2,
}

/**
 * Top-level service in a deprecated file
 *
 * @deprecated
 */
export declare const DeprecatedService: {
    /**
     * @deprecated
     */
    GetStatus(input: Input<DeprecatedMessage>, options?: CallOptions): Call<DeprecatedMessage>;
};
