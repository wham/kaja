import type { Call, CallOptions, Input } from "kaja";

/**
 * Test fields that are already camelCase
 */
export interface CamelCaseFields {
    firstName: string;
    lastName: string;
    emailAddress: string;
    userId: number;
    isActive: boolean;
    fullName: string;
}

/**
 * Test mixed snake_case and camelCase
 */
export interface MixedCase {
    snakeCase: string;
    camelCase: string;
    pascalCase: string;
    sCREAMINGSNAKE: string;
    mixedWithUnderscores: string;
}

/**
 * Test edge cases in camelCase conversion
 */
export interface CamelCaseEdgeCases {
    /**
     * Numbers after underscore
     *
     * Should be field1value
     */
    field1Value: string;
    /**
     * Should be field2Value
     */
    field2Value: string;
    /**
     * Multiple consecutive underscores
     */
    fieldName: string;
    /**
     * Leading/trailing underscores
     */
    Private: string;
    trailing: string;
    /**
     * All caps with underscores
     */
    hTTPURL: string;
    aPIKEY: string;
    /**
     * Mixed case combinations
     */
    getHTTPResponseCode: string;
    uRLPath: string;
    xmlHTTPRequest: string;
    /**
     * Single character segments
     */
    aBC: string;
    x1Y2Z3: string;
}

/**
 * Test jsonName override
 */
export interface JsonNameOverride {
    weirdName: string;
    custom: string;
    overrideField: string;
}

export interface GetUserRequest {
    userId: string;
}

export interface GetUserResponse {
    userName: string;
}

export interface ListItemsRequest {
    pageSize: number;
}

export interface ListItemsResponse {
    items: string[];
}

export interface CreateOrUpdateRequest {
    id: string;
}

export interface CreateOrUpdateResponse {
    created: boolean;
}

export interface HTTPGetRequest {
    url: string;
}

export interface HTTPGetResponse {
    body: string;
}

/**
 * Test service method names
 */
export declare const CamelCaseService: {
    GetUser(input: Input<GetUserRequest>, options?: CallOptions): Call<GetUserResponse>;
    listItems(input: Input<ListItemsRequest>, options?: CallOptions): Call<ListItemsResponse>;
    CreateOrUpdate(input: Input<CreateOrUpdateRequest>, options?: CallOptions): Call<CreateOrUpdateResponse>;
    HTTPGet(input: Input<HTTPGetRequest>, options?: CallOptions): Call<HTTPGetResponse>;
};
