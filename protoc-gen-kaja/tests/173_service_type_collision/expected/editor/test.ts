import type { Call, CallOptions, Input } from "kaja";

/**
 * Message with same name as runtime-rpc's ServiceType import.
 */
export interface ServiceType {
    value: string;
}

export interface Request {
    query: string;
}

export interface Response {
    result: string;
}

export declare const SearchService: {
    Search(input: Input<Request>, options?: CallOptions): Call<Response>;
};
