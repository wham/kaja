import type { Call, CallOptions, Input } from "kaja";
import type { Request, Response } from "./types";

export declare const SearchService: {
    Search(input: Input<Request>, options?: CallOptions): Call<Response>;
};
