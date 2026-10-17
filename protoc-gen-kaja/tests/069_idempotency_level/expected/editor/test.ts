import type { Call, CallOptions, Input } from "kaja";

export interface GetRequest {
    id: string;
}

export interface GetResponse {
    data: string;
}

export interface UpdateRequest {
    id: string;
    data: string;
}

export interface UpdateResponse {
    success: boolean;
}

export declare const IdempotentService: {
    /**
     * Method with NO_SIDE_EFFECTS idempotency level
     */
    Get(input: Input<GetRequest>, options?: CallOptions): Call<GetResponse>;
    /**
     * Method with IDEMPOTENT idempotency level
     */
    Update(input: Input<UpdateRequest>, options?: CallOptions): Call<UpdateResponse>;
    /**
     * Method with default (IDEMPOTENCY_UNKNOWN) - should not have idempotency field
     */
    Delete(input: Input<GetRequest>, options?: CallOptions): Call<UpdateResponse>;
};
