import type { Call, CallOptions, Input } from "kaja";
import type { SearchRequest, SearchResponse, DeleteRequest, DeleteResponse } from "./types";

export declare const MyService: {
    Search(input: Input<SearchRequest>, options?: CallOptions): Call<SearchResponse>;
    Delete(input: Input<DeleteRequest>, options?: CallOptions): Call<DeleteResponse>;
};
