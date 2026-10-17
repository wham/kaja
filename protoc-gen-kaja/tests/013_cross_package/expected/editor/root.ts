import type { Address, Status } from "./common/types";
import type { UserProfile } from "./user/service";

/**
 * Test message that uses cross-package types
 */
export interface CrossPackageTest {
    profile?: UserProfile;
    address?: Address;
    status: Status;
}
