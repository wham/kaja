export interface Value {
    data: string;
}

export interface MapContainer {
    stringMap: { [key: string]: string };
    counts: { [key: string]: number };
    index: { [key: number]: string };
    objects: { [key: string]: Value };
    flags: { [key: string]: boolean };
}
