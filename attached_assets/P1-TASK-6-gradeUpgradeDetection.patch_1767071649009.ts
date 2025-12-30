/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * P1 TASK #6: GRADE UPGRADE DETECTION AND ALERTS
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * PROBLEM: When a symbol's grade improves (B → A+ or no-trade → B/A+), 
 *          there's no notification to the user. They might miss emerging
 *          high-quality setups.
 * 
 * SOLUTION: 
 *   1. Track previous grades per symbol/strategy
 *   2. Compare new grade against previous
 *   3. Emit upgrade events for B→A+ and no-trade→trade transitions
 *   4. Frontend can display alerts/notifications
 * 
 * FILES TO MODIFY:
 *   - src/engine/strategyAnalyzer.ts (main logic)
 *   - src/services/gradeTracker.ts (new file)
 *   - src/server.ts (SSE endpoint for real-time alerts)
 * 
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// ═══════════════════════════════════════════════════════════════════════════════
// NEW FILE: src/services/gradeTracker.ts
// ═══════════════════════════════════════════════════════════════════════════════

import { createLogger } from './logger.js';
import { EventEmitter } from 'events';

const logger = createLogger('GradeTracker');

// ════════════════════════════════════════════════════════════════
// TYPES
// ════════════════════════════════════════════════════════════════

export type Grade = 'A+' | 'B' | 'no-trade';

export interface GradeRecord {
  grade: Grade;
  direction: 'long' | 'short' | 'none';
  timestamp: string;
  strategyId: string;
}

export interface GradeUpgrade {
  symbol: string;
  strategyId: string;
  strategyName: string;
  previousGrade: Grade;
  newGrade: Grade;
  direction: 'long' | 'short';
  upgradeType: 'new-signal' | 'grade-improvement';
  timestamp: string;
  message: string;
}

export type GradeUpgradeHandler = (upgrade: GradeUpgrade) => void;

// ════════════════════════════════════════════════════════════════
// GRADE TRACKER SERVICE
// ════════════════════════════════════════════════════════════════

class GradeTrackerService extends EventEmitter {
  private grades: Map<string, GradeRecord> = new Map();
  private upgradeHandlers: GradeUpgradeHandler[] = [];
  
  /**
   * Generate cache key for symbol/strategy combination
   */
  private getKey(symbol: string, strategyId: string): string {
    return `${symbol}:${strategyId}`;
  }
  
  /**
   * Get the previous grade for a symbol/strategy
   */
  getPreviousGrade(symbol: string, strategyId: string): GradeRecord | null {
    const key = this.getKey(symbol, strategyId);
    return this.grades.get(key) || null;
  }
  
  /**
   * Update grade and check for upgrades
   * Returns upgrade info if an upgrade occurred, null otherwise
   */
  updateGrade(
    symbol: string,
    strategyId: string,
    strategyName: string,
    newGrade: Grade,
    direction: 'long' | 'short' | 'none'
  ): GradeUpgrade | null {
    const key = this.getKey(symbol, strategyId);
    const previous = this.grades.get(key);
    const now = new Date().toISOString();
    
    // Store new grade
    this.grades.set(key, {
      grade: newGrade,
      direction,
      timestamp: now,
      strategyId,
    });
    
    // Check for upgrade
    const upgrade = this.checkForUpgrade(
      symbol,
      strategyId,
      strategyName,
      previous,
      newGrade,
      direction,
      now
    );
    
    // Emit event if upgrade detected
    if (upgrade) {
      logger.info(`Grade upgrade detected: ${symbol}/${strategyId} ${upgrade.previousGrade} → ${upgrade.newGrade}`);
      this.emit('upgrade', upgrade);
      this.notifyHandlers(upgrade);
    }
    
    return upgrade;
  }
  
