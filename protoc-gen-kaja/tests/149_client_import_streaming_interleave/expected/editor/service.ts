import type { Call, CallOptions, Input } from "kaja";
import type { ItemRequest, ItemResponse } from "./item";
import type { UserRequest, UserResponse } from "./user";

/**
 * Service with methods from different files where the LAST method
 * is server-streaming. The streaming call type import should
 * appear BEFORE the non-streaming method's type imports from
 * different files (interleaved), not after them.
 */
export declare const DataService: {
    GetUser(input: Input<UserRequest>, options?: CallOptions): Call<UserResponse>;
    GetItem(input: Input<ItemRequest>, options?: CallOptions): Call<ItemResponse>;
    SearchUser(input: Input<UserRequest>, options?: CallOptions): Call<UserResponse>;
};
