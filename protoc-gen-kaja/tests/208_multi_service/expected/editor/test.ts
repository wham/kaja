import type { Call, CallOptions, Input } from "kaja";

export interface Request {
    query: string;
}

export interface Response {
    result: string;
}

export interface Item {
    name: string;
}

export declare const SearchService: {
    Search(input: Input<Request>, options?: CallOptions): Call<Response>;
};

export declare const ItemService: {
    GetItem(input: Input<Request>, options?: CallOptions): Call<Item>;
    ListItems(input: Input<Request>, options?: CallOptions): Call<Item>;
};
