import type { Call, CallOptions, Input } from "kaja";

export interface EmptyRequest {}

export interface EmptyResponse {}

/**
 * Test that gRPC client reserved method names are properly escaped
 */
export declare const TestService: {
    /**
     * These method names collide with gRPC client methods and should be escaped
     */
    MakeUnaryRequest(input: Input<EmptyRequest>, options?: CallOptions): Call<EmptyResponse>;
    MakeClientStreamRequest(input: Input<EmptyRequest>, options?: CallOptions): Call<EmptyResponse>;
    MakeServerStreamRequest(input: Input<EmptyRequest>, options?: CallOptions): Call<EmptyResponse>;
    MakeBidiStreamRequest(input: Input<EmptyRequest>, options?: CallOptions): Call<EmptyResponse>;
    GetChannel(input: Input<EmptyRequest>, options?: CallOptions): Call<EmptyResponse>;
    WaitForReady(input: Input<EmptyRequest>, options?: CallOptions): Call<EmptyResponse>;
    /**
     * These collide with generic client properties
     */
    Methods(input: Input<EmptyRequest>, options?: CallOptions): Call<EmptyResponse>;
    TypeName(input: Input<EmptyRequest>, options?: CallOptions): Call<EmptyResponse>;
    Options(input: Input<EmptyRequest>, options?: CallOptions): Call<EmptyResponse>;
};
