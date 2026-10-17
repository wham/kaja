import type { Call, CallOptions, Input } from "kaja";
import type { Item } from "./sub/types";

/**
 * Request for ListItems.
 */
export interface ListItemsRequest {
    filter: string;
}

/**
 * Response for ListItems.
 */
export interface ListItemsResponse {
    items: Item[];
}

/**
 * The inventory service.
 */
export declare const InventoryService: {
    /**
     * Lists all items.
     */
    ListItems(input: Input<ListItemsRequest>, options?: CallOptions): Call<ListItemsResponse>;
};
