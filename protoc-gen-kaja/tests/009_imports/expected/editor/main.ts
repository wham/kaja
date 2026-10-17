import type { Status, Metadata } from "./shared";

export interface Container {
    name: string;
    status: Status;
    metadata: Metadata[];
}
