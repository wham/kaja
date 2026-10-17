import type { Call, CallOptions, Input } from "kaja";

export interface Request {
    id: string;
}

export interface Response {
    result: string;
}

/**
 * Test service with method names that clash with ServiceType interface properties
 * The TypeScript plugin escapes these because they conflict with the client class properties
 */
export declare const TestService: {
    /**
     * "methods" is a property of ServiceType interface, should be escaped to "methods$"
     */
    methods(input: Input<Request>, options?: CallOptions): Call<Response>;
    /**
     * "typeName" is a property of ServiceType interface, should be escaped to "typeName$"
     */
    typeName(input: Input<Request>, options?: CallOptions): Call<Response>;
    /**
     * "name" is a property of the client class, should be escaped to "name$"
     */
    name(input: Input<Request>, options?: CallOptions): Call<Response>;
    /**
     * "constructor" is a reserved JavaScript class property, should be escaped to "constructor$"
     */
    constructor(input: Input<Request>, options?: CallOptions): Call<Response>;
    /**
     * Normal method for comparison
     */
    getData(input: Input<Request>, options?: CallOptions): Call<Response>;
};
