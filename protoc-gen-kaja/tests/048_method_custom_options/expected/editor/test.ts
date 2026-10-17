import type { Call, CallOptions, Input } from "kaja";

export interface Request {
    query: string;
}

export interface Response {
    result: string;
}

export declare const TestService: {
    /**
     * Method with custom options
     */
    GetData(input: Input<Request>, options?: CallOptions): Call<Response>;
    /**
     * Method without custom options
     */
    PostData(input: Input<Request>, options?: CallOptions): Call<Response>;
    /**
     * Method with only one custom option
     */
    UpdateData(input: Input<Request>, options?: CallOptions): Call<Response>;
};
