/**
 * Main Application
 * Orchestrates all functionality
 */

const App = {
  // State
  universe: { forex: [], crypto: [] },
  selectedSymbols: [],
  results: [],
  currentFilter: 'all',

  /**
   * Initialize the application
   */
  async init() {
    console.log('🎯 Forex Decision Engine initializing...');

    // Check for first visit
    if (Storage.isFirstVisit()) {
      this.showWelcome();
    } else {
      UI.hide('welcome-screen');
      UI.show('results-screen');
    }

    // Load universe
    await this.loadUniverse();

    // Load saved state
    this.loadSettings();
    this.loadWatchlist();
    this.loadResults();

    // Setup event listeners
    this.setupEventListeners();

    // Check API health
    this.checkHealth();

    console.log('✅ Application initialized');
  },

  /**
   * Show welcome screen
   */
  showWelcome() {
    UI.hide('results-screen');
    UI.show('welcome-screen');
  },

  /**
   * Complete onboarding
   */
  completeOnboarding() {
    Storage.markVisited();
    UI.hide('welcome-screen');
    UI.switchScreen('settings');
  },

  /**
   * Load trading universe from API
   */
  async loadUniverse() {
    try {
      const data = await API.getUniverse();
      this.universe = {
        forex: data.forex || [],
        crypto: data.crypto || [],
      };
      
      // Render symbol grids
      UI.renderSymbolGrid('forex-symbols', this.universe.forex, this.selectedSymbols);
      UI.renderSymbolGrid('crypto-symbols', this.universe.crypto, this.selectedSymbols);
    } catch (error) {
      console.error('Failed to load universe:', error);
      UI.toast('Failed to load symbols', 'error');
    }
  },

  /**
   * Load settings from storage
   */
  loadSettings() {
    const settings = Storage.getSettings();
    
    UI.$('account-size').value = settings.accountSize;
    UI.$('risk-percent').value = settings.riskPercent;
    UI.$('timezone').value = settings.timezone;
    
    // Set trading style radio
    const styleRadio = document.querySelector(`input[name="style"][value="${settings.style}"]`);
    if (styleRadio) styleRadio.checked = true;

    this.updateRiskHint();
  },

  /**
   * Save settings
   */
  saveSettings() {
    const settings = {
      accountSize: parseFloat(UI.$('account-size').value) || 10000,
      riskPercent: parseFloat(UI.$('risk-percent').value) || 0.5,
      style: document.querySelector('input[name="style"]:checked')?.value || 'intraday',
      timezone: UI.$('timezone').value || 'America/Chicago',
    };

    // Validate
    if (settings.accountSize < 100 || settings.accountSize > 1000000) {
      UI.toast('Account size must be between $100 and $1,000,000', 'error');
      return false;
    }

    Storage.saveSettings(settings);
    UI.toast('Settings saved', 'success');
    return true;
  },

  /**
   * Update risk amount hint
   */
  updateRiskHint() {
    const accountSize = parseFloat(UI.$('account-size').value) || 10000;
    const riskPercent = parseFloat(UI.$('risk-percent').value) || 0.5;
    const riskAmount = (accountSize * riskPercent / 100).toFixed(0);
    UI.$('risk-amount-hint').textContent = `Risk: $${riskAmount} per trade`;
  },

  /**
   * Load watchlist from storage
   */
  loadWatchlist() {
    this.selectedSymbols = Storage.getWatchlist();
    this.updateSymbolSelection();
  },

  /**
   * Save watchlist
   */
  saveWatchlist() {
    Storage.saveWatchlist(this.selectedSymbols);
  },

  /**
   * Update symbol selection UI
   */
  updateSymbolSelection() {
    // Update checkboxes
    UI.$$('.symbol-item').forEach(item => {
      const symbol = item.dataset.symbol;
      const isSelected = this.selectedSymbols.includes(symbol);
      item.classList.toggle('selected', isSelected);
      item.querySelector('input').checked = isSelected;
    });

    UI.updateSelectionCount(this.selectedSymbols.length);
  },

  /**
   * Toggle symbol selection
   */
  toggleSymbol(symbol) {
    const index = this.selectedSymbols.indexOf(symbol);
    if (index === -1) {
      if (this.selectedSymbols.length >= 20) {
        UI.toast('Maximum 20 symbols per scan', 'error');
        return;
      }
      this.selectedSymbols.push(symbol);
    } else {
      this.selectedSymbols.splice(index, 1);
    }
    this.updateSymbolSelection();
    this.saveWatchlist();
  },

  /**
   * Select all symbols in category
   */
  selectCategory(category) {
    const symbols = category === 'forex' ? this.universe.forex : this.universe.crypto;
    const allSelected = symbols.every(s => this.selectedSymbols.includes(s));

    if (allSelected) {
      // Deselect all in category
      this.selectedSymbols = this.selectedSymbols.filter(s => !symbols.includes(s));
    } else {
      // Select all in category (up to limit)
      for (const symbol of symbols) {
        if (!this.selectedSymbols.includes(symbol)) {
          if (this.selectedSymbols.length >= 20) {
            UI.toast('Maximum 20 symbols reached', 'error');
            break;
          }
          this.selectedSymbols.push(symbol);
        }
      }
    }

    this.updateSymbolSelection();
    this.saveWatchlist();
  },

  /**
   * Clear all selections
   */
  clearSelection() {
    this.selectedSymbols = [];
    this.updateSymbolSelection();
    this.saveWatchlist();
  },

  /**
   * Search symbols
   */
  searchSymbols(query) {
    const q = query.toUpperCase().trim();
    
    UI.$$('.symbol-item').forEach(item => {
      const symbol = item.dataset.symbol;
      const matches = !q || symbol.includes(q);
      item.style.display = matches ? '' : 'none';
    });
  },

  /**
   * Load results from storage
   */
  loadResults() {
    this.results = Storage.getResults();
    UI.renderResults(this.results, this.currentFilter);
    
    if (this.results.length > 0) {
      const lastScan = new Date(this.results[0].timestamp);
      UI.$('last-scan-time').textContent = `Last scan: ${lastScan.toLocaleString()}`;
      UI.$('refresh-btn').disabled = false;
    }
  },

  /**
   * Run scan
   */
  async runScan() {
    if (this.selectedSymbols.length === 0) {
      UI.toast('Select at least one symbol', 'error');
      return;
    }

    const settings = Storage.getSettings();
    
    UI.showLoading('Starting scan...');

    try {
      const response = await API.scan(this.selectedSymbols, settings);
      
      this.results = response.decisions;
      Storage.saveResults(this.results);

      const trades = this.results.filter(d => d.grade !== 'no-trade').length;
      UI.toast(`Scan complete: ${trades} trade signals found`, 'success');

      // Update UI
      UI.$('last-scan-time').textContent = `Last scan: ${new Date().toLocaleString()}`;
      UI.$('refresh-btn').disabled = false;
      
      // Switch to results screen
      UI.switchScreen('results');
      UI.renderResults(this.results, this.currentFilter);

    } catch (error) {
      console.error('Scan error:', error);
      UI.toast(`Scan failed: ${error.message}`, 'error');
    } finally {
      UI.hideLoading();
    }
  },

  /**
   * Refresh results
   */
  async refresh() {
    await this.runScan();
  },

  /**
   * Filter results
   */
  filterResults(filter) {
    this.currentFilter = filter;
    
    UI.$$('.filter-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.filter === filter);
    });

    UI.renderResults(this.results, filter);
  },

  /**
   * Switch screen
   */
  switchScreen(screen) {
    UI.switchScreen(screen);
  },

  /**
   * Copy signal to clipboard
   */
  async copySignal(symbol) {
    const decision = this.results.find(d => d.symbol === symbol);
    if (!decision) return;

    const text = this.formatSignalText(decision);
    
    try {
      await navigator.clipboard.writeText(text);
      UI.toast('Signal copied to clipboard', 'success');
    } catch {
      UI.toast('Failed to copy', 'error');
    }
  },

  /**
   * Format signal as text
   */
  formatSignalText(d) {
    const dir = d.direction.toUpperCase();
    const lines = [
      `${d.displayName} ${dir} ${d.grade}`,
      `Entry: ${d.entryZone?.formatted || '—'}`,
      `SL: ${d.stopLoss?.formatted || '—'}`,
      `TP: ${d.takeProfit?.formatted || '—'}`,
      `Size: ${d.position?.lots || '—'} lots`,
      `"${d.reason}"`,
      `${d.timeframes.trend}/${d.timeframes.entry}`,
    ];
    return lines.join('\n');
  },

  /**
   * Export results as JSON
   */
  exportJSON() {
    const data = JSON.stringify(this.results, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `scan-results-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    
    URL.revokeObjectURL(url);
    UI.toast('Results exported', 'success');
  },

  /**
   * Copy summary to clipboard
   */
  async copySummary() {
    const trades = this.results.filter(d => d.grade !== 'no-trade');
    const summary = trades.map(d => {
      const dir = d.direction.toUpperCase();
      return `${d.displayName}: ${dir} ${d.grade}`;
    }).join('\n');

    try {
      await navigator.clipboard.writeText(summary || 'No trade signals');
      UI.toast('Summary copied', 'success');
    } catch {
      UI.toast('Failed to copy', 'error');
    }
  },

  /**
   * Check API health
   */
  async checkHealth() {
    try {
      const health = await API.health();
      if (!health.apiKeyConfigured) {
        UI.toast('⚠️ API key not configured', 'error', 5000);
      }
    } catch (error) {
      UI.toast('Cannot connect to server', 'error');
    }
  },

  /**
   * Setup event listeners
   */
  setupEventListeners() {
    // Navigation
    UI.$$('.nav-btn').forEach(btn => {
      btn.addEventListener('click', () => this.switchScreen(btn.dataset.screen));
    });

    // Welcome screen
    UI.$('get-started-btn')?.addEventListener('click', () => this.completeOnboarding());

    // Settings form
    UI.$('settings-form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      if (this.saveSettings()) {
        UI.switchScreen('watchlist');
      }
    });

    // Risk hint update
    UI.$('account-size')?.addEventListener('input', () => this.updateRiskHint());
    UI.$('risk-percent')?.addEventListener('change', () => this.updateRiskHint());

    // Watchlist
    UI.$('forex-symbols')?.addEventListener('click', (e) => {
      const item = e.target.closest('.symbol-item');
      if (item) this.toggleSymbol(item.dataset.symbol);
    });

    UI.$('crypto-symbols')?.addEventListener('click', (e) => {
      const item = e.target.closest('.symbol-item');
      if (item) this.toggleSymbol(item.dataset.symbol);
    });

    UI.$$('[data-select]').forEach(btn => {
      btn.addEventListener('click', () => this.selectCategory(btn.dataset.select));
    });

    UI.$('clear-selection-btn')?.addEventListener('click', () => this.clearSelection());
    UI.$('scan-btn')?.addEventListener('click', () => this.runScan());
    UI.$('symbol-search')?.addEventListener('input', (e) => this.searchSymbols(e.target.value));

    // Results
    UI.$$('.filter-btn').forEach(btn => {
      btn.addEventListener('click', () => this.filterResults(btn.dataset.filter));
    });

    UI.$('refresh-btn')?.addEventListener('click', () => this.refresh());
    UI.$('export-btn')?.addEventListener('click', () => this.exportJSON());
    UI.$('copy-summary-btn')?.addEventListener('click', () => this.copySummary());

    // Go to watchlist from empty results
    document.addEventListener('click', (e) => {
      if (e.target.id === 'go-to-watchlist-btn') {
        this.switchScreen('watchlist');
      }
    });
  },
};

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => App.init());

// Export for global access
window.App = App;
