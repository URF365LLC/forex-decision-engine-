/**
 * API Client
 * Handles all communication with the backend
 */

const API = {
  baseUrl: '',

  /**
   * Make API request
   */
  async request(endpoint, options = {}) {
    const url = `${this.baseUrl}${endpoint}`;
    
    const config = {
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      ...options,
    };

    if (config.body && typeof config.body === 'object') {
      config.body = JSON.stringify(config.body);
    }

    try {
      const response = await fetch(url, config);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || `HTTP ${response.status}`);
      }

      return data;
    } catch (error) {
      console.error(`API Error [${endpoint}]:`, error);
      throw error;
    }
  },

  /**
   * Health check
   */
  async health() {
    return this.request('/api/health');
  },

  /**
   * Get trading universe
   */
  async getUniverse() {
    return this.request('/api/universe');
  },

  /**
   * Get system status
   */
  async getStatus() {
    return this.request('/api/status');
  },

  /**
   * Get default settings
   */
  async getDefaults() {
    return this.request('/api/settings/defaults');
  },

  /**
   * Analyze single symbol
   */
  async analyze(symbol, settings) {
    return this.request('/api/analyze', {
      method: 'POST',
      body: { symbol, settings },
    });
  },

  /**
   * Scan multiple symbols
   */
  async scan(symbols, settings) {
    return this.request('/api/scan', {
      method: 'POST',
      body: { symbols, settings },
    });
  },

  /**
   * Get signal history
   */
  async getSignals(options = {}) {
    const params = new URLSearchParams();
    if (options.limit) params.set('limit', options.limit);
    if (options.grade) params.set('grade', options.grade);
    if (options.symbol) params.set('symbol', options.symbol);
    
    const query = params.toString();
    return this.request(`/api/signals${query ? '?' + query : ''}`);
  },

  /**
   * Update signal result
   */
  async updateSignalResult(id, result, notes) {
    return this.request(`/api/signals/${id}`, {
      method: 'PUT',
      body: { result, notes },
    });
  },

  /**
   * Get signal statistics
   */
  async getSignalStats() {
    return this.request('/api/signals/stats');
  },

  // ═══════════════════════════════════════════════════════════════
  // JOURNAL API
  // ═══════════════════════════════════════════════════════════════

  /**
   * Add journal entry
   */
  async addJournalEntry(entry) {
    return this.request('/api/journal', {
      method: 'POST',
      body: entry,
    });
  },

  /**
   * Get journal entries
   */
  async getJournalEntries(filters = {}) {
    const params = new URLSearchParams();
    if (filters.symbol) params.set('symbol', filters.symbol);
    if (filters.status) params.set('status', filters.status);
    if (filters.result) params.set('result', filters.result);
    if (filters.action) params.set('action', filters.action);
    if (filters.dateFrom) params.set('dateFrom', filters.dateFrom);
    if (filters.dateTo) params.set('dateTo', filters.dateTo);
    
    const query = params.toString();
    return this.request(`/api/journal${query ? '?' + query : ''}`);
  },

  /**
   * Get single journal entry
   */
  async getJournalEntry(id) {
    return this.request(`/api/journal/${id}`);
  },

  /**
   * Update journal entry
   */
  async updateJournalEntry(id, updates) {
    return this.request(`/api/journal/${id}`, {
      method: 'PUT',
      body: updates,
    });
  },

  /**
   * Delete journal entry
   */
  async deleteJournalEntry(id) {
    return this.request(`/api/journal/${id}`, {
      method: 'DELETE',
    });
  },

  /**
   * Get journal statistics
   */
  async getJournalStats(dateFrom, dateTo) {
    const params = new URLSearchParams();
    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo) params.set('dateTo', dateTo);
    
    const query = params.toString();
    return this.request(`/api/journal/stats${query ? '?' + query : ''}`);
  },
};

// Export for use in other scripts
window.API = API;
