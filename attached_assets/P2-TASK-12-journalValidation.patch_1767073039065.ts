/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * P2 TASK #12: ADD VALIDATION FOR JOURNAL PUT ENDPOINT
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * PROBLEM: PUT /api/journal/:id endpoint in src/server.ts lacks validation
 *          for required fields, allowing malformed entries to be saved
 * 
 * IMPACT:
 *   - Corrupt journal data
 *   - Runtime errors when rendering entries
 *   - Inconsistent data structure
 *   - Potential security issues (XSS if content not sanitized)
 * 
 * FILE TO MODIFY: src/server.ts
 * 
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 1: CREATE VALIDATION MIDDLEWARE/HELPER
// ═══════════════════════════════════════════════════════════════════════════════

import { Request, Response, NextFunction } from 'express';

/**
 * Journal entry schema for validation
 */
interface JournalEntry {
  id?: string;
  symbol: string;
  direction: 'long' | 'short';
  entryPrice: number;
  exitPrice?: number;
  stopLoss: number;
  takeProfit: number;
  lotSize: number;
  status: 'open' | 'closed' | 'cancelled';
  outcome?: 'win' | 'loss' | 'breakeven';
  pnl?: number;
  notes?: string;
  strategy: string;
  openedAt: string;
  closedAt?: string;
  tags?: string[];
}

/**
 * Validation error response
 */
interface ValidationError {
  field: string;
  message: string;
  value?: unknown;
}

/**
 * Validate journal entry data
 * @param data - Request body to validate
 * @returns Array of validation errors (empty if valid)
 */
