/**
 * Test enum nested in message
 */
export interface Container {
    status: Container_Status;
    name: string;
}

/**
 * Test multiple nested enums
 */
export interface MultipleNestedEnums {
    type: MultipleNestedEnums_Type;
    priority: MultipleNestedEnums_Priority;
}

/**
 * Test deeply nested enums
 */
export interface Level1 {
    level2?: Level1_Level2;
}

export interface Level1_Level2 {
    level3?: Level1_Level2_Level3;
}

export interface Level1_Level2_Level3 {
    value: Level1_Level2_Level3_DeepEnum;
}

/**
 * Test enum in nested message used in parent
 */
export interface Parent {
    status: Parent_Child_ChildEnum;
    name: string;
}

export interface Parent_Child {}

/**
 * Test referencing nested enum from another message
 */
export interface UseNestedEnum {
    containerStatus: Container_Status;
    type: MultipleNestedEnums_Type;
    priority: MultipleNestedEnums_Priority;
    childStatus: Parent_Child_ChildEnum;
}

/**
 * Test nested enum with no prefix
 */
export interface NoPrefix {
    value: NoPrefix_Simple;
}

/**
 * Test sibling messages with same enum name
 */
export interface Sibling1 {
    status: Sibling1_Status;
}

export interface Sibling2 {
    status: Sibling2_Status;
}

export interface UseBothSiblings {
    status1: Sibling1_Status;
    status2: Sibling2_Status;
}

export enum Container_Status {
    UNKNOWN = 0,
    ACTIVE = 1,
    INACTIVE = 2,
}

export enum MultipleNestedEnums_Type {
    TYPE_UNKNOWN = 0,
    TYPE_A = 1,
    TYPE_B = 2,
}

export enum MultipleNestedEnums_Priority {
    LOW = 0,
    MEDIUM = 1,
    HIGH = 2,
}

export enum Level1_Level2_Level3_DeepEnum {
    DEEP_UNKNOWN = 0,
    DEEP_VALUE = 1,
}

export enum Parent_Child_ChildEnum {
    CHILD_UNKNOWN = 0,
    CHILD_VALUE = 1,
}

export enum NoPrefix_Simple {
    A = 0,
    B = 1,
    C = 2,
}

export enum Sibling1_Status {
    OK = 0,
    ERROR = 1,
}

export enum Sibling2_Status {
    PENDING = 0,
    DONE = 1,
}
