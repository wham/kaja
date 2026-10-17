import type { Call, CallOptions, Input } from "kaja";

export interface Empty {}

export interface Request {
    query: string;
}

export declare const TestService: {
    Search(input: Input<Request>, options?: CallOptions): Call<Request>;
};