function validateJournalEntry(data: Partial<JournalEntry>): ValidationError[] {
  const errors: ValidationError[] = [];
  
  // ════════════════════════════════════════════════════════════════
  // REQUIRED FIELDS
  // ════════════════════════════════════════════════════════════════
  
  // Symbol
  if (!data.symbol || typeof data.symbol !== 'string') {
    errors.push({
      field: 'symbol',
      message: 'Symbol is required and must be a string',
      value: data.symbol,
    });
  } else if (!/^[A-Z]{3,10}(\/[A-Z]{3,10})?$/i.test(data.symbol.replace(/[^A-Za-z/]/g, ''))) {
    errors.push({
      field: 'symbol',
      message: 'Symbol format is invalid',
      value: data.symbol,
    });
  }
  
  // Direction
  if (!data.direction) {
    errors.push({
      field: 'direction',
      message: 'Direction is required',
    });
  } else if (!['long', 'short'].includes(data.direction)) {
    errors.push({
      field: 'direction',
      message: 'Direction must be "long" or "short"',
      value: data.direction,
    });
  }
  
  // Entry Price
  if (data.entryPrice === undefined || data.entryPrice === null) {
    errors.push({
      field: 'entryPrice',
      message: 'Entry price is required',
    });
  } else if (typeof data.entryPrice !== 'number' || data.entryPrice <= 0 || !isFinite(data.entryPrice)) {
    errors.push({
      field: 'entryPrice',
      message: 'Entry price must be a positive number',
      value: data.entryPrice,
    });
  }
  
  // Stop Loss
  if (data.stopLoss === undefined || data.stopLoss === null) {
    errors.push({
      field: 'stopLoss',
      message: 'Stop loss is required',
    });
  } else if (typeof data.stopLoss !== 'number' || data.stopLoss <= 0 || !isFinite(data.stopLoss)) {
    errors.push({
      field: 'stopLoss',
      message: 'Stop loss must be a positive number',
      value: data.stopLoss,
    });
  }
  
  // Take Profit
  if (data.takeProfit === undefined || data.takeProfit === null) {
    errors.push({
      field: 'takeProfit',
      message: 'Take profit is required',
    });
  } else if (typeof data.takeProfit !== 'number' || data.takeProfit <= 0 || !isFinite(data.takeProfit)) {
    errors.push({
      field: 'takeProfit',
      message: 'Take profit must be a positive number',
      value: data.takeProfit,
    });
  }
  
  // Lot Size
  if (data.lotSize === undefined || data.lotSize === null) {
    errors.push({
      field: 'lotSize',
      message: 'Lot size is required',
    });
  } else if (typeof data.lotSize !== 'number' || data.lotSize <= 0 || !isFinite(data.lotSize)) {
    errors.push({
      field: 'lotSize',
      message: 'Lot size must be a positive number',
      value: data.lotSize,
    });
  }
  
  // Status
  if (!data.status) {
    errors.push({
      field: 'status',
      message: 'Status is required',
    });
  } else if (!['open', 'closed', 'cancelled'].includes(data.status)) {
    errors.push({
      field: 'status',
      message: 'Status must be "open", "closed", or "cancelled"',
      value: data.status,
    });
  }
  
  // Strategy
  if (!data.strategy || typeof data.strategy !== 'string') {
    errors.push({
      field: 'strategy',
      message: 'Strategy is required',
    });
  }
  
  // Opened At
  if (!data.openedAt) {
    errors.push({
      field: 'openedAt',
      message: 'Opened at timestamp is required',
    });
  } else if (isNaN(Date.parse(data.openedAt))) {
    errors.push({
      field: 'openedAt',
      message: 'Opened at must be a valid ISO date string',
      value: data.openedAt,
    });
  }
  
  // ════════════════════════════════════════════════════════════════
  // OPTIONAL FIELD VALIDATION
  // ════════════════════════════════════════════════════════════════
  
  // Exit Price (optional, but validate if present)
  if (data.exitPrice !== undefined && data.exitPrice !== null) {
    if (typeof data.exitPrice !== 'number' || data.exitPrice <= 0 || !isFinite(data.exitPrice)) {
      errors.push({
        field: 'exitPrice',
        message: 'Exit price must be a positive number',
        value: data.exitPrice,
      });
    }
  }
  
  // Outcome (optional)
  if (data.outcome !== undefined && !['win', 'loss', 'breakeven'].includes(data.outcome)) {
    errors.push({
      field: 'outcome',
      message: 'Outcome must be "win", "loss", or "breakeven"',
      value: data.outcome,
    });
  }
  
  // PnL (optional)
  if (data.pnl !== undefined && typeof data.pnl !== 'number') {
    errors.push({
      field: 'pnl',
      message: 'PnL must be a number',
      value: data.pnl,
    });
  }
  
  // Notes (optional, sanitize if present)
  if (data.notes !== undefined && typeof data.notes !== 'string') {
    errors.push({
      field: 'notes',
      message: 'Notes must be a string',
      value: typeof data.notes,
    });
  } else if (data.notes && data.notes.length > 10000) {
    errors.push({
      field: 'notes',
      message: 'Notes cannot exceed 10,000 characters',
      value: data.notes.length,
    });
  }
  
  // Tags (optional)
  if (data.tags !== undefined) {
    if (!Array.isArray(data.tags)) {
      errors.push({
        field: 'tags',
        message: 'Tags must be an array',
        value: typeof data.tags,
      });
    } else if (!data.tags.every(tag => typeof tag === 'string')) {
      errors.push({
        field: 'tags',
        message: 'All tags must be strings',
      });
    }
  }
  
  // ════════════════════════════════════════════════════════════════
  // LOGICAL VALIDATION
  // ════════════════════════════════════════════════════════════════
  
  // Stop loss should be below entry for long, above for short
  if (data.entryPrice && data.stopLoss && data.direction) {
    if (data.direction === 'long' && data.stopLoss >= data.entryPrice) {
      errors.push({
        field: 'stopLoss',
        message: 'Stop loss should be below entry price for long trades',
      });
    }
    if (data.direction === 'short' && data.stopLoss <= data.entryPrice) {
      errors.push({
        field: 'stopLoss',
        message: 'Stop loss should be above entry price for short trades',
      });
    }
  }
  
  // Take profit should be above entry for long, below for short
  if (data.entryPrice && data.takeProfit && data.direction) {
    if (data.direction === 'long' && data.takeProfit <= data.entryPrice) {
      errors.push({
        field: 'takeProfit',
        message: 'Take profit should be above entry price for long trades',
      });
    }
    if (data.direction === 'short' && data.takeProfit >= data.entryPrice) {
      errors.push({
        field: 'takeProfit',
        message: 'Take profit should be below entry price for short trades',
      });
    }
  }
  
  // Closed trades should have exit price
  if (data.status === 'closed' && !data.exitPrice) {
    errors.push({
      field: 'exitPrice',
      message: 'Closed trades must have an exit price',
    });
  }
  
  return errors;
}

/**
 * Sanitize notes field to prevent XSS
 */
function sanitizeNotes(notes: string | undefined): string | undefined {
  if (!notes) return notes;
  
  // Remove script tags and event handlers
  return notes
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/on\w+\s*=/gi, '')
    .replace(/<iframe/gi, '&lt;iframe')
    .trim();
}


