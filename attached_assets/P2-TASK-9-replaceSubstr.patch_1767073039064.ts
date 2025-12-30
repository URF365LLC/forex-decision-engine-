/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * P2 TASK #9: REPLACE DEPRECATED SUBSTR() WITH SUBSTRING()
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * PROBLEM: Line 144 in src/storage/journalStore.ts uses deprecated substr()
 * 
 * IMPACT:
 *   - substr() is deprecated in ECMAScript and may be removed in future
 *   - Some strict TypeScript configs flag this as an error
 *   - Inconsistent with modern JavaScript best practices
 * 
 * FILE TO MODIFY: src/storage/journalStore.ts (line 144)
 * 
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// ═══════════════════════════════════════════════════════════════════════════════
// DIFFERENCE BETWEEN SUBSTR() AND SUBSTRING()
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * substr(start, length)     - Deprecated, extracts 'length' characters from 'start'
 * substring(start, end)     - Standard, extracts from 'start' to 'end' (exclusive)
 * slice(start, end)         - Standard, like substring but supports negative indices
 * 
 * CONVERSION:
 *   str.substr(start, length)  →  str.substring(start, start + length)
 *   str.substr(start, length)  →  str.slice(start, start + length)
 * 
 * EXAMPLES:
 *   'hello'.substr(1, 3)      → 'ell'  (from index 1, take 3 chars)
 *   'hello'.substring(1, 4)   → 'ell'  (from index 1 to 4, exclusive)
 *   'hello'.slice(1, 4)       → 'ell'  (from index 1 to 4, exclusive)
 */


// ═══════════════════════════════════════════════════════════════════════════════
// BEFORE (line 144 in journalStore.ts)
// ═══════════════════════════════════════════════════════════════════════════════

/*
function generateId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substr(2, 9);  // DEPRECATED
  return `${timestamp}-${random}`;
}
*/


// ═══════════════════════════════════════════════════════════════════════════════
// AFTER (FIXED)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Generate a unique ID for journal entries
 * Format: {timestamp_base36}-{random_9chars}
 */
function generateId(): string {
  const timestamp = Date.now().toString(36);
  
  // ════════════════════════════════════════════════════════════════
  // FIXED: Use substring() instead of deprecated substr()
  // ════════════════════════════════════════════════════════════════
  // Math.random().toString(36) produces something like "0.abc123def"
  // We want to skip the "0." prefix (first 2 chars) and take 9 chars
  // substr(2, 9) → substring(2, 11) where 11 = 2 + 9
  const random = Math.random().toString(36).substring(2, 11);
  
  return `${timestamp}-${random}`;
}

// Alternative using slice() - equally valid:
function generateIdWithSlice(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 11);
  return `${timestamp}-${random}`;
}


// ═══════════════════════════════════════════════════════════════════════════════
// GLOBAL SEARCH & REPLACE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Search entire codebase for other substr() usages:
 * 
 * FIND:     .substr(
 * 
 * Common patterns to replace:
 * 
 *   .substr(0, n)     →  .substring(0, n)   or  .slice(0, n)
 *   .substr(start, n) →  .substring(start, start + n)
 *   .substr(-n)       →  .slice(-n)  (negative index - use slice!)
 * 
 * NOTE: For negative start index, use slice() not substring()
 *   'hello'.slice(-2)      → 'lo'  (last 2 chars)
 *   'hello'.substring(-2)  → 'hello'  (negative treated as 0)
 */


// ═══════════════════════════════════════════════════════════════════════════════
// ESLINT RULE TO PREVENT FUTURE USAGE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Add to .eslintrc.js or eslint.config.js:
 * 
 * {
 *   rules: {
 *     'unicorn/prefer-string-slice': 'error',
 *     // Or if using @typescript-eslint:
 *     '@typescript-eslint/prefer-string-starts-ends-with': 'error',
 *   }
 * }
 * 
 * This will flag any future use of substr() as an error.
 */


// ═══════════════════════════════════════════════════════════════════════════════
// TYPESCRIPT STRICT MODE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * If using TypeScript with strict libs, you can exclude substr() from types:
 * 
 * In tsconfig.json:
 * {
 *   "compilerOptions": {
 *     "lib": ["ES2022"],  // Modern ES version doesn't include substr in types
 *   }
 * }
 * 
 * This makes TypeScript show an error if substr() is used.
 */
