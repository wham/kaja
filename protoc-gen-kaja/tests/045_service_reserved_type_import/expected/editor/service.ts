import type { Call, CallOptions, Input } from "kaja";
import type { String$, Array$, Number$ } from "./types";

/**
 * Service that uses the reserved-name types from types.proto
 */
export declare const TypeService: {
    /**
     * Uses String from types.proto
     */
    GetString(input: Input<String$>, options?: CallOptions): Call<String$>;
    /**
     * Uses Array from types.proto
     */
    GetArray(input: Input<Array$>, options?: CallOptions): Call<Array$>;
    /**
     * Uses Number from types.proto
     */
    GetNumber(input: Input<Number$>, options?: CallOptions): Call<Number$>;
};
