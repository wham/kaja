import type { Call, CallOptions, Input } from "kaja";

export interface GetUserRequest {
    userId: string;
}

export interface GetUserResponse {
    name: string;
    email: string;
}

export interface DeleteUserRequest {
    userId: string;
}

export interface DeleteUserResponse {
    success: boolean;
}

export declare const UserService: {
    /**
     * Method using imported custom options
     */
    GetUser(input: Input<GetUserRequest>, options?: CallOptions): Call<GetUserResponse>;
    /**
     * Method with only some imported options
     */
    DeleteUser(input: Input<DeleteUserRequest>, options?: CallOptions): Call<DeleteUserResponse>;
};
