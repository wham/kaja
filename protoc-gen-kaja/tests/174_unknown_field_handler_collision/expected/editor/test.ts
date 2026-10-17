export interface UnknownFieldHandler {
    name: string;
    code: number;
}

export interface Container {
    handler?: UnknownFieldHandler;
    label: string;
}
