import type { Call, CallOptions, Input } from "kaja";
import type { Pet as Pet$, GetPetRequest, Keeper as Keeper$ } from "./types";

/**
 * Named like the message it serves.
 */
export declare const Pet: {
    CreatePet(input: Input<Pet$>, options?: CallOptions): Call<Pet$>;
    GetPet(input: Input<GetPetRequest>, options?: CallOptions): Call<Pet$>;
};

export declare const Keeper: {
    GetKeeper(input: Input<GetPetRequest>, options?: CallOptions): Call<Keeper$>;
    StreamKeepers(input: Input<GetPetRequest>, options?: CallOptions): Call<Keeper$>;
};
