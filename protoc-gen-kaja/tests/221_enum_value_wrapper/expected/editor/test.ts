/**
 * A message whose name ends with "Value" but is NOT a wrapper type.
 * The Go plugin incorrectly treats it as a wrapper (like Int32Value).
 */
export interface EnumValue {
    name: string;
    number: number;
}
