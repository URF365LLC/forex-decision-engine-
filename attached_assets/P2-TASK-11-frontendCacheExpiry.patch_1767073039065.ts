/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * P2 TASK #11: ADD 15-MIN EXPIRY CHECK TO FRONTEND CACHE
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * PROBLEM: public/js/storage.js getResults() doesn't check if cached data
 *          has expired, potentially showing stale scan results to users
 * 
 * IMPACT:
 *   - Users may see outdated signals
 *   - Missed trading opportunities
 *   - Confusion when cached data differs from reality
 * 
 * FILE TO MODIFY: public/js/storage.js
 * 
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// ═══════════════════════════════════════════════════════════════════════════════
// CURRENT CODE (PROBLEMATIC)
// ═══════════════════════════════════════════════════════════════════════════════

/*
// public/js/storage.js - BEFORE:

const Storage = {
  getResults() {
    const data = localStorage.getItem('scanResults');
    if (!data) return null;
    return JSON.parse(data);
  },
  
  saveResults(results) {
    localStorage.setItem('scanResults', JSON.stringify(results));
  },
};
*/


// ═══════════════════════════════════════════════════════════════════════════════
// FIXED CODE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Frontend storage utility with TTL support
 */
const Storage = {
  // ════════════════════════════════════════════════════════════════
  // CONFIGURATION
  // ════════════════════════════════════════════════════════════════
  
  /**
   * Cache TTL values in milliseconds
   */
  TTL: {
    SCAN_RESULTS: 15 * 60 * 1000,  // 15 minutes
    USER_SETTINGS: 24 * 60 * 60 * 1000,  // 24 hours
    WATCHLIST: 7 * 24 * 60 * 60 * 1000,  // 7 days
  },
  
  // ════════════════════════════════════════════════════════════════
  // SCAN RESULTS (with 15-min expiry)
  // ════════════════════════════════════════════════════════════════
  
  /**
   * Get cached scan results if not expired
   * @returns {Object|null} Scan results or null if expired/missing
   */
  getResults() {
    const raw = localStorage.getItem('scanResults');
    if (!raw) return null;
    
    try {
      const data = JSON.parse(raw);
      
      // ════════════════════════════════════════════════════════════
      // NEW: CHECK EXPIRY
      // ════════════════════════════════════════════════════════════
      if (!data.timestamp) {
        // Legacy data without timestamp - treat as expired
        console.warn('Scan results missing timestamp, clearing cache');
        this.clearResults();
        return null;
      }
      
      const age = Date.now() - new Date(data.timestamp).getTime();
      const maxAge = this.TTL.SCAN_RESULTS;
      
      if (age > maxAge) {
        console.info(`Scan results expired (${Math.round(age / 60000)} min old)`);
        this.clearResults();
        return null;
      }
      
      // Add age info for display
      data._cacheAge = age;
      data._cacheAgeMinutes = Math.round(age / 60000);
      
      return data;
      
    } catch (e) {
      console.error('Failed to parse cached results:', e);
      this.clearResults();
      return null;
    }
  },
  
  /**
   * Save scan results with timestamp
   * @param {Object} results - Scan results to cache
   */
  saveResults(results) {
    const data = {
      ...results,
      timestamp: new Date().toISOString(),
      cachedAt: Date.now(),
    };
    
    try {
      localStorage.setItem('scanResults', JSON.stringify(data));
    } catch (e) {
      // Handle quota exceeded
      if (e.name === 'QuotaExceededError') {
        console.warn('Storage quota exceeded, clearing old data');
        this.clearOldData();
        localStorage.setItem('scanResults', JSON.stringify(data));
      } else {
        console.error('Failed to save results:', e);
      }
    }
  },
  
  /**
   * Clear cached scan results
   */
  clearResults() {
    localStorage.removeItem('scanResults');
  },
  
  /**
   * Check if cached results exist and are fresh
   * @returns {Object} { exists: boolean, fresh: boolean, ageMinutes: number }
   */
  checkResultsStatus() {
    const raw = localStorage.getItem('scanResults');
    if (!raw) {
      return { exists: false, fresh: false, ageMinutes: 0 };
    }
    
    try {
      const data = JSON.parse(raw);
      const age = Date.now() - new Date(data.timestamp).getTime();
      const ageMinutes = Math.round(age / 60000);
      const fresh = age <= this.TTL.SCAN_RESULTS;
      
      return { exists: true, fresh, ageMinutes };
    } catch {
      return { exists: false, fresh: false, ageMinutes: 0 };
    }
  },
  
  // ════════════════════════════════════════════════════════════════
  // USER SETTINGS (longer TTL)
  // ════════════════════════════════════════════════════════════════
  
  /**
   * Get user settings from cache
   */
  getSettings() {
    const raw = localStorage.getItem('userSettings');
    if (!raw) return null;
    
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  },
  
  /**
   * Save user settings
   */
  saveSettings(settings) {
    try {
      localStorage.setItem('userSettings', JSON.stringify({
        ...settings,
        savedAt: Date.now(),
      }));
    } catch (e) {
      console.error('Failed to save settings:', e);
    }
  },
  
  // ════════════════════════════════════════════════════════════════
  // WATCHLIST (long TTL)
  // ════════════════════════════════════════════════════════════════
  
  /**
   * Get watchlist from cache
   */
  getWatchlist() {
    const raw = localStorage.getItem('watchlist');
    if (!raw) return [];
    
    try {
      return JSON.parse(raw);
    } catch {
      return [];
    }
  },
  
  /**
   * Save watchlist
   */
  saveWatchlist(symbols) {
    try {
      localStorage.setItem('watchlist', JSON.stringify(symbols));
    } catch (e) {
      console.error('Failed to save watchlist:', e);
    }
  },
  
  // ════════════════════════════════════════════════════════════════
  // GENERIC METHODS
  // ════════════════════════════════════════════════════════════════
  
  /**
   * Get item with TTL check
   * @param {string} key - Storage key
   * @param {number} maxAgeMs - Max age in milliseconds
   */
  getWithTTL(key, maxAgeMs) {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    
    try {
      const data = JSON.parse(raw);
      const savedAt = data.savedAt || data.cachedAt || data.timestamp;
      
      if (!savedAt) return data; // No timestamp, return as-is
      
      const age = Date.now() - new Date(savedAt).getTime();
      if (age > maxAgeMs) {
        localStorage.removeItem(key);
        return null;
      }
      
      return data;
    } catch {
      return null;
    }
  },
  
  /**
   * Set item with timestamp
   */
  setWithTimestamp(key, value) {
    try {
      const data = typeof value === 'object' 
        ? { ...value, savedAt: Date.now() }
        : { value, savedAt: Date.now() };
      localStorage.setItem(key, JSON.stringify(data));
    } catch (e) {
      console.error(`Failed to save ${key}:`, e);
    }
  },
  
  /**
   * Clear old/expired data to free up space
   */
  clearOldData() {
    const keysToCheck = ['scanResults', 'oldScans', 'debugLogs'];
    keysToCheck.forEach(key => {
      try {
        localStorage.removeItem(key);
      } catch {
        // Ignore errors
      }
    });
  },
  
  /**
   * Get storage usage info
   */
  getStorageInfo() {
    let total = 0;
    const items = {};
    
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      const value = localStorage.getItem(key);
      const size = new Blob([value]).size;
      items[key] = size;
      total += size;
    }
    
    return {
      totalBytes: total,
      totalKB: Math.round(total / 1024),
      items,
    };
  },
};