  /**
   * Check if grade change constitutes an upgrade
   */
  private checkForUpgrade(
    symbol: string,
    strategyId: string,
    strategyName: string,
    previous: GradeRecord | undefined,
    newGrade: Grade,
    direction: 'long' | 'short' | 'none',
    timestamp: string
  ): GradeUpgrade | null {
    // No upgrade if new grade is no-trade
    if (newGrade === 'no-trade' || direction === 'none') {
      return null;
    }
    
    // Case 1: New signal (no previous grade or was no-trade)
    if (!previous || previous.grade === 'no-trade') {
      return {
        symbol,
        strategyId,
        strategyName,
        previousGrade: previous?.grade || 'no-trade',
        newGrade,
        direction,
        upgradeType: 'new-signal',
        timestamp,
        message: `🆕 New ${newGrade} ${direction.toUpperCase()} signal on ${symbol} (${strategyName})`,
      };
    }
    
    // Case 2: Grade improvement (B → A+)
    if (previous.grade === 'B' && newGrade === 'A+') {
      return {
        symbol,
        strategyId,
        strategyName,
        previousGrade: 'B',
        newGrade: 'A+',
        direction,
        upgradeType: 'grade-improvement',
        timestamp,
        message: `⬆️ ${symbol} upgraded B → A+ ${direction.toUpperCase()} (${strategyName})`,
      };
    }
    
    // Case 3: Direction change with good grade (could be new opportunity)
    if (previous.direction !== direction && previous.direction !== 'none') {
      return {
        symbol,
        strategyId,
        strategyName,
        previousGrade: previous.grade,
        newGrade,
        direction,
        upgradeType: 'new-signal',
        timestamp,
        message: `🔄 ${symbol} flipped to ${newGrade} ${direction.toUpperCase()} (${strategyName})`,
      };
    }
    
    // No upgrade
    return null;
  }
  
  /**
   * Register a handler for upgrade events
   */
  onUpgrade(handler: GradeUpgradeHandler): void {
    this.upgradeHandlers.push(handler);
  }
  
  /**
   * Remove an upgrade handler
   */
  offUpgrade(handler: GradeUpgradeHandler): void {
    const index = this.upgradeHandlers.indexOf(handler);
    if (index > -1) {
      this.upgradeHandlers.splice(index, 1);
    }
  }
  
  /**
   * Notify all registered handlers
   */
  private notifyHandlers(upgrade: GradeUpgrade): void {
    for (const handler of this.upgradeHandlers) {
      try {
        handler(upgrade);
      } catch (e) {
        logger.error('Error in upgrade handler', { error: e });
      }
    }
  }
  
  /**
   * Get all current grades (for debugging/admin)
   */
  getAllGrades(): Map<string, GradeRecord> {
    return new Map(this.grades);
  }
  
  /**
   * Clear all tracked grades
   */
  clear(): void {
    this.grades.clear();
    logger.info('Grade tracker cleared');
  }
  
  /**
   * Clear grades for a specific symbol
   */
  clearSymbol(symbol: string): void {
    for (const key of this.grades.keys()) {
      if (key.startsWith(`${symbol}:`)) {
        this.grades.delete(key);
      }
    }
    logger.debug(`Cleared grades for ${symbol}`);
  }
  
  /**
   * Get recent upgrades (last N minutes)
   * Useful for showing recent alerts on page load
   */
  private recentUpgrades: GradeUpgrade[] = [];
  private maxRecentUpgrades = 50;
  
  getRecentUpgrades(sinceMinutes: number = 60): GradeUpgrade[] {
    const cutoff = Date.now() - (sinceMinutes * 60 * 1000);
    return this.recentUpgrades.filter(u => 
      new Date(u.timestamp).getTime() > cutoff
    );
  }
  
  /**
   * Store upgrade in recent list (called internally after notifyHandlers)
   */
  private storeRecentUpgrade(upgrade: GradeUpgrade): void {
    this.recentUpgrades.unshift(upgrade);
    if (this.recentUpgrades.length > this.maxRecentUpgrades) {
      this.recentUpgrades.pop();
    }
  }
}

// Export singleton
export const gradeTracker = new GradeTrackerService();


// ═══════════════════════════════════════════════════════════════════════════════
// UPDATE: src/engine/strategyAnalyzer.ts
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * ADD import at top of file:
 */
import { gradeTracker, GradeUpgrade } from '../services/gradeTracker.js';

/**
 * UPDATE analyzeSymbolWithStrategy() - ADD after building decision, before return:
 */

