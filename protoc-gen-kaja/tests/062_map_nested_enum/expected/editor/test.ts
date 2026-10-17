import type { Container_Status } from "./types";

export interface Test {
    statusMap: { [key: string]: Container_Status };
}
