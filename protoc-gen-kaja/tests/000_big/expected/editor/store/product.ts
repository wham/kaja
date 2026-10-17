import type { Call, CallOptions, Input } from "kaja";
import type { Money, Status, Metadata, AuditInfo, PageInfo } from "../common/types";

/**
 * Product with nested variants
 */
export interface Product {
    id: string;
    name: string;
    description: string;
    category: Category;
    price?: Money;
    tags: string[];
    imageUrls: string[];
    status: Status;
    variants: Product_Variant[];
    metadata?: Metadata;
    audit?: AuditInfo;
    /**
     * jstype JS_STRING on int64 field
     */
    viewCount: string;
    /**
     * jstype JS_NUMBER on uint64 field
     */
    serialNumber: number;
    /**
     * json_name with special characters
     */
    internalCode: string;
    /**
     * TypeScript keywords as field names
     */
    const: string;
    class: string;
    typeof: string;
    delete: string;
}

/**
 * Nested variant message (also see top-level Product_Variant)
 */
export interface Product_Variant {
    id: string;
    name: string;
    attributes: { [key: string]: string };
    price?: Money;
    stockQuantity: number;
    sku: string;
}

/**
 * Top-level message that collides with Product.Variant in generated code
 */
export interface Product_Variant$1 {
    variantId: string;
    productId: string;
    label: string;
}

/**
 * Review with nested rating breakdown
 */
export interface Review {
    id: string;
    productId: string;
    userId: string;
    rating: number;
    title: string;
    comment: string;
    imageUrls: string[];
    verifiedPurchase: boolean;
    helpfulCount: number;
    breakdown?: Review_RatingBreakdown;
    audit?: AuditInfo;
}

export interface Review_RatingBreakdown {
    quality: number;
    value: number;
    accuracy: number;
}

export interface CreateProductRequest {
    name: string;
    description: string;
    category: Category;
    price?: Money;
    tags: string[];
}

export interface CreateProductResponse {
    product?: Product;
}

export interface ListProductsRequest {
    category: Category;
    tags: string[];
    page?: PageInfo;
}

export interface ListProductsResponse {
    products: Product[];
    page?: PageInfo;
}

export interface GetProductRequest {
    id: string;
}

export interface GetProductResponse {
    product?: Product;
    reviews: Review[];
}

/**
 * Product category enum
 */
export enum Category {
    UNSPECIFIED = 0,
    ELECTRONICS = 1,
    CLOTHING = 2,
    BOOKS = 3,
    HOME = 4,
    SPORTS = 5,
}

/**
 * Product service
 */
export declare const ProductService: {
    CreateProduct(input: Input<CreateProductRequest>, options?: CallOptions): Call<CreateProductResponse>;
    GetProduct(input: Input<GetProductRequest>, options?: CallOptions): Call<GetProductResponse>;
    ListProducts(input: Input<ListProductsRequest>, options?: CallOptions): Call<ListProductsResponse>;
    /**
     * Deprecated method
     *
     * @deprecated
     */
    LegacySearch(input: Input<ListProductsRequest>, options?: CallOptions): Call<ListProductsResponse>;
};
