import type { Event } from "./analytics/events";
import type { UserProfile } from "./auth/user";
import type { Metadata } from "./common/types";
import type { Container } from "./internal/collision";
import type { Order } from "./store/order";
import type { Product } from "./store/product";

/**
 * Aggregated response combining data from multiple services
 */
export interface Dashboard {
    user?: UserProfile;
    featuredProducts: Product[];
    recentOrders: Order[];
    recentEvents: Event[];
    metadata?: Metadata;
    /**
     * Circular self-reference via optional
     */
    parent?: Dashboard;
    /**
     * Proto3 optional scalar fields
     */
    title?: string;
    refreshIntervalSeconds?: number;
    isPublic?: boolean;
    /**
     * Reference to internal collision types
     */
    internalData?: Container;
}

/**
 * Top-level message named Entry to coexist with map entry types
 */
export interface Entry {
    key: string;
    value: string;
}

/**
 * Settings with a map field (generates SettingsEntry internally)
 */
export interface Settings {
    properties: { [key: string]: string };
    entries: { [key: string]: Entry };
}
