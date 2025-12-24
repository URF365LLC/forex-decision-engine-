/**
 * Validation Utilities
 * Input validation for user settings
 */

import { VALIDATION, RISK_OPTIONS } from '../config/defaults.js';
import { isValidSymbol, ALL_SYMBOLS } from '../config/universe.js';
import { TradingStyle } from '../config/strategy.js';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  sanitized?: unknown;
}

// ═══════════════════════════════════════════════════════════════
// VALIDATORS
// ═══════════════════════════════════════════════════════════════

/**
 * Validate account size
 */
export function validateAccountSize(value: unknown): ValidationResult {
  const errors: string[] = [];
  
  if (value === undefined || value === null || value === '') {
    return { valid: false, errors: ['Account size is required'] };
  }
  
  const num = Number(value);
  
  if (isNaN(num)) {
    errors.push('Account size must be a number');
  } else if (num < VALIDATION.account.min) {
    errors.push(`Account size must be at least $${VALIDATION.account.min}`);
  } else if (num > VALIDATION.account.max) {
    errors.push(`Account size cannot exceed $${VALIDATION.account.max.toLocaleString()}`);
  }
  
  return {
    valid: errors.length === 0,
    errors,
    sanitized: errors.length === 0 ? num : undefined,
  };
}

/**
 * Validate risk percentage
 */
export function validateRiskPercent(value: unknown): ValidationResult {
  const errors: string[] = [];
  
  if (value === undefined || value === null || value === '') {
    return { valid: false, errors: ['Risk percentage is required'] };
  }
  
  const num = Number(value);
  
  if (isNaN(num)) {
    errors.push('Risk percentage must be a number');
  } else if (num < VALIDATION.risk.min) {
    errors.push(`Risk must be at least ${VALIDATION.risk.min}%`);
  } else if (num > VALIDATION.risk.max) {
    errors.push(`Risk cannot exceed ${VALIDATION.risk.max}%`);
  }
  
  // Check if it's one of the allowed options (informational only)
  const validOptions = RISK_OPTIONS.map(r => r.value);
  if (!validOptions.includes(num as typeof validOptions[number])) {
    // Allow it but could warn - user may have custom value
  }
  
  return {
    valid: errors.length === 0,
    errors,
    sanitized: errors.length === 0 ? num : undefined,
  };
}

/**
 * Validate trading style
 */
export function validateStyle(value: unknown): ValidationResult {
  const errors: string[] = [];
  const validStyles: TradingStyle[] = ['intraday', 'swing'];
  
  if (!value || typeof value !== 'string') {
    return { valid: false, errors: ['Trading style is required'] };
  }
  
  if (!validStyles.includes(value as TradingStyle)) {
    errors.push(`Invalid style. Must be one of: ${validStyles.join(', ')}`);
  }
  
  return {
    valid: errors.length === 0,
    errors,
    sanitized: errors.length === 0 ? value : undefined,
  };
}

/**
 * Validate symbol
 */
export function validateSymbol(value: unknown): ValidationResult {
  const errors: string[] = [];
  
  if (!value || typeof value !== 'string') {
    return { valid: false, errors: ['Symbol is required'] };
  }
  
  const symbol = value.toUpperCase().replace('/', '');
  
  if (!isValidSymbol(symbol)) {
    errors.push(`Invalid symbol: ${value}`);
  }
  
  return {
    valid: errors.length === 0,
    errors,
    sanitized: errors.length === 0 ? symbol : undefined,
  };
}

/**
 * Validate array of symbols
 */
export function validateSymbols(values: unknown): ValidationResult {
  const errors: string[] = [];
  const sanitized: string[] = [];
  
  if (!Array.isArray(values)) {
    return { valid: false, errors: ['Symbols must be an array'] };
  }
  
  if (values.length === 0) {
    return { valid: false, errors: ['At least one symbol is required'] };
  }
  
  if (values.length > 20) {
    return { valid: false, errors: ['Maximum 20 symbols per scan'] };
  }
  
  for (const value of values) {
    const result = validateSymbol(value);
    if (result.valid && result.sanitized) {
      sanitized.push(result.sanitized as string);
    } else {
      errors.push(...result.errors);
    }
  }
  
  return {
    valid: errors.length === 0,
    errors,
    sanitized: errors.length === 0 ? sanitized : undefined,
  };
}

/**
 * Validate complete user settings
 */
export function validateSettings(settings: unknown): ValidationResult {
  const errors: string[] = [];
  
  if (!settings || typeof settings !== 'object') {
    return { valid: false, errors: ['Invalid settings object'] };
  }
  
  const s = settings as Record<string, unknown>;
  
  const accountResult = validateAccountSize(s.accountSize);
  if (!accountResult.valid) errors.push(...accountResult.errors);
  
  const riskResult = validateRiskPercent(s.riskPercent);
  if (!riskResult.valid) errors.push(...riskResult.errors);
  
  const styleResult = validateStyle(s.style);
  if (!styleResult.valid) errors.push(...styleResult.errors);
  
  return {
    valid: errors.length === 0,
    errors,
    sanitized: errors.length === 0 ? {
      accountSize: accountResult.sanitized,
      riskPercent: riskResult.sanitized,
      style: styleResult.sanitized,
    } : undefined,
  };
}

// ═══════════════════════════════════════════════════════════════
// SANITIZERS
// ═══════════════════════════════════════════════════════════════

/**
 * Sanitize symbol input
 */
export function sanitizeSymbol(input: string): string {
  return input.toUpperCase().replace(/[^A-Z]/g, '');
}

/**
 * Clamp a number to a range
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
