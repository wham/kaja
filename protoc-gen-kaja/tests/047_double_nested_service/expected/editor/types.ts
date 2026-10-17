export interface Outer {
    middle?: Outer_Middle;
}

export interface Outer_Middle {
    inner?: Outer_Middle_Inner;
}

export interface Outer_Middle_Inner {
    value: string;
}