export async function analyzeSymbolWithStrategy(
  symbol: string,
  strategyId: string,
  settings: UserSettings,
  options: AnalysisOptions = {}
): Promise<StrategyDecision> {
  // ... existing code ...
  
  // Build decision
  const decision = buildDecision(/* ... */);
  
  // Add gating info (from Task #4)
  decision.gating = { /* ... */ };
  
  // ════════════════════════════════════════════════════════════════════════════
  // NEW: GRADE UPGRADE DETECTION
  // ════════════════════════════════════════════════════════════════════════════
  
  // Only track grades for non-blocked signals
  if (!decision.gating.cooldownBlocked && !decision.gating.volatilityBlocked) {
    const upgrade = gradeTracker.updateGrade(
      symbol,
      strategyId,
      strategy.meta.name,
      decision.grade,
      decision.direction
    );
    
    // Attach upgrade info to decision if one occurred
    if (upgrade) {
      decision.upgrade = upgrade;
    }
  }
  
  // ════════════════════════════════════════════════════════════════════════════
  
  // Cache no-trade decisions
  if (decision.grade === 'no-trade' && !options.skipCache) {
    cacheNoTradeDecision(symbol, strategyId, settings.style, decision);
  }
  
  return decision;
}


// ═══════════════════════════════════════════════════════════════════════════════
// UPDATE: StrategyDecision INTERFACE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * ADD upgrade field to StrategyDecision:
 */
export interface StrategyDecision {
  // ... existing fields ...
  
  gating: {
    cooldownBlocked: boolean;
    volatilityBlocked: boolean;
    volatilityLevel: VolatilityLevel;
    // ... other gating fields
  };
  
  // ════════════════════════════════════════════════════════════════
  // NEW: UPGRADE INFO
  // ════════════════════════════════════════════════════════════════
  upgrade?: GradeUpgrade;
  
  errors: string[];
}


// ═══════════════════════════════════════════════════════════════════════════════
// UPDATE: scanWithStrategy() TO COLLECT UPGRADES
// ═══════════════════════════════════════════════════════════════════════════════

export interface ScanResult {
  decisions: StrategyDecision[];
  upgrades: GradeUpgrade[];
  errors: string[];
  stats: {
    total: number;
    trades: number;
    noTrades: number;
    blocked: number;
    cacheHits: number;
  };
}

export async function scanWithStrategy(
  symbols: string[],
  strategyId: string,
  settings: UserSettings,
  onProgress?: (progress: ScanProgress) => void
): Promise<ScanResult> {
  const decisions: StrategyDecision[] = [];
  const upgrades: GradeUpgrade[] = [];
  const errors: string[] = [];
  let cacheHits = 0;
  
  logger.info(`Starting ${strategyId} scan of ${symbols.length} symbols`);
  
  for (let i = 0; i < symbols.length; i++) {
    const symbol = symbols[i];
    
    if (onProgress) {
      onProgress({
        total: symbols.length,
        completed: i,
        current: symbol,
        results: [...decisions],
        errors: [...errors],
      });
    }
    
    try {
      const decision = await analyzeSymbolWithStrategy(symbol, strategyId, settings);
      decisions.push(decision);
      
      // Collect upgrades
      if (decision.upgrade) {
        upgrades.push(decision.upgrade);
      }
      
      if (decision.metadata?.fromCache) {
        cacheHits++;
      }
      
      if (decision.errors?.length > 0) {
        errors.push(`${symbol}: ${decision.errors.join(', ')}`);
      }
    } catch (e) {
      const error = e instanceof Error ? e.message : 'Unknown error';
      errors.push(`${symbol}: ${error}`);
      logger.error(`Scan error for ${symbol}/${strategyId}`, { error });
    }
  }
  
  // Final progress
  if (onProgress) {
    onProgress({
      total: symbols.length,
      completed: symbols.length,
      current: null,
      results: decisions,
      errors,
    });
  }
  
  // Calculate stats
  const stats = {
    total: decisions.length,
    trades: decisions.filter(d => d.grade !== 'no-trade').length,
    noTrades: decisions.filter(d => d.grade === 'no-trade').length,
    blocked: decisions.filter(d => d.gating?.cooldownBlocked || d.gating?.volatilityBlocked).length,
    cacheHits,
  };
  
  logger.info(
    `Scan complete: ${stats.trades} trades, ${stats.noTrades} no-trades, ` +
    `${upgrades.length} upgrades, ${cacheHits} cache hits`
  );
  
  return { decisions, upgrades, errors, stats };
}


