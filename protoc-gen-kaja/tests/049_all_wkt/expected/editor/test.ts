import type { Any } from "./google/protobuf/any";
import type { Duration } from "./google/protobuf/duration";
import type { Empty } from "./google/protobuf/empty";
import type { FieldMask } from "./google/protobuf/field_mask";
import type { Struct } from "./google/protobuf/struct";
import type { Timestamp } from "./google/protobuf/timestamp";
import type { DoubleValue, FloatValue, Int64Value, UInt64Value, Int32Value, UInt32Value, BoolValue, StringValue, BytesValue } from "./google/protobuf/wrappers";

export interface AllWKT {
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
