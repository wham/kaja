import type { Call, CallOptions, Input } from "kaja";

/**
 * User management messages
 */
export interface User {
    id: string;
    name: string;
    email: string;
    role: UserRole;
}

export interface CreateUserRequest {
    name: string;
    email: string;
}

export interface CreateUserResponse {
    user?: User;
}

export interface GetUserRequest {
    id: string;
}

export interface GetUserResponse {
    user?: User;
}

/**
 * Product management messages
 */
export interface Product {
    id: string;
    name: string;
    price: number;
    quantity: number;
}

export interface CreateProductRequest {
    name: string;
    price: number;
    quantity: number;
}

export interface CreateProductResponse {
    product?: Product;
}

export interface ListProductsRequest {
    pageSize: number;
    pageToken: string;
}

export interface ListProductsResponse {
    products: Product[];
    nextPageToken: string;
}

/**
 * Order management messages
 */
export interface Order {
    id: string;
    userId: string;
    items: OrderItem[];
    total: number;
}

export interface OrderItem {
    productId: string;
    quantity: number;
    price: number;
}

export interface CreateOrderRequest {
    userId: string;
    items: OrderItem[];
}

export interface CreateOrderResponse {
    order?: Order;
}

export enum UserRole {
    UNSPECIFIED = 0,
    ADMIN = 1,
    USER = 2,
    GUEST = 3,
}

/**
 * Multiple services in one file
 */
export declare const UserService: {
    CreateUser(input: Input<CreateUserRequest>, options?: CallOptions): Call<CreateUserResponse>;
    GetUser(input: Input<GetUserRequest>, options?: CallOptions): Call<GetUserResponse>;
};

export declare const ProductService: {
    CreateProduct(input: Input<CreateProductRequest>, options?: CallOptions): Call<CreateProductResponse>;
    ListProducts(input: Input<ListProductsRequest>, options?: CallOptions): Call<ListProductsResponse>;
};

export declare const OrderService: {
    CreateOrder(input: Input<CreateOrderRequest>, options?: CallOptions): Call<CreateOrderResponse>;
};
