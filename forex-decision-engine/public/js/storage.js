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
    return this.get(this.KEYS.SETTINGS, {
      accountSize: 10000,
      riskPercent: 0.5,
      style: 'intraday',
      timezone: 'America/Chicago',
    });
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
   * Get cached results
   */
  getResults() {
    return this.get(this.KEYS.RESULTS, []);
  },

  /**
   * Save results
   */
  saveResults(results) {
    return this.set(this.KEYS.RESULTS, results);
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
