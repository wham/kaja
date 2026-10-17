import type { Any } from "./any";
import type { SourceContext } from "./source_context";

/**
 * A protocol buffer message type.
 *
 * New usages of this message as an alternative to DescriptorProto are strongly
 * discouraged. This message does not reliability preserve all information
 * necessary to model the schema and preserve semantics. Instead make use of
 * FileDescriptorSet which preserves the necessary information.
 */
export interface Type {
    /**
     * The fully qualified message name.
     */
    name: string;
    /**
     * The list of fields.
     */
    fields: Field[];
    /**
     * The list of types appearing in `oneof` definitions in this type.
     */
    oneofs: string[];
    /**
     * The protocol buffer options.
     */
    options: Option[];
    /**
     * The source context.
     */
    sourceContext?: SourceContext;
    /**
     * The source syntax.
     */
    syntax: Syntax;
    /**
     * The source edition string, only valid when syntax is SYNTAX_EDITIONS.
     */
    edition: string;
}

/**
 * A single field of a message type.
 *
 * New usages of this message as an alternative to FieldDescriptorProto are
 * strongly discouraged. This message does not reliability preserve all
 * information necessary to model the schema and preserve semantics. Instead
 * make use of FileDescriptorSet which preserves the necessary information.
 */
export interface Field {
    /**
     * The field type.
     */
    kind: Field_Kind;
    /**
     * The field cardinality.
     */
    cardinality: Field_Cardinality;
    /**
     * The field number.
     */
    number: number;
    /**
     * The field name.
     */
    name: string;
    /**
     * The field type URL, without the scheme, for message or enumeration
     * types. Example: `"type.googleapis.com/google.protobuf.Timestamp"`.
     */
    typeUrl: string;
    /**
     * The index of the field type in `Type.oneofs`, for message or enumeration
     * types. The first type has index 1; zero means the type is not in the list.
     */
    oneofIndex: number;
    /**
     * Whether to use alternative packed wire representation.
     */
    packed: boolean;
    /**
     * The protocol buffer options.
     */
    options: Option[];
    /**
     * The field JSON name.
     */
    jsonName: string;
    /**
     * The string value of the default value of this field. Proto2 syntax only.
     */
    defaultValue: string;
}

/**
 * Enum type definition.
 *
 * New usages of this message as an alternative to EnumDescriptorProto are
 * strongly discouraged. This message does not reliability preserve all
 * information necessary to model the schema and preserve semantics. Instead
 * make use of FileDescriptorSet which preserves the necessary information.
 */
export interface Enum {
    /**
     * Enum type name.
     */
    name: string;
    /**
     * Enum value definitions.
     */
    enumvalue: EnumValue[];
    /**
     * Protocol buffer options.
     */
    options: Option[];
    /**
     * The source context.
     */
    sourceContext?: SourceContext;
    /**
     * The source syntax.
     */
    syntax: Syntax;
    /**
     * The source edition string, only valid when syntax is SYNTAX_EDITIONS.
     */
    edition: string;
}

/**
 * Enum value definition.
 *
 * New usages of this message as an alternative to EnumValueDescriptorProto are
 * strongly discouraged. This message does not reliability preserve all
 * information necessary to model the schema and preserve semantics. Instead
 * make use of FileDescriptorSet which preserves the necessary information.
 */
export interface EnumValue {
    /**
     * Enum value name.
     */
    name: string;
    /**
     * Enum value number.
     */
    number: number;
    /**
     * Protocol buffer options.
     */
    options: Option[];
}

/**
 * A protocol buffer option, which can be attached to a message, field,
 * enumeration, etc.
 *
 * New usages of this message as an alternative to FileOptions, MessageOptions,
 * FieldOptions, EnumOptions, EnumValueOptions, ServiceOptions, or MethodOptions
 * are strongly discouraged.
 */
export interface Option {
    /**
     * The option's name. For protobuf built-in options (options defined in
     * descriptor.proto), this is the short name. For example, `"map_entry"`.
     * For custom options, it should be the fully-qualified name. For example,
     * `"google.api.http"`.
     */
    name: string;
    /**
     * The option's value packed in an Any message. If the value is a primitive,
     * the corresponding wrapper type defined in google/protobuf/wrappers.proto
     * should be used. If the value is an enum, it should be stored as an int32
     * value using the google.protobuf.Int32Value type.
     */
    value?: Any;
}

/**
 * Basic field types.
 */
export enum Field_Kind {
    /**
     * Field type unknown.
     */
    TYPE_UNKNOWN = 0,
    /**
     * Field type double.
     */
    TYPE_DOUBLE = 1,
    /**
     * Field type float.
     */
    TYPE_FLOAT = 2,
    /**
     * Field type int64.
     */
    TYPE_INT64 = 3,
    /**
     * Field type uint64.
     */
    TYPE_UINT64 = 4,
    /**
     * Field type int32.
     */
    TYPE_INT32 = 5,
    /**
     * Field type fixed64.
     */
    TYPE_FIXED64 = 6,
    /**
     * Field type fixed32.
     */
    TYPE_FIXED32 = 7,
    /**
     * Field type bool.
     */
    TYPE_BOOL = 8,
    /**
     * Field type string.
     */
    TYPE_STRING = 9,
    /**
     * Field type group. Proto2 syntax only, and deprecated.
     */
    TYPE_GROUP = 10,
    /**
     * Field type message.
     */
    TYPE_MESSAGE = 11,
    /**
     * Field type bytes.
     */
    TYPE_BYTES = 12,
    /**
     * Field type uint32.
     */
    TYPE_UINT32 = 13,
    /**
     * Field type enum.
     */
    TYPE_ENUM = 14,
    /**
     * Field type sfixed32.
     */
    TYPE_SFIXED32 = 15,
    /**
     * Field type sfixed64.
     */
    TYPE_SFIXED64 = 16,
    /**
     * Field type sint32.
     */
    TYPE_SINT32 = 17,
    /**
     * Field type sint64.
     */
    TYPE_SINT64 = 18,
}

/**
 * Whether a field is optional, required, or repeated.
 */
export enum Field_Cardinality {
    /**
     * For fields with unknown cardinality.
     */
    UNKNOWN = 0,
    /**
     * For optional fields.
     */
    OPTIONAL = 1,
    /**
     * For required fields. Proto2 syntax only.
     */
    REQUIRED = 2,
    /**
     * For repeated fields.
     */
    REPEATED = 3,
}

/**
 * The syntax in which a protocol buffer element is defined.
 */
export enum Syntax {
    /**
     * Syntax `proto2`.
     */
    PROTO2 = 0,
    /**
     * Syntax `proto3`.
     */
    PROTO3 = 1,
    /**
     * Syntax `editions`.
     */
    EDITIONS = 2,
}
