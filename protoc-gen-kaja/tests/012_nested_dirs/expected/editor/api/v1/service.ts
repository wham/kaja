import type { Call, CallOptions, Input } from "kaja";

/**
 * Nested directory structure with versioned API
 */
export interface ApiInfo {
    version: string;
    name: string;
}

export interface HealthCheckRequest {
    service: string;
}

export interface HealthCheckResponse {
    status: HealthCheckResponse_Status;
    info?: ApiInfo;
}

export enum HealthCheckResponse_Status {
    UNSPECIFIED = 0,
    SERVING = 1,
    NOT_SERVING = 2,
    UNKNOWN = 3,
}

export declare const HealthService: {
    Check(input: Input<HealthCheckRequest>, options?: CallOptions): Call<HealthCheckResponse>;
};
