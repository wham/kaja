export interface Tag {
    key: string;
    value: string;
}

export interface Collection {
    names: string[];
    scores: number[];
    flags: boolean[];
    tags: Tag[];
    data: Uint8Array[];
}
