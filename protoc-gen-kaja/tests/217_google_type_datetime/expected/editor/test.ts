import type { Duration } from "./google/protobuf/duration";

/**
 * Represents civil time.
 */
export interface DateTime {
    /**
     * Year of date.
     */
    year: number;
    /**
     * Month of year.
     */
    month: number;
    /**
     * Day of month.
     */
    day: number;
    /**
     * Hours of day in 24 hour format.
     */
    hours: number;
    /**
     * Minutes of hour of day.
     */
    minutes: number;
    /**
     * Seconds of minutes of the time.
     */
    seconds: number;
    /**
     * Fractions of seconds in nanoseconds.
     */
    nanos: number;
    /**
     * UTC offset or time zone.
     */
    timeOffset: {
        oneofKind: "utcOffset";
        /**
         * UTC offset.
         */
        utcOffset: Duration;
    } | {
        oneofKind: "timeZone";
        /**
         * Time zone.
         */
        timeZone: TimeZone;
    } | {
        oneofKind: undefined;
    };
}

/**
 * Represents a time zone from the IANA Time Zone Database.
 */
export interface TimeZone {
    /**
     * IANA Time Zone Database time zone.
     */
    id: string;
    /**
     * IANA Time Zone Database version number.
     */
    version: string;
}
