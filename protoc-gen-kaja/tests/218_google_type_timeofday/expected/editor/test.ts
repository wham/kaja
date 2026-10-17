/**
 * Represents a time of day.
 */
export interface TimeOfDay {
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
}
