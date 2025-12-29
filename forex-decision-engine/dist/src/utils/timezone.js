/**
 * Timezone Utilities
 * Handles timezone conversions for display
 */
// ═══════════════════════════════════════════════════════════════
// COMMON TIMEZONES
// ═══════════════════════════════════════════════════════════════
export const TIMEZONES = [
    { value: 'America/New_York', label: 'Eastern Time (ET)' },
    { value: 'America/Chicago', label: 'Central Time (CT)' },
    { value: 'America/Denver', label: 'Mountain Time (MT)' },
    { value: 'America/Los_Angeles', label: 'Pacific Time (PT)' },
    { value: 'Europe/London', label: 'London (GMT/BST)' },
    { value: 'Europe/Paris', label: 'Central European (CET)' },
    { value: 'Asia/Tokyo', label: 'Tokyo (JST)' },
    { value: 'Asia/Hong_Kong', label: 'Hong Kong (HKT)' },
    { value: 'Australia/Sydney', label: 'Sydney (AEST)' },
    { value: 'UTC', label: 'UTC' },
];
// ═══════════════════════════════════════════════════════════════
// FORMATTING
// ═══════════════════════════════════════════════════════════════
/**
 * Format ISO timestamp to user's timezone
 */
export function formatTimestamp(isoString, timezone = 'UTC', options) {
    try {
        const date = new Date(isoString);
        const defaultOptions = {
            hour: '2-digit',
            minute: '2-digit',
            hour12: true,
            timeZone: timezone,
            ...options,
        };
        return new Intl.DateTimeFormat('en-US', defaultOptions).format(date);
    }
    catch {
        return isoString;
    }
}
/**
 * Format ISO timestamp with date
 */
export function formatDateTime(isoString, timezone = 'UTC') {
    try {
        const date = new Date(isoString);
        return new Intl.DateTimeFormat('en-US', {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true,
            timeZone: timezone,
        }).format(date);
    }
    catch {
        return isoString;
    }
}
/**
 * Format duration until a timestamp
 */
export function formatTimeUntil(isoString) {
    const now = Date.now();
    const target = new Date(isoString).getTime();
    const diff = target - now;
    if (diff <= 0)
        return 'Expired';
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    if (hours > 0) {
        return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
}
/**
 * Get current time in timezone
 */
export function getCurrentTime(timezone = 'UTC') {
    return formatTimestamp(new Date().toISOString(), timezone);
}
/**
 * Check if timestamp is still valid (not expired)
 */
export function isValid(validUntilIso) {
    return new Date(validUntilIso).getTime() > Date.now();
}
/**
 * Get current trading session
 */
export function getCurrentSession() {
    const now = new Date();
    const utcHour = now.getUTCHours();
    // Session times in UTC:
    // Sydney: 21:00 - 06:00
    // Tokyo: 00:00 - 09:00
    // London: 07:00 - 16:00
    // New York: 12:00 - 21:00
    if (utcHour >= 12 && utcHour < 21)
        return 'newyork';
    if (utcHour >= 7 && utcHour < 16)
        return 'london';
    if (utcHour >= 0 && utcHour < 9)
        return 'tokyo';
    if (utcHour >= 21 || utcHour < 6)
        return 'sydney';
    return 'closed';
}
/**
 * Get session overlap info
 */
export function getSessionInfo() {
    const now = new Date();
    const utcHour = now.getUTCHours();
    const current = getCurrentSession();
    let overlap = null;
    // London/NY overlap: 12:00 - 16:00 UTC
    if (utcHour >= 12 && utcHour < 16) {
        overlap = 'London/New York overlap (high liquidity)';
    }
    // Tokyo/London overlap: 07:00 - 09:00 UTC
    else if (utcHour >= 7 && utcHour < 9) {
        overlap = 'Tokyo/London overlap';
    }
    // Next session
    let nextSession = '';
    if (utcHour < 7)
        nextSession = 'London opens at 07:00 UTC';
    else if (utcHour < 12)
        nextSession = 'New York opens at 12:00 UTC';
    else if (utcHour < 21)
        nextSession = 'Sydney opens at 21:00 UTC';
    else
        nextSession = 'Tokyo opens at 00:00 UTC';
    return { current, overlap, nextSession };
}
//# sourceMappingURL=timezone.js.map