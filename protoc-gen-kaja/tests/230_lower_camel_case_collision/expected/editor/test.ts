/**
 * When FieldMask is present, the plugin imports lowerCamelCase from runtime.
 * A local message named lowerCamelCase should cause a collision that needs aliasing.
 */
export interface FieldMask {
    paths: string[];
}

export interface lowerCamelCase {
    value: string;
}
