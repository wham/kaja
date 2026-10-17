import type { Call, CallOptions, Input } from "kaja";
import type { Result as Result$ } from "./dep/shared";

export interface Result {
    code: number;
}

export interface Request {
    query: string;
    depResult?: Result$;
}

export declare const TestService: {
    Search(input: Input<Request>, options?: CallOptions): Call<Result$>;
    Create(input: Input<Result>, options?: CallOptions): Call<Result>;
};
