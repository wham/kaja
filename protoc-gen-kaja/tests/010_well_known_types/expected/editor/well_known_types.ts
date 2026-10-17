import type { Timestamp } from "./google/protobuf/timestamp";

export interface Event {
    name: string;
    createdAt?: Timestamp;
    updatedAt?: Timestamp;
}

export interface Schedule {
    title: string;
    startTime?: Timestamp;
    endTime?: Timestamp;
    events: Event[];
}
