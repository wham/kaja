import type { Call, CallOptions, Input } from "kaja";
import type { Metadata, Money, PageInfo } from "../common/types";
import type { Timestamp } from "../google/protobuf/timestamp";

/**
 * Event with oneof payload including reserved name member
 */
export interface Event {
    id: string;
    userId: string;
    sessionId: string;
    type: EventType;
    timestamp?: Timestamp;
    payload: {
        oneofKind: "pageView";
        pageView: PageViewEvent;
    } | {
        oneofKind: "click";
        click: ClickEvent;
    } | {
        oneofKind: "search";
        search: SearchEvent;
    } | {
        oneofKind: "purchase";
        purchase: PurchaseEvent;
    } | {
        oneofKind: "constructor";
        /**
         * Oneof member with JS reserved name
         */
        constructor: number;
    } | {
        oneofKind: undefined;
    };
    properties: { [key: string]: string };
    metadata?: Metadata;
    /**
     * Local status vs common.Status
     */
    analyticsStatus: Status;
}

export interface PageViewEvent {
    url: string;
    referrer: string;
    durationMs: number;
}

export interface ClickEvent {
    elementId: string;
    elementType: string;
    pageUrl: string;
}

export interface SearchEvent {
    query: string;
    resultsCount: number;
    filters: string[];
}

export interface PurchaseEvent {
    orderId: string;
    total?: Money;
    productIds: string[];
}

export interface TrackEventRequest {
    event?: Event;
}

export interface TrackEventResponse {
    success: boolean;
}

/**
 * Streaming request for real-time event feed
 */
export interface StreamEventsRequest {
    userId: string;
    types: EventType[];
}

/**
 * Request for batch event ingestion
 */
export interface BatchEvent {
    event?: Event;
    source: string;
}

/**
 * Response for batch event ingestion
 */
export interface BatchEventResponse {
    processedCount: number;
    failedCount: number;
}

export interface GetEventsRequest {
    userId: string;
    type: EventType;
    startTime?: Timestamp;
    endTime?: Timestamp;
    page?: PageInfo;
}

export interface GetEventsResponse {
    events: Event[];
    page?: PageInfo;
}

/**
 * Event type enum with reserved values
 */
export enum EventType {
    UNSPECIFIED = 0,
    PAGE_VIEW = 1,
    CLICK = 2,
    SEARCH = 3,
    PURCHASE = 4,
    ADD_TO_CART = 5,
}

/**
 * Same-name type as common.Status to test cross-package name collision
 */
export enum Status {
    ANALYTICS_STATUS_UNSPECIFIED = 0,
    ANALYTICS_STATUS_PROCESSED = 1,
    ANALYTICS_STATUS_FAILED = 2,
}

/**
 * Analytics service with all 4 streaming types
 */
export declare const AnalyticsService: {
    /**
     * Unary
     */
    TrackEvent(input: Input<TrackEventRequest>, options?: CallOptions): Call<TrackEventResponse>;
    /**
     * Unary
     */
    GetEvents(input: Input<GetEventsRequest>, options?: CallOptions): Call<GetEventsResponse>;
    /**
     * Server-streaming
     */
    StreamEvents(input: Input<StreamEventsRequest>, options?: CallOptions): Call<Event>;
};

/**
 * Empty service with no methods
 */
export declare const DebugService: {
};
