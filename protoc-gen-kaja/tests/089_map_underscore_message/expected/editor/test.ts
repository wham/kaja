/**
 * Message name with underscore and a map field.
 * The error string in binaryReadMap should use "My_Container" not "My.Container".
 */
export interface My_Container {
    labels: { [key: string]: number };
}
