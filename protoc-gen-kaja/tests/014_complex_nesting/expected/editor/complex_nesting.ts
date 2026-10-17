import type { Call, CallOptions, Input } from "kaja";

/**
 * Complex nested structures with multiple levels
 */
export interface Organization {
    id: string;
    name: string;
    departments: Organization_Department[];
    metadata?: Organization_Metadata;
}

export interface Organization_Department {
    id: string;
    name: string;
    teams: Organization_Department_Team[];
}

export interface Organization_Department_Team {
    id: string;
    name: string;
    members: Organization_Department_Team_Member[];
    settings?: Organization_Department_Team_Settings;
}

export interface Organization_Department_Team_Member {
    id: string;
    name: string;
    role: Organization_Department_Team_Member_Role;
    permissions?: Organization_Department_Team_Member_Permissions;
}

export interface Organization_Department_Team_Member_Permissions {
    canRead: boolean;
    canWrite: boolean;
    canDelete: boolean;
    resourceAccess: { [key: string]: Organization_Department_Team_Member_Permissions_AccessLevel };
}

/**
 * Team-level settings
 */
export interface Organization_Department_Team_Settings {
    notificationsEnabled: boolean;
    preferences: { [key: string]: string };
}

/**
 * Organization-level metadata
 */
export interface Organization_Metadata {
    labels: { [key: string]: string };
    tags: string[];
    owner: {
        oneofKind: "userId";
        userId: string;
    } | {
        oneofKind: "teamId";
        teamId: string;
    } | {
        oneofKind: undefined;
    };
}

export interface GetOrganizationRequest {
    id: string;
    includeDepartments: boolean;
    includeTeams: boolean;
}

export interface GetOrganizationResponse {
    organization?: Organization;
}

export interface UpdateMemberRequest {
    orgId: string;
    deptId: string;
    teamId: string;
    memberId: string;
    member?: Organization_Department_Team_Member;
}

export interface UpdateMemberResponse {
    member?: Organization_Department_Team_Member;
}

export enum Organization_Department_Team_Member_Permissions_AccessLevel {
    UNSPECIFIED = 0,
    NONE = 1,
    READ = 2,
    WRITE = 3,
    ADMIN = 4,
}

export enum Organization_Department_Team_Member_Role {
    UNSPECIFIED = 0,
    ADMIN = 1,
    DEVELOPER = 2,
    VIEWER = 3,
}

export declare const OrganizationService: {
    GetOrganization(input: Input<GetOrganizationRequest>, options?: CallOptions): Call<GetOrganizationResponse>;
    UpdateMember(input: Input<UpdateMemberRequest>, options?: CallOptions): Call<UpdateMemberResponse>;
};
