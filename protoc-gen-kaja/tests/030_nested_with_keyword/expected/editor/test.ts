/**
 * Test nested message with reserved keyword name
 */
export interface Outer {
    myClass?: Outer_class;
    myConst?: Outer_const;
}

export interface Outer_class {
    value: string;
}

export interface Outer_const {
    number: number;
}

/**
 * Test referencing nested keyword types from another message
 */
export interface Another {
    importedClass?: Outer_class;
    importedConst?: Outer_const;
}

/**
 * Test multiple levels of nesting with keywords
 */
export interface Level1 {
    myInterface?: Level1_interface;
}

export interface Level1_interface {
    nested?: Level1_interface_type;
}

export interface Level1_interface_type {
    data: string;
}
