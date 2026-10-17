/**
 * A message that collides with the runtime import type IBinaryReader.
 */
export interface IBinaryReader {
    name: string;
    level: number;
}

export interface Container {
    reader?: IBinaryReader;
}