// ═══════════════════════════════════════════════════════════════════════════════
// NEW: SSE ENDPOINT FOR REAL-TIME ALERTS (src/server.ts)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * ADD this endpoint to src/server.ts for real-time upgrade notifications:
 */

import { gradeTracker } from './services/gradeTracker.js';

// SSE endpoint for grade upgrades
app.get('/api/upgrades/stream', (req, res) => {
  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
  
  // Send initial connection message
  res.write(`data: ${JSON.stringify({ type: 'connected', timestamp: new Date().toISOString() })}\n\n`);
  
  // Handler for upgrade events
  const upgradeHandler = (upgrade: GradeUpgrade) => {
    res.write(`data: ${JSON.stringify({ type: 'upgrade', upgrade })}\n\n`);
  };
  
  // Register handler
  gradeTracker.onUpgrade(upgradeHandler);
  
  // Send heartbeat every 30 seconds to keep connection alive
  const heartbeat = setInterval(() => {
    res.write(`data: ${JSON.stringify({ type: 'heartbeat', timestamp: new Date().toISOString() })}\n\n`);
  }, 30000);
  
  // Cleanup on disconnect
  req.on('close', () => {
    gradeTracker.offUpgrade(upgradeHandler);
    clearInterval(heartbeat);
    logger.debug('SSE client disconnected from upgrade stream');
  });
  
  logger.debug('SSE client connected to upgrade stream');
});

// REST endpoint to get recent upgrades (for page load)
app.get('/api/upgrades/recent', (req, res) => {
  const minutes = parseInt(req.query.minutes as string) || 60;
  const upgrades = gradeTracker.getRecentUpgrades(minutes);
  res.json({ upgrades, count: upgrades.length });
});


// ═══════════════════════════════════════════════════════════════════════════════
// FRONTEND: JavaScript to consume SSE (public/js/app.js)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * ADD this to the App object in public/js/app.js:
 */

const UpgradeNotifications = {
  eventSource: null,
  
  /**
   * Connect to SSE stream for real-time upgrades
   */
  connect() {
    if (this.eventSource) {
      this.eventSource.close();
    }
    
    this.eventSource = new EventSource('/api/upgrades/stream');
    
    this.eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      
      switch (data.type) {
        case 'connected':
          console.log('Connected to upgrade stream');
          break;
          
        case 'upgrade':
          this.showUpgradeNotification(data.upgrade);
          break;
          
        case 'heartbeat':
          // Connection alive, no action needed
          break;
      }
    };
    
    this.eventSource.onerror = (error) => {
      console.error('SSE connection error:', error);
      // Reconnect after 5 seconds
      setTimeout(() => this.connect(), 5000);
    };
  },
  
  /**
   * Disconnect from SSE stream
   */
  disconnect() {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
  },
  
  /**
   * Show upgrade notification to user
   */
  showUpgradeNotification(upgrade) {
    // Create notification element
    const notification = document.createElement('div');
    notification.className = `upgrade-notification upgrade-${upgrade.upgradeType}`;
    notification.innerHTML = `
      <div class="upgrade-icon">${upgrade.upgradeType === 'grade-improvement' ? '⬆️' : '🆕'}</div>
      <div class="upgrade-content">
        <div class="upgrade-symbol">${upgrade.symbol}</div>
        <div class="upgrade-message">${upgrade.message}</div>
        <div class="upgrade-time">${new Date(upgrade.timestamp).toLocaleTimeString()}</div>
      </div>
      <button class="upgrade-dismiss" onclick="this.parentElement.remove()">×</button>
    `;
    
    // Add to notification container
    const container = document.getElementById('upgrade-notifications');
    if (container) {
      container.appendChild(notification);
      
      // Auto-remove after 30 seconds
      setTimeout(() => {
        notification.classList.add('fade-out');
        setTimeout(() => notification.remove(), 500);
      }, 30000);
    }
    
    // Play sound if enabled
    if (App.settings?.soundEnabled) {
      this.playUpgradeSound(upgrade.upgradeType);
    }
    
    // Browser notification if permitted
    if (Notification.permission === 'granted') {
      new Notification(`${upgrade.symbol} Upgrade`, {
        body: upgrade.message,
        icon: '/favicon.ico',
        tag: `upgrade-${upgrade.symbol}-${upgrade.strategyId}`,
      });
    }
  },
  
  /**
   * Play notification sound
   */
  playUpgradeSound(type) {
    const audio = new Audio(type === 'grade-improvement' 
      ? '/sounds/upgrade.mp3' 
      : '/sounds/new-signal.mp3'
    );
    audio.volume = 0.5;
    audio.play().catch(() => {}); // Ignore autoplay errors
  },
  
  /**
   * Load recent upgrades on page load
   */
  async loadRecent() {
    try {
      const response = await fetch('/api/upgrades/recent?minutes=60');
      const data = await response.json();
      
      // Show recent upgrades (limit to last 5)
      data.upgrades.slice(0, 5).forEach(upgrade => {
        this.showUpgradeNotification(upgrade);
      });
    } catch (error) {
      console.error('Failed to load recent upgrades:', error);
    }
  },
};

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  UpgradeNotifications.connect();
  UpgradeNotifications.loadRecent();
  
  // Request notification permission
  if (Notification.permission === 'default') {
    Notification.requestPermission();
  }
});


