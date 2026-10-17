import type { Call, CallOptions, Input } from "kaja";

export interface TestMessage {
    value: string;
}

export declare const TestService: {
    GetTest(input: Input<TestMessage>, options?: CallOptions): Call<TestMessage>;
};
