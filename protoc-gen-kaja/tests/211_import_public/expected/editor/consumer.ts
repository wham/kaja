import type { Base } from "./base";
import type { Wrapper } from "./re_export";

export interface Consumer {
    base?: Base;
    wrapper?: Wrapper;
}
