export interface Outer {
    middle?: Outer_Middle;
    status: Outer_Status;
    label: string;
}

export interface Outer_Middle {
    inner?: Outer_Middle_Inner;
    name: string;
}

export interface Outer_Middle_Inner {
    value: string;
}

export enum Outer_Status {
    UNKNOWN = 0,
    ACTIVE = 1,
    INACTIVE = 2,
}
