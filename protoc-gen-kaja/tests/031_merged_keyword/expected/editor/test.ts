export interface from$ {}

export interface from_of {
    /**
     * "from_of" is NOT a reserved keyword, should stay "from_of"
     */
    value: string;
}

/**
 * Top level keywords should still be escaped
 */
export interface class$ {
    data: string;
}

/**
 * Test case where parent is safe but merged name might look like keyword
 */
export interface my {}

export interface my_class {
    /**
     * "my_class" is NOT a keyword (only "class" is), should be "my_class"
     */
    value: string;
}
