import type { Item } from "./a";
import type { Item as Item$ } from "./b";
import type { Item as Item$2 } from "./c";

export interface Container {
    aItem?: Item;
    bItem?: Item$;
    cItem?: Item$2;
}