// ═══════════════════════════════════════════════════════════════════════════════
// UI INTEGRATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Add cache status indicator to UI
 */
function updateCacheStatusUI() {
  const statusEl = document.getElementById('cache-status');
  if (!statusEl) return;
  
  const status = Storage.checkResultsStatus();
  
  if (!status.exists) {
    statusEl.textContent = 'No cached data';
    statusEl.className = 'cache-status empty';
  } else if (status.fresh) {
    statusEl.textContent = `Updated ${status.ageMinutes}m ago`;
    statusEl.className = 'cache-status fresh';
  } else {
    statusEl.textContent = `Expired (${status.ageMinutes}m ago)`;
    statusEl.className = 'cache-status expired';
  }
}

// Call on page load and after scans
document.addEventListener('DOMContentLoaded', updateCacheStatusUI);


// ═══════════════════════════════════════════════════════════════════════════════
// HTML FOR CACHE STATUS (add to index.html)
// ═══════════════════════════════════════════════════════════════════════════════

/*
<!-- Add near scan button -->
<div class="scan-controls">
  <button id="scan-btn">Scan Markets</button>
  <span id="cache-status" class="cache-status"></span>
</div>
*/


// ═══════════════════════════════════════════════════════════════════════════════
// CSS FOR CACHE STATUS (add to styles.css)
// ═══════════════════════════════════════════════════════════════════════════════

/*
.cache-status {
  font-size: 0.75rem;
  padding: 4px 8px;
  border-radius: 4px;
  margin-left: 10px;
}

.cache-status.fresh {
  color: var(--accent-green);
  background: rgba(46, 204, 113, 0.1);
}

.cache-status.expired {
  color: var(--accent-amber);
  background: rgba(241, 196, 15, 0.1);
}

.cache-status.empty {
  color: var(--text-muted);
}
*/


// ═══════════════════════════════════════════════════════════════════════════════
// USAGE EXAMPLE IN APP.JS
// ═══════════════════════════════════════════════════════════════════════════════

/*
// In App.loadResults():

async loadResults() {
  // Try cache first
  const cached = Storage.getResults();
  
  if (cached) {
    console.log(`Using cached results (${cached._cacheAgeMinutes}m old)`);
    this.displayResults(cached.results);
    return;
  }
  
  // Cache expired or missing - fetch fresh
  console.log('Cache expired, fetching fresh results');
  await this.runScan();
}

// After scan completes:
async runScan() {
  const results = await this.api.scan(this.settings);
  
  // Save to cache with timestamp
  Storage.saveResults({
    results,
    strategyId: this.settings.strategyId,
    style: this.settings.style,
  });
  
  // Update UI
  this.displayResults(results);
  updateCacheStatusUI();
}
*/
