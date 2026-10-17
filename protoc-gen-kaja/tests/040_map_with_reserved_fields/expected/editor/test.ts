export interface Value {
    constructor: string;
    Proto: number;
}

export interface Container {
    items: { [key: string]: Value };
    indexed: { [key: number]: Value };
}
