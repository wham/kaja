import type { Call, CallOptions, Input } from "kaja";
import type { Address, Metadata, AuditInfo, PageInfo } from "../common/types";

/**
 * Nested permission message
 */
export interface Permission {
    resource: string;
    actions: string[];
    scope?: Permission_Scope;
}

export interface Permission_Scope {
    type: string;
    ids: string[];
}

/**
 * User profile with nested messages
 */
export interface UserProfile {
    id: string;
    username: string;
    email: string;
    role: Role;
    address?: Address;
    permissions: Permission[];
    metadata?: Metadata;
    audit?: AuditInfo;
    preferences?: UserProfile_Preferences;
    /**
     * Field with json_name
     */
    displayName: string;
    /**
     * Reserved property name
     */
    Proto: boolean;
}

/**
 * Nested preferences
 */
export interface UserProfile_Preferences {
    language: string;
    timezone: string;
    emailNotifications: boolean;
    smsNotifications: boolean;
}

/**
 * Authentication request with oneof
 */
export interface AuthRequest {
    credentials: {
        oneofKind: "password";
        password: string;
    } | {
        oneofKind: "oauthToken";
        oauthToken: string;
    } | {
        oneofKind: "apiKey";
        apiKey: string;
    } | {
        oneofKind: undefined;
    };
    username: string;
    deviceId: string;
}

export interface AuthResponse {
    accessToken: string;
    refreshToken: string;
    profile?: UserProfile;
}

export interface CreateUserRequest {
    username: string;
    email: string;
    password: string;
    role: Role;
    address?: Address;
}

export interface CreateUserResponse {
    profile?: UserProfile;
}

export interface GetUserRequest {
    id: string;
}

export interface GetUserResponse {
    profile?: UserProfile;
}

/**
 * Request for listing users with server streaming
 */
export interface ListUsersRequest {
    role: Role;
    page?: PageInfo;
}

/**
 * Response for listing users
 */
export interface ListUsersResponse {
    profile?: UserProfile;
}

/**
 * Request for bulk creating users with client streaming
 */
export interface BulkCreateUsersRequest {
    username: string;
    email: string;
    password: string;
    role: Role;
}

/**
 * Response for bulk user creation
 */
export interface BulkCreateUsersResponse {
    createdCount: number;
    userIds: string[];
}

/**
 * Chat message for bidirectional streaming
 */
export interface UserChatMessage {
    userId: string;
    content: string;
}

export interface UpdateUserRequest {
    id: string;
    profile?: UserProfile;
}

export interface UpdateUserResponse {
    profile?: UserProfile;
}

/**
 * User role enum
 */
export enum Role {
    UNSPECIFIED = 0,
    CUSTOMER = 1,
    ADMIN = 2,
    SUPPORT = 3,
}

/**
 * Auth service with all RPC types
 */
export declare const AuthService: {
    /**
     * Unary RPC
     */
    Authenticate(input: Input<AuthRequest>, options?: CallOptions): Call<AuthResponse>;
    /**
     * Unary with custom method options
     */
    CreateUser(input: Input<CreateUserRequest>, options?: CallOptions): Call<CreateUserResponse>;
    /**
     * Unary with NO_SIDE_EFFECTS idempotency
     */
    GetUser(input: Input<GetUserRequest>, options?: CallOptions): Call<GetUserResponse>;
    /**
     * Unary with IDEMPOTENT idempotency
     */
    UpdateUser(input: Input<UpdateUserRequest>, options?: CallOptions): Call<UpdateUserResponse>;
    /**
     * Server-streaming RPC
     */
    ListUsers(input: Input<ListUsersRequest>, options?: CallOptions): Call<ListUsersResponse>;
};
