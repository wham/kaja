import type { Call, CallOptions, Input } from "kaja";

export interface Request {
    query: string;
}

export interface Response {
    result: string;
}

export declare const ServiceInfo: {
    Search(input: Input<Request>, options?: CallOptions): Call<Response>;
};
