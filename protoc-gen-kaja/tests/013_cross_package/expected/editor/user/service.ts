import type { Call, CallOptions, Input } from "kaja";
import type { Address, Status, Timestamp } from "../common/types";

/**
 * User service with cross-package imports
 */
export interface UserProfile {
    id: string;
    username: string;
    email: string;
    address?: Address;
    status: Status;
    createdAt?: Timestamp;
    updatedAt?: Timestamp;
}

export interface CreateUserRequest {
    username: string;
    email: string;
    address?: Address;
}

export interface CreateUserResponse {
    profile?: UserProfile;
}

export interface UpdateUserRequest {
    id: string;
    username: string;
    email: string;
    address?: Address;
}

export interface UpdateUserResponse {
    profile?: UserProfile;
}

export declare const UserManagementService: {
    CreateUser(input: Input<CreateUserRequest>, options?: CallOptions): Call<CreateUserResponse>;
    UpdateUser(input: Input<UpdateUserRequest>, options?: CallOptions): Call<UpdateUserResponse>;
};
