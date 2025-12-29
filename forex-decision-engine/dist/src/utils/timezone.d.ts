/**
 * Timezone Utilities
 * Handles timezone conversions for display
 */
export declare const TIMEZONES: readonly [{
    readonly value: "America/New_York";
    readonly label: "Eastern Time (ET)";
}, {
    readonly value: "America/Chicago";
    readonly label: "Central Time (CT)";
}, {
    readonly value: "America/Denver";
    readonly label: "Mountain Time (MT)";
}, {
    readonly value: "America/Los_Angeles";
    readonly label: "Pacific Time (PT)";
}, {
    readonly value: "Europe/London";
    readonly label: "London (GMT/BST)";
}, {
    readonly value: "Europe/Paris";
    readonly label: "Central European (CET)";
}, {
    readonly value: "Asia/Tokyo";
    readonly label: "Tokyo (JST)";
}, {
    readonly value: "Asia/Hong_Kong";
    readonly label: "Hong Kong (HKT)";
}, {
    readonly value: "Australia/Sydney";
    readonly label: "Sydney (AEST)";
}, {
    readonly value: "UTC";
    readonly label: "UTC";
}];
export type TimezoneValue = typeof TIMEZONES[number]['value'];
/**
 * Format ISO timestamp to user's timezone
 */
export declare function formatTimestamp(isoString: string, timezone?: string, options?: Intl.DateTimeFormatOptions): string;
/**
 * Format ISO timestamp with date
 */
export declare function formatDateTime(isoString: string, timezone?: string): string;
/**
 * Format duration until a timestamp
 */
export declare function formatTimeUntil(isoString: string): string;
/**
 * Get current time in timezone
 */
export declare function getCurrentTime(timezone?: string): string;
/**
 * Check if timestamp is still valid (not expired)
 */
export declare function isValid(validUntilIso: string): boolean;
export type TradingSession = 'sydney' | 'tokyo' | 'london' | 'newyork' | 'closed';
/**
 * Get current trading session
 */
export declare function getCurrentSession(): TradingSession;
/**
 * Get session overlap info
 */
export declare function getSessionInfo(): {
    current: TradingSession;
    overlap: string | null;
    nextSession: string;
};
