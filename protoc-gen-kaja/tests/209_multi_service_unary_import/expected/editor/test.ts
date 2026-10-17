import type { Call, CallOptions, Input } from "kaja";

export interface Request {
    query: string;
}

export interface Response {
    result: string;
}

export declare const StreamService: {
    Watch(input: Input<Request>, options?: CallOptions): Call<Response>;
};

export declare const QueryService: {
    Search(input: Input<Request>, options?: CallOptions): Call<Response>;
};
