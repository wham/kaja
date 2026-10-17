/**
 * Proto2 optional fields set to their default values.
 * protobuf-ts toJson() INCLUDES these because field.opt=true → ed=true.
 * The Go plugin's isDefaultValue filters them out incorrectly.
 */
export interface OptionalOption {
    count?: number;
    label?: string;
}

export interface Bar {
    name: string;
}
