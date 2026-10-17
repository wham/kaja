import type { Any } from "../google/protobuf/any";
import type { Duration } from "../google/protobuf/duration";
import type { Empty } from "../google/protobuf/empty";
import type { FieldMask } from "../google/protobuf/field_mask";
import type { Struct } from "../google/protobuf/struct";
import type { Timestamp } from "../google/protobuf/timestamp";
import type { DoubleValue, FloatValue, Int64Value, UInt64Value, Int32Value, UInt32Value, BoolValue, StringValue, BytesValue } from "../google/protobuf/wrappers";

/**
 * Message containing all 15 proto3 scalar types
 */
export interface AllScalars {
    doubleField: number;
    floatField: number;
    int32Field: number;
    int64Field: string;
    uint32Field: number;
    uint64Field: string;
    sint32Field: number;
    sint64Field: string;
    fixed32Field: number;
    fixed64Field: string;
    sfixed32Field: number;
    sfixed64Field: string;
    boolField: boolean;
    stringField: string;
    bytesField: Uint8Array;
    /**
     * Repeated bytes field
     */
    repeatedBytes: Uint8Array[];
}

/**
 * Message containing all well-known types
 */
export interface AllWellKnownTypes {
    anyField?: Any;
    durationField?: Duration;
    emptyField?: Empty;
    maskField?: FieldMask;
    structField?: Struct;
    timestampField?: Timestamp;
    doubleValue?: DoubleValue;
    floatValue?: FloatValue;
    int64Value?: Int64Value;
    uint64Value?: UInt64Value;
    int32Value?: Int32Value;
    uint32Value?: UInt32Value;
    boolValue?: BoolValue;
    stringValue?: StringValue;
    bytesValue?: BytesValue;
}

/**
 * Address with scalar types.
 * Contains location data with latitude/longitude.
 *
 * Special chars in comment: <html> & "quotes" and backslash-n \n
 */
export interface Address {
    street: string;
    city: string;
    state: string;
    zipCode: string;
    country: string;
    /**
     * trailing: latitude in degrees
     */
    latitude: number;
    /**
     * trailing: longitude in degrees
     */
    longitude: number;
    isPrimary: boolean;
}

/**
 * Metadata with various map key types
 */
export interface Metadata {
    labels: { [key: string]: string };
    counters: { [key: string]: number };
    flags: { [key: string]: boolean };
    indexedData: { [key: number]: string };
    /**
     * Bool map key
     */
    boolMap: { [key: string]: string };
    /**
     * Int64 map key
     */
    longMap: { [key: string]: string };
    /**
     * Map with message values
     */
    priceMap: { [key: string]: Money };
}

/**
 * Audit info with timestamps
 */
export interface AuditInfo {
    createdAt?: Timestamp;
    updatedAt?: Timestamp;
    createdBy: string;
    updatedBy: string;
    version: number;
}

/**
 * Money representation
 */
export interface Money {
    currency: string;
    amountCents: string;
}

/**
 * Pagination
 */
export interface PageInfo {
    page: number;
    pageSize: number;
    totalCount: number;
    hasNext: boolean;
    hasPrev: boolean;
}

/**
 * Message with reserved field numbers and names
 */
export interface ReservedExample {
    activeField: string;
    currentField: string;
}

/**
 * Deprecated: use FeatureFlags instead
 *
 * @deprecated
 */
export interface LegacyConfig {
    key: string;
    value: string;
}

/**
 * Message with deprecated fields
 */
export interface FeatureFlags {
    name: string;
    enabled: boolean;
    /**
     * Deprecated: use enabled instead
     *
     * @deprecated
     */
    active: boolean;
    description: string;
    /**
     * Deprecated: use description instead
     *
     * @deprecated
     */
    info: string;
}

/**
 * Common status enum used across services
 */
export enum Status {
    UNSPECIFIED = 0,
    ACTIVE = 1,
    INACTIVE = 2,
    PENDING = 3,
    DELETED = 4,
}

/**
 * Enum with deprecated values
 */
export enum Priority {
    UNSPECIFIED = 0,
    LOW = 1,
    MEDIUM = 2,
    HIGH = 3,
    /**
     * Deprecated: use PRIORITY_HIGH instead
     *
     * @deprecated
     */
    CRITICAL = 4,
}

/**
 * Enum with allow_alias - multiple names for the same value
 */
export enum Region {
    UNSPECIFIED = 0,
    US_EAST = 1,
    US_WEST = 2,
    EU = 3,
    EUROPE = 3,
    ASIA = 4,
    AP = 4,
}
