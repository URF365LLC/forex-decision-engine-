/**
 * Storage Service
 * localStorage wrapper for persisting settings
 */

const Storage = {
  KEYS: {
    SETTINGS: 'fde_settings',
    WATCHLIST: 'fde_watchlist',
    FIRST_VISIT: 'fde_first_visit',
    RESULTS: 'fde_results',
  },
  
  TTL: {
    SCAN_RESULTS: 15 * 60 * 1000,  // 15 minutes
  },

  /**
   * Get item from localStorage
   */
  get(key, defaultValue = null) {
    try {
      const item = localStorage.getItem(key);
      return item ? JSON.parse(item) : defaultValue;
    } catch {
      return defaultValue;
    }
  },

  /**
   * Set item in localStorage
   */
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (error) {
      console.error('Storage error:', error);
      return false;
    }
  },

  /**
   * Remove item from localStorage
   */
  remove(key) {
    localStorage.removeItem(key);
  },

  /**
   * Get settings
   */
  getSettings() {
    const defaults = {
      accountSize: 10000,
      riskPercent: 0.5,
      style: 'intraday',
      timezone: 'America/Chicago',
      paperTrading: true,  // Default to paper trading during development
    };
    const saved = this.get(this.KEYS.SETTINGS, {});
    // Merge saved settings with defaults (ensures paperTrading is always set)
    return { ...defaults, ...saved, paperTrading: saved.paperTrading ?? true };
  },

  /**
   * Save settings
   */
  saveSettings(settings) {
    return this.set(this.KEYS.SETTINGS, settings);
  },

  /**
   * Get watchlist
   */
  getWatchlist() {
    return this.get(this.KEYS.WATCHLIST, ['EURUSD', 'GBPUSD', 'USDJPY', 'BTCUSD', 'ETHUSD']);
  },

  /**
   * Save watchlist
   */
  saveWatchlist(symbols) {
    return this.set(this.KEYS.WATCHLIST, symbols);
  },

  /**
   * Check if first visit
   */
  isFirstVisit() {
    return !this.get(this.KEYS.FIRST_VISIT, false);
  },

  /**
   * Mark as visited
   */
  markVisited() {
    return this.set(this.KEYS.FIRST_VISIT, true);
  },

  /**
   * Get cached results with TTL check
   */
  getResults() {
    try {
      const raw = localStorage.getItem(this.KEYS.RESULTS);
      if (!raw) return [];
      
      const data = JSON.parse(raw);
      
      if (!data.timestamp) {
        console.warn('Scan results missing timestamp, clearing cache');
        this.clearResults();
        return [];
      }
      
      const age = Date.now() - new Date(data.timestamp).getTime();
      
      if (age > this.TTL.SCAN_RESULTS) {
        console.info(`Scan results expired (${Math.round(age / 60000)} min old)`);
        this.clearResults();
        return [];
      }
      
      data._cacheAge = age;
      data._cacheAgeMinutes = Math.round(age / 60000);
      
      return data.results || [];
    } catch {
      this.clearResults();
      return [];
    }
  },

  /**
   * Save results with timestamp
   */
  saveResults(results) {
    const data = {
      results,
      timestamp: new Date().toISOString(),
      cachedAt: Date.now(),
    };
    return this.set(this.KEYS.RESULTS, data);
  },
  
  /**
   * Clear cached results
   */
  clearResults() {
    this.remove(this.KEYS.RESULTS);
  },
  
  /**
   * Check if cached results exist and are fresh
   */
  checkResultsStatus() {
    try {
      const raw = localStorage.getItem(this.KEYS.RESULTS);
      if (!raw) {
        return { exists: false, fresh: false, ageMinutes: 0 };
      }
      
      const data = JSON.parse(raw);
      const age = Date.now() - new Date(data.timestamp).getTime();
      const ageMinutes = Math.round(age / 60000);
      const fresh = age <= this.TTL.SCAN_RESULTS;
      
      return { exists: true, fresh, ageMinutes };
    } catch {
      return { exists: false, fresh: false, ageMinutes: 0 };
    }
  },

  /**
   * Clear all data
   */
  clearAll() {
    Object.values(this.KEYS).forEach(key => this.remove(key));
  },
};

// Export for use in other scripts
window.Storage = Storage;