// ═══════════════════════════════════════════════════════════════════════════════
// FRONTEND: CSS for notifications (public/styles.css)
// ═══════════════════════════════════════════════════════════════════════════════

/*
ADD to public/styles.css:

#upgrade-notifications {
  position: fixed;
  top: 80px;
  right: 20px;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-width: 350px;
}

.upgrade-notification {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 16px;
  background: var(--surface);
  border-radius: 8px;
  border-left: 4px solid var(--accent-green);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  animation: slideIn 0.3s ease-out;
}

.upgrade-notification.upgrade-grade-improvement {
  border-left-color: var(--accent-amber);
}

.upgrade-notification.fade-out {
  animation: fadeOut 0.5s ease-out forwards;
}

.upgrade-icon {
  font-size: 1.5rem;
}

.upgrade-content {
  flex: 1;
}

.upgrade-symbol {
  font-weight: 600;
  font-size: 1rem;
  color: var(--text-primary);
}

.upgrade-message {
  font-size: 0.85rem;
  color: var(--text-secondary);
  margin-top: 2px;
}

.upgrade-time {
  font-size: 0.75rem;
  color: var(--text-muted);
  margin-top: 4px;
}

.upgrade-dismiss {
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 1.25rem;
  padding: 0;
  line-height: 1;
}

.upgrade-dismiss:hover {
  color: var(--text-secondary);
}

@keyframes slideIn {
  from {
    transform: translateX(100%);
    opacity: 0;
  }
  to {
    transform: translateX(0);
    opacity: 1;
  }
}

@keyframes fadeOut {
  from {
    transform: translateX(0);
    opacity: 1;
  }
  to {
    transform: translateX(100%);
    opacity: 0;
  }
}
*/


// ═══════════════════════════════════════════════════════════════════════════════
// FRONTEND: HTML for notification container (public/index.html)
// ═══════════════════════════════════════════════════════════════════════════════

/*
ADD this right after <body> tag:

<div id="upgrade-notifications"></div>
*/


// ═══════════════════════════════════════════════════════════════════════════════
// IMPLEMENTATION NOTES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * UPGRADE TYPES:
 * 
 * 1. 'new-signal': 
 *    - no-trade → A+ or B
 *    - Direction flip (was long, now short or vice versa)
 * 
 * 2. 'grade-improvement':
 *    - B → A+ (same direction)
 * 
 * NOT CONSIDERED UPGRADES:
 *    - A+ → A+ (same grade)
 *    - A+ → B (downgrade)
 *    - B → no-trade (lost signal)
 *    - Blocked signals (cooldown/volatility)
 * 
 * PERSISTENCE:
 *    - Grades are stored in memory (reset on server restart)
 *    - For persistence across restarts, could add Redis/file storage
 *    - Recent upgrades kept for 60 minutes (configurable)
 * 
 * PERFORMANCE:
 *    - Map lookup is O(1)
 *    - Event emission is async-safe
 *    - SSE keeps minimal server resources
 */
