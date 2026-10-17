import type { Call, CallOptions, Input } from "kaja";

export interface SearchRequest {
    query: string;
    page: number;
    pageSize: number;
}

export interface SearchResponse {
    results: Result[];
    totalCount: number;
}

export interface Result {
    title: string;
    url: string;
    snippet: string;
}

export interface GetRequest {
    id: string;
}

export interface GetResponse {
    result?: Result;
}

export declare const SearchService: {
    Search(input: Input<SearchRequest>, options?: CallOptions): Call<SearchResponse>;
    Get(input: Input<GetRequest>, options?: CallOptions): Call<GetResponse>;
};
