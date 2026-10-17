import type { ApiInfo, HealthCheckResponse_Status } from "./api/v1/service";

/**
 * Test message that uses types from nested directory
 */
export interface NestedTest {
    info?: ApiInfo;
    status: HealthCheckResponse_Status;
}
