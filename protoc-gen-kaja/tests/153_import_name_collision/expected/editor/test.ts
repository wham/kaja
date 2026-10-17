import type { Item as Item$ } from "./common";

export interface Item {
    name: string;
}

export interface Container {
    localItem?: Item;
    remoteItem?: Item$;
}
