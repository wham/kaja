export interface Paint {
    name: string;
    color: Color;
    size: Size;
}

export enum Color {
    UNKNOWN = 0,
    RED = 1,
    GREEN = 2,
    BLUE = 3,
}

export enum Size {
    UNKNOWN = 0,
    SMALL = 1,
    MEDIUM = 2,
    LARGE = 3,
}
