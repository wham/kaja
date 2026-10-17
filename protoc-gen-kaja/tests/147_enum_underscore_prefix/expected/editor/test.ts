export interface Container {
    status: _Foo;
}

/**
 * Enum with a leading underscore in the name.
 * The prefix detection algorithm should produce "_FOO_" as the shared prefix.
 */
export enum _Foo {
    UNSPECIFIED = 0,
    BAR = 1,
    BAZ = 2,
}
