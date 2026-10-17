import type { Call, CallOptions, Input } from "kaja";

export interface Request {
    id: string;
}

export interface Response {
    result: string;
}

export declare const TestService: {
    DoSomething(input: Input<Request>, options?: CallOptions): Call<Response>;
};
