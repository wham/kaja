import type { Call, CallOptions, Input } from "kaja";

export interface AlphaReq {
    query: string;
}

export interface AlphaResp {
    result: string;
}

export interface BetaReq {
    id: number;
}

export interface BetaResp {
    name: string;
}

/**
 * This service should only appear in .grpc-client.ts, NOT in .client.ts.
 */
export declare const AlphaSvc: {
    GetAlpha(input: Input<AlphaReq>, options?: CallOptions): Call<AlphaResp>;
};

/**
 * This service has default client style (GENERIC_CLIENT),
 * so it should appear in .client.ts.
 */
export declare const BetaSvc: {
    GetBeta(input: Input<BetaReq>, options?: CallOptions): Call<BetaResp>;
};
