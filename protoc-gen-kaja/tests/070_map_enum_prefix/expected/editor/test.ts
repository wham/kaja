export interface Test {
    statusMap: { [key: string]: Status };
}

export enum Status {
    UNKNOWN = 0,
    ACTIVE = 1,
    INACTIVE = 2,
}
