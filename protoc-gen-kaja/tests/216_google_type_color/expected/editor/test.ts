import type { FloatValue } from "./google/protobuf/wrappers";

/**
 * Represents a color in the RGBA color space.
 */
export interface Color {
    /**
     * The amount of red in the color as a value in the interval [0, 1].
     */
    red: number;
    /**
     * The amount of green in the color as a value in the interval [0, 1].
     */
    green: number;
    /**
     * The amount of blue in the color as a value in the interval [0, 1].
     */
    blue: number;
    /**
     * The fraction of this color that should be applied to the pixel.
     */
    alpha?: FloatValue;
}
