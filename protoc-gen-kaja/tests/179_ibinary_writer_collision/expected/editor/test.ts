/**
 * A message that collides with the runtime import type IBinaryWriter.
 */
export interface IBinaryWriter {
    name: string;
    level: number;
}

export interface Container {
    writer?: IBinaryWriter;
}
