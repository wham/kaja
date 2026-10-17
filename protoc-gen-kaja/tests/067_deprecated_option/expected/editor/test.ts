import type { Call, CallOptions, Input } from "kaja";

/**
 * Test deprecated message
 *
 * @deprecated
 */
export interface OldMessage {
    data: string;
}

/**
 * Test message with deprecated fields
 */
export interface UserProfile {
    name: string;
    /**
     * This field is deprecated
     *
     * @deprecated
     */
    oldEmail: string;
    currentEmail: string;
    /**
     * @deprecated
     */
    age: number;
}

/**
 * Test nested message with deprecated field
 */
export interface Container {
    /**
     * @deprecated
     */
    oldNested?: Container_NestedOld;
    nested?: Container_Nested;
}

/**
 * @deprecated
 */
export interface Container_NestedOld {
    value: string;
}

export interface Container_Nested {
    name: string;
    /**
     * @deprecated
     */
    oldCount: number;
}

/**
 * Test deprecated enum
 *
 * @deprecated
 */
export enum OldStatus {
    UNSPECIFIED = 0,
    ACTIVE = 1,
    INACTIVE = 2,
}

/**
 * Test enum with deprecated values
 */
export enum Status {
    UNSPECIFIED = 0,
    ACTIVE = 1,
    /**
     * @deprecated
     */
    DEPRECATED_VALUE = 2,
    INACTIVE = 3,
}

/**
 * Test deprecated service
 *
 * @deprecated
 */
export declare const OldService: {
    GetData(input: Input<OldMessage>, options?: CallOptions): Call<OldMessage>;
};

/**
 * Test service with deprecated method
 */
export declare const UserService: {
    GetUser(input: Input<UserProfile>, options?: CallOptions): Call<UserProfile>;
    /**
     * @deprecated
     */
    LegacyGetUser(input: Input<UserProfile>, options?: CallOptions): Call<UserProfile>;
    UpdateUser(input: Input<UserProfile>, options?: CallOptions): Call<UserProfile>;
};
