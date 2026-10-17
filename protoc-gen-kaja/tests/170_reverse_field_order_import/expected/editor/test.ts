import type { Beta, Alpha } from "./dep";

/**
 * Fields declared in reverse field-number order.
 * Beta is field 2 (declared first), Alpha is field 1 (declared second).
 */
export interface Container {
    b?: Beta;
    a?: Alpha;
}
