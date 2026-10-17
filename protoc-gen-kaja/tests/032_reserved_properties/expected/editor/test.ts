/**
 * Test field names that are reserved object properties
 */
export interface ReservedProps {
    /**
     * __proto__ is a reserved object property
     */
    Proto: string;
    /**
     * toString is a reserved object property
     */
    toString$: number;
    /**
     * Normal field for comparison
     */
    normal: string;
}

/**
 * Test in nested message too
 */
export interface Container {
    data?: Container_Inner;
}

export interface Container_Inner {
    Proto: string;
    toString$: number;
}
