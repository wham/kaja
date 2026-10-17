export interface SecretDocument {
    title: string;
    content: string;
}

export enum Visibility {
    PUBLIC = 0,
    PRIVATE = 1,
    INTERNAL = 2,
}
