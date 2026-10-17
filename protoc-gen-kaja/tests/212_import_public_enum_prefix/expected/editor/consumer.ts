import type { Status } from "./base";
import type { Wrapper } from "./re_export";

export interface Consumer {
    status: Status;
    wrapper?: Wrapper;
}