// ═══════════════════════════════════════════════════════════════════════════════
// STEP 2: UPDATE PUT ENDPOINT IN server.ts
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * BEFORE (no validation):
 * 
 * app.put('/api/journal/:id', async (req, res) => {
 *   const { id } = req.params;
 *   const entry = req.body;
 *   await journalStore.update(id, entry);
 *   res.json({ success: true, entry });
 * });
 */

/**
 * AFTER (with validation):
 */

import { journalStore } from './storage/journalStore.js';

// PUT /api/journal/:id - Update journal entry
app.put('/api/journal/:id', async (req, res) => {
  const { id } = req.params;
  const data = req.body;
  
  // ════════════════════════════════════════════════════════════════
  // VALIDATE INPUT
  // ════════════════════════════════════════════════════════════════
  
  const errors = validateJournalEntry(data);
  
  if (errors.length > 0) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors,
    });
  }
  
  // ════════════════════════════════════════════════════════════════
  // SANITIZE INPUT
  // ════════════════════════════════════════════════════════════════
  
  const sanitizedEntry: JournalEntry = {
    ...data,
    id,
    notes: sanitizeNotes(data.notes),
    tags: data.tags?.map((tag: string) => tag.trim().toLowerCase()),
  };
  
  // ════════════════════════════════════════════════════════════════
  // UPDATE ENTRY
  // ════════════════════════════════════════════════════════════════
  
  try {
    const updated = await journalStore.update(id, sanitizedEntry);
    
    if (!updated) {
      return res.status(404).json({
        success: false,
        message: `Journal entry not found: ${id}`,
      });
    }
    
    res.json({
      success: true,
      entry: updated,
    });
  } catch (error) {
    console.error('Failed to update journal entry:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update journal entry',
    });
  }
});


// ═══════════════════════════════════════════════════════════════════════════════
// STEP 3: ALSO UPDATE POST ENDPOINT
// ═══════════════════════════════════════════════════════════════════════════════

// POST /api/journal - Create journal entry
app.post('/api/journal', async (req, res) => {
  const data = req.body;
  
  // Validate
  const errors = validateJournalEntry(data);
  
  if (errors.length > 0) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors,
    });
  }
  
  // Sanitize
  const sanitizedEntry = {
    ...data,
    notes: sanitizeNotes(data.notes),
    tags: data.tags?.map((tag: string) => tag.trim().toLowerCase()),
    openedAt: data.openedAt || new Date().toISOString(),
  };
  
  try {
    const created = await journalStore.create(sanitizedEntry);
    res.status(201).json({
      success: true,
      entry: created,
    });
  } catch (error) {
    console.error('Failed to create journal entry:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create journal entry',
    });
  }
});


// ═══════════════════════════════════════════════════════════════════════════════
// EXPRESS VALIDATOR ALTERNATIVE (more robust)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * If using express-validator package:
 * 
 * npm install express-validator
 */

/*
import { body, validationResult } from 'express-validator';

const journalValidation = [
  body('symbol').notEmpty().isString().matches(/^[A-Z]{3,10}/i),
  body('direction').isIn(['long', 'short']),
  body('entryPrice').isFloat({ min: 0.00001 }),
  body('stopLoss').isFloat({ min: 0.00001 }),
  body('takeProfit').isFloat({ min: 0.00001 }),
  body('lotSize').isFloat({ min: 0.01 }),
  body('status').isIn(['open', 'closed', 'cancelled']),
  body('strategy').notEmpty().isString(),
  body('openedAt').isISO8601(),
  body('notes').optional().isString().isLength({ max: 10000 }),
  body('tags').optional().isArray(),
  body('tags.*').optional().isString(),
];

app.put('/api/journal/:id', journalValidation, (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  // ... rest of handler
});
*/


// ═══════════════════════════════════════════════════════════════════════════════
// FRONTEND ERROR HANDLING
// ═══════════════════════════════════════════════════════════════════════════════

/*
// In public/js/journal.js:

async function saveJournalEntry(entry) {
  try {
    const response = await fetch(`/api/journal/${entry.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry),
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      // Show validation errors to user
      if (data.errors) {
        const errorMessages = data.errors
          .map(e => `${e.field}: ${e.message}`)
          .join('\n');
        alert(`Validation errors:\n${errorMessages}`);
      } else {
        alert(data.message || 'Failed to save entry');
      }
      return null;
    }
    
    return data.entry;
  } catch (error) {
    console.error('Save failed:', error);
    alert('Network error - please try again');
    return null;
  }
}
*/
