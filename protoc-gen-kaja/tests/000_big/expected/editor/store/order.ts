import type { Call, CallOptions, Input } from "kaja";
import type { Money, AuditInfo, Address } from "../common/types";
import type { Timestamp } from "../google/protobuf/timestamp";
import type { Product } from "./product";

/**
 * Order with 4-level deep nesting
 */
export interface Order {
    id: string;
    userId: string;
    status: OrderStatus;
    items: Order_LineItem[];
    subtotal?: Money;
    tax?: Money;
    shipping?: Money;
    total?: Money;
    shippingInfo?: Order_ShippingInfo;
    payment?: Order_PaymentInfo;
    audit?: AuditInfo;
    fulfillments: Order_Fulfillment[];
    /**
     * Multiple oneofs in one message
     */
    paymentSource: {
        oneofKind: "creditCardId";
        creditCardId: string;
    } | {
        oneofKind: "bankAccountId";
        bankAccountId: string;
    } | {
        oneofKind: "walletId";
        walletId: string;
    } | {
        oneofKind: undefined;
    };
    discount: {
        oneofKind: "couponCode";
        couponCode: string;
    } | {
        oneofKind: "loyaltyPoints";
        loyaltyPoints: number;
    } | {
        oneofKind: "percentageOff";
        percentageOff: number;
    } | {
        oneofKind: undefined;
    };
    /**
     * Proto3 optional fields
     */
    notes?: string;
    giftWrap?: boolean;
    priorityLevel?: number;
    /**
     * Bool map key
     */
    flags: { [key: string]: string };
    /**
     * Field named oneof_kind (discriminator collision)
     */
    oneofKind$: string;
}

export interface Order_LineItem {
    productId: string;
    variantId: string;
    quantity: number;
    unitPrice?: Money;
    totalPrice?: Money;
    product?: Product;
}

export interface Order_ShippingInfo {
    address?: Address;
    carrier: string;
    trackingNumber: string;
    estimatedDelivery?: Timestamp;
}

export interface Order_PaymentInfo {
    method: PaymentMethod;
    transactionId: string;
    amount?: Money;
    processedAt?: Timestamp;
}

/**
 * 4-level deep nesting: Order > Fulfillment > Tracking > Checkpoint
 */
export interface Order_Fulfillment {
    fulfillmentId: string;
    items: Order_LineItem[];
    tracking?: Order_Fulfillment_Tracking;
    shippedAt?: Timestamp;
}

export interface Order_Fulfillment_Tracking {
    carrier: string;
    trackingNumber: string;
    checkpoints: Order_Fulfillment_Tracking_Checkpoint[];
    latest?: Order_Fulfillment_Tracking_Checkpoint;
}

export interface Order_Fulfillment_Tracking_Checkpoint {
    location: string;
    status: string;
    timestamp?: Timestamp;
    description: string;
}

/**
 * Self-referential message
 */
export interface OrderGroup {
    id: string;
    name: string;
    children: OrderGroup[];
    orders: Order[];
}

export interface CreateOrderRequest {
    userId: string;
    items: CreateOrderRequest_Item[];
    shippingAddress?: Address;
    paymentMethod: PaymentMethod;
}

export interface CreateOrderRequest_Item {
    productId: string;
    variantId: string;
    quantity: number;
}

export interface CreateOrderResponse {
    order?: Order;
}

export interface GetOrderRequest {
    id: string;
}

export interface GetOrderResponse {
    order?: Order;
}

export interface UpdateOrderStatusRequest {
    id: string;
    status: OrderStatus;
}

export interface UpdateOrderStatusResponse {
    order?: Order;
}

/**
 * Order status enum
 */
export enum OrderStatus {
    UNSPECIFIED = 0,
    PENDING = 1,
    CONFIRMED = 2,
    SHIPPED = 3,
    DELIVERED = 4,
    CANCELLED = 5,
    REFUNDED = 6,
}

/**
 * Payment method with allow_alias
 */
export enum PaymentMethod {
    UNSPECIFIED = 0,
    CREDIT_CARD = 1,
    VISA = 1,
    DEBIT_CARD = 2,
    PAYPAL = 3,
    CRYPTO = 4,
    BITCOIN = 4,
}

/**
 * Order service
 */
export declare const OrderService: {
    CreateOrder(input: Input<CreateOrderRequest>, options?: CallOptions): Call<CreateOrderResponse>;
    GetOrder(input: Input<GetOrderRequest>, options?: CallOptions): Call<GetOrderResponse>;
    UpdateOrderStatus(input: Input<UpdateOrderStatusRequest>, options?: CallOptions): Call<UpdateOrderStatusResponse>;
};
