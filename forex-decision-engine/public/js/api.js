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
};

// Export for use in other scripts
window.API = API;
