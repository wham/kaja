export interface TestMessage {
    status: MyEnum_;
}

/**
 * Enum with a trailing underscore in the name.
 * The prefix detection algorithm should produce "MY_ENUM__" (double underscore)
 * because the enum name "MyEnum_" converts to "MY_ENUM_" + trailing "_" = "MY_ENUM__".
 */
export enum MyEnum_ {
    UNSPECIFIED = 0,
    FOO = 1,
    BAR = 2,
}
