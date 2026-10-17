/**
 * Direct self-reference
 */
export interface SelfReference {
    id: string;
    child?: SelfReference;
}

/**
 * Mutual reference (A -> B -> A)
 */
export interface PersonNode {
    name: string;
    address?: AddressNode;
}

export interface AddressNode {
    street: string;
    resident?: PersonNode;
}

/**
 * Circular through repeated field
 */
export interface TreeNode {
    value: string;
    children: TreeNode[];
    parent?: TreeNode;
}

/**
 * Circular through map
 */
export interface GraphNode {
    id: string;
    neighbors: { [key: string]: GraphNode };
}

/**
 * Three-way circular (A -> B -> C -> A)
 */
export interface NodeA {
    id: string;
    next?: NodeB;
}

export interface NodeB {
    id: string;
    next?: NodeC;
}

export interface NodeC {
    id: string;
    next?: NodeA;
}

/**
 * Nested circular
 */
export interface Outer {
    inner?: Outer_Inner;
}

export interface Outer_Inner {
    value: string;
    outer?: Outer;
}

/**
 * Circular with oneof
 */
export interface OneofCircular {
    id: string;
    value: {
        oneofKind: "text";
        text: string;
    } | {
        oneofKind: "nested";
        nested: OneofCircular;
    } | {
        oneofKind: undefined;
    };
}
