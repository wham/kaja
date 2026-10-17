export interface Values {
    /**
     * Repeated int64 with JS_NUMBER jstype
     */
    numbers: number[];
    /**
     * Repeated int64 with JS_STRING jstype
     */
    ids: string[];
    /**
     * Repeated int64 without jstype (should use global long_type)
     */
    defaultLongs: string[];
}
