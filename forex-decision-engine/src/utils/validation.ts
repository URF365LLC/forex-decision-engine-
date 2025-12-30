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

// ═══════════════════════════════════════════════════════════════
// JOURNAL ENTRY VALIDATION
// ═══════════════════════════════════════════════════════════════

export interface JournalValidationError {
  field: string;
  message: string;
  value?: unknown;
}

/**
 * Validate journal entry update data
 */
export function validateJournalUpdate(data: Record<string, unknown>): JournalValidationError[] {
  const errors: JournalValidationError[] = [];
  
  if (data.symbol !== undefined && typeof data.symbol !== 'string') {
    errors.push({ field: 'symbol', message: 'Symbol must be a string', value: data.symbol });
  }
  
  if (data.direction !== undefined && !['long', 'short'].includes(data.direction as string)) {
    errors.push({ field: 'direction', message: 'Direction must be "long" or "short"', value: data.direction });
  }
  
  if (data.entryPrice !== undefined) {
    const price = Number(data.entryPrice);
    if (isNaN(price) || price <= 0 || !isFinite(price)) {
      errors.push({ field: 'entryPrice', message: 'Entry price must be a positive number', value: data.entryPrice });
    }
  }
  
  if (data.exitPrice !== undefined && data.exitPrice !== null) {
    const price = Number(data.exitPrice);
    if (isNaN(price) || price <= 0 || !isFinite(price)) {
      errors.push({ field: 'exitPrice', message: 'Exit price must be a positive number', value: data.exitPrice });
    }
  }
  
  if (data.stopLoss !== undefined) {
    const sl = Number(data.stopLoss);
    if (isNaN(sl) || sl <= 0 || !isFinite(sl)) {
      errors.push({ field: 'stopLoss', message: 'Stop loss must be a positive number', value: data.stopLoss });
    }
  }
  
  if (data.takeProfit !== undefined) {
    const tp = Number(data.takeProfit);
    if (isNaN(tp) || tp <= 0 || !isFinite(tp)) {
      errors.push({ field: 'takeProfit', message: 'Take profit must be a positive number', value: data.takeProfit });
    }
  }
  
  if (data.lots !== undefined) {
    const lots = Number(data.lots);
    if (isNaN(lots) || lots <= 0 || !isFinite(lots)) {
      errors.push({ field: 'lots', message: 'Lot size must be a positive number', value: data.lots });
    }
  }
  
  if (data.status !== undefined && !['pending', 'running', 'closed'].includes(data.status as string)) {
    errors.push({ field: 'status', message: 'Status must be "pending", "running", or "closed"', value: data.status });
  }
  
  if (data.action !== undefined && !['taken', 'skipped', 'missed'].includes(data.action as string)) {
    errors.push({ field: 'action', message: 'Action must be "taken", "skipped", or "missed"', value: data.action });
  }
  
  if (data.result !== undefined && data.result !== null && !['win', 'loss', 'breakeven'].includes(data.result as string)) {
    errors.push({ field: 'result', message: 'Result must be "win", "loss", or "breakeven"', value: data.result });
  }
  
  if (data.notes !== undefined && typeof data.notes !== 'string') {
    errors.push({ field: 'notes', message: 'Notes must be a string', value: typeof data.notes });
  } else if (typeof data.notes === 'string' && data.notes.length > 10000) {
    errors.push({ field: 'notes', message: 'Notes cannot exceed 10,000 characters', value: data.notes.length });
  }
  
  return errors;
}

/**
 * Sanitize notes field to prevent XSS
 */
export function sanitizeNotes(notes: string | undefined): string | undefined {
  if (!notes) return notes;
  
  return notes
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/on\w+\s*=/gi, '')
    .replace(/<iframe/gi, '&lt;iframe')
    .trim();
}
