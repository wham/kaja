import type { Call, CallOptions, Input } from "kaja";

export interface Ping {
    text: string;
}

export interface Pong {
    reply: string;
}

export interface LogEntry {
    line: string;
}

export interface Summary {
    count: number;
}

/**
 * First service — unary only
 */
export declare const PingService: {
    DoPing(input: Input<Ping>, options?: CallOptions): Call<Pong>;
};

/**
 * Second service — has a client-streaming method
 */
export declare const LogService: {
};
