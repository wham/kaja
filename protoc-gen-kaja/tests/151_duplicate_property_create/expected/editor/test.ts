/**
 * Two fields that resolve to the same TypeScript property name "x123Y"
 * due to camelCase conversion rules.
 * The create() method should only initialize the property once.
 */
export interface DuplicateProperty {
    x123Y: string;
    x123Y: string;
}
