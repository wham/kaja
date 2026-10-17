export interface PartialMessage {
    text: string;
}

export interface Container {
    partial?: PartialMessage;
    label: string;
}
