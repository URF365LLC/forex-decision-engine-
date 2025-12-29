/**
 * Validation Utilities
 * Input validation for user settings
 */
export interface ValidationResult {
    valid: boolean;
    errors: string[];
    sanitized?: unknown;
}
/**
 * Validate account size
 */
export declare function validateAccountSize(value: unknown): ValidationResult;
/**
 * Validate risk percentage
 */
export declare function validateRiskPercent(value: unknown): ValidationResult;
/**
 * Validate trading style
 */
export declare function validateStyle(value: unknown): ValidationResult;
/**
 * Validate symbol
 */
export declare function validateSymbol(value: unknown): ValidationResult;
/**
 * Validate array of symbols
 */
export declare function validateSymbols(values: unknown): ValidationResult;
/**
 * Validate complete user settings
 */
export declare function validateSettings(settings: unknown): ValidationResult;
/**
 * Sanitize symbol input
 */
export declare function sanitizeSymbol(input: string): string;
/**
 * Clamp a number to a range
 */
export declare function clamp(value: number, min: number, max: number): number;
