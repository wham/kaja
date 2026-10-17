import type { Call, CallOptions, Input } from "kaja";
import type { Empty } from "./google/protobuf/empty";

/**
 * Service with no methods
 */
export declare const EmptyService: {
};

/**
 * Service with one method using imported type
 */
export declare const SmallService: {
    DoSomething(input: Input<Empty>, options?: CallOptions): Call<Empty>;
};
