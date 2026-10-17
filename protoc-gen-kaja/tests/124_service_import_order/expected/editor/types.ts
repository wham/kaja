export interface SearchRequest {
    query: string;
}

export interface SearchResponse {
    result: string;
}

export interface DeleteRequest {
    id: number;
}

export interface DeleteResponse {
    success: boolean;
}
