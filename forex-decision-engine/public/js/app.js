/**
 * Main Application
 * Orchestrates all functionality
 */

const App = {
  // State
  universe: { forex: [], metals: [], indices: [], commodities: [], crypto: [] },
  selectedSymbols: [],
  results: [],
  currentFilter: 'all',
  isScanning: false,
  journalEntries: [],
  journalFilter: 'all',
  currentTradeData: null,
  selectedStrategy: localStorage.getItem('selectedStrategy') || 'ema-pullback-intra',
  strategies: [],
  upgradeEventSource: null,

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
      UI.show('dashboard-screen');
    }

    // Load universe
    await this.loadUniverse();

    // Load saved state
    this.loadSettings();
    this.loadWatchlist();
    this.loadResults();
    
    // Load strategies
    await this.loadStrategyOptions();

    // Setup event listeners
    this.setupEventListeners();

    // Setup keyboard navigation
    this.setupKeyboardNavigation();

    // Setup detection filters
    this.setupDetectionFilters();

    // Check API health
    this.checkHealth();

    // Connect to upgrade notifications
    this.connectUpgradeStream();

    // Load initial detection badge count
    this.loadDetections();

    console.log('✅ Application initialized');
  },
  
  // SSE reconnection state
  sseReconnectAttempts: 0,
  sseMaxReconnectDelay: 60000, // 1 minute max
  sseBaseDelay: 1000, // 1 second base
  sseHeartbeatTimeout: null,
  
  /**
   * Connect to SSE stream for grade upgrade notifications
   * Uses exponential backoff for reconnection
   */
  connectUpgradeStream() {
    if (this.upgradeEventSource) {
      this.upgradeEventSource.close();
    }
    
    // Clear any existing heartbeat timeout
    if (this.sseHeartbeatTimeout) {
      clearTimeout(this.sseHeartbeatTimeout);
    }
    
    this.upgradeEventSource = new EventSource('/api/upgrades/stream');
    
    this.upgradeEventSource.onopen = () => {
      // Reset reconnect attempts on successful connection
      this.sseReconnectAttempts = 0;
    };
    
    this.upgradeEventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'upgrade') {
          this.showUpgradeNotification(data.upgrade);
        } else if (data.type === 'heartbeat') {
          // Heartbeat received, connection is healthy
          this.resetSseHeartbeatTimer();
        }
      } catch (e) {
        // Silently ignore parse errors for non-JSON messages (like heartbeats)
      }
    };
    
    this.upgradeEventSource.onerror = () => {
      // Close the connection
      this.upgradeEventSource.close();
      
      // Calculate delay with exponential backoff + jitter
      const delay = Math.min(
        this.sseBaseDelay * Math.pow(2, this.sseReconnectAttempts) + Math.random() * 1000,
        this.sseMaxReconnectDelay
      );
      
      this.sseReconnectAttempts++;
      
      // Only log after several failed attempts
      if (this.sseReconnectAttempts > 3) {
        console.debug(`SSE reconnecting in ${Math.round(delay/1000)}s (attempt ${this.sseReconnectAttempts})`);
      }
      
      setTimeout(() => this.connectUpgradeStream(), delay);
    };
    
    // Start heartbeat monitoring
    this.resetSseHeartbeatTimer();
  },
  
  /**
   * Reset SSE heartbeat timer
   */
  resetSseHeartbeatTimer() {
    if (this.sseHeartbeatTimeout) {
      clearTimeout(this.sseHeartbeatTimeout);
    }
    // If no heartbeat received in 45 seconds, reconnect
    this.sseHeartbeatTimeout = setTimeout(() => {
      if (this.upgradeEventSource) {
        this.upgradeEventSource.close();
        this.connectUpgradeStream();
      }
    }, 45000);
  },
  
  /**
   * Show upgrade notification in UI
   */
  showUpgradeNotification(upgrade) {
    const container = document.getElementById('upgrade-notifications');
    if (!container) return;
    
    const icon = upgrade.upgradeType === 'new-signal' ? '🆕' 
               : upgrade.upgradeType === 'grade-improvement' ? '⬆️' 
               : '🔄';
    
    const notification = document.createElement('div');
    notification.className = `upgrade-notification ${upgrade.upgradeType}`;
    notification.innerHTML = `
      <span class="upgrade-notification-icon">${icon}</span>
      <div class="upgrade-notification-content">
        <div class="upgrade-notification-symbol">${upgrade.symbol}</div>
        <div class="upgrade-notification-message">${upgrade.message}</div>
      </div>
      <button class="upgrade-notification-close" onclick="this.parentElement.remove()">×</button>
    `;
    
    container.appendChild(notification);
    
    // Auto-remove after 10 seconds
    setTimeout(() => {
      if (notification.parentElement) {
        notification.style.animation = 'slideOut 0.3s ease-out forwards';
        setTimeout(() => notification.remove(), 300);
      }
    }, 10000);
  },
  
  /**
   * Load strategy options based on current trading style
   */
  async loadStrategyOptions() {
    const settings = Storage.getSettings();
    const dropdown = UI.$('strategy-select');
    if (!dropdown) return;
    
    try {
      const response = await fetch(`/api/strategies?style=${settings.style}`);
      const strategies = await response.json();
      this.strategies = strategies;
      
      dropdown.innerHTML = strategies.map(s => 
        `<option value="${s.id}">${s.name} (${s.winRate}% WR)</option>`
      ).join('');
      
      // Restore saved selection or use first option
      const saved = localStorage.getItem('selectedStrategy');
      const validSelection = strategies.find(s => s.id === saved);
      this.selectedStrategy = validSelection ? saved : (strategies[0]?.id || 'ema-pullback-intra');
      dropdown.value = this.selectedStrategy;
      
    } catch (error) {
      console.error('Failed to load strategies:', error);
    }
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
        metals: data.metals || [],
        indices: data.indices || [],
        commodities: data.commodities || [],
        crypto: data.crypto || [],
      };
      this.metadata = data.metadata || {};
      
      // Render legacy symbol grids (if containers exist)
      UI.renderSymbolGrid('forex-symbols', this.universe.forex, this.selectedSymbols, this.metadata);
      UI.renderSymbolGrid('metals-symbols', this.universe.metals, this.selectedSymbols, this.metadata);
      UI.renderSymbolGrid('indices-symbols', this.universe.indices, this.selectedSymbols, this.metadata);
      UI.renderSymbolGrid('commodities-symbols', this.universe.commodities, this.selectedSymbols, this.metadata);
      UI.renderSymbolGrid('crypto-symbols', this.universe.crypto, this.selectedSymbols, this.metadata);
      
      // Render new Bloomberg-style watchlist sidebar
      this.renderDashboardWatchlist();
    } catch (error) {
      console.error('Failed to load universe:', error);
      UI.toast('Failed to load symbols', 'error');
    }
  },
  
  /**
   * Render dashboard watchlist sidebar
   */
  renderDashboardWatchlist() {
    // Build signal map from current results
    const signalMap = {};
    for (const decision of this.results) {
      if (decision.grade !== 'no-trade') {
        signalMap[decision.symbol] = decision;
      }
    }
    
    // Render each asset class
    UI.renderWatchlistSidebar('forex-watchlist', this.universe.forex, this.selectedSymbols, signalMap);
    UI.renderWatchlistSidebar('metals-watchlist', this.universe.metals, this.selectedSymbols, signalMap);
    UI.renderWatchlistSidebar('indices-watchlist', this.universe.indices, this.selectedSymbols, signalMap);
    UI.renderWatchlistSidebar('commodities-watchlist', this.universe.commodities, this.selectedSymbols, signalMap);
    UI.renderWatchlistSidebar('crypto-watchlist', this.universe.crypto, this.selectedSymbols, signalMap);
    
    // Add event listeners for watchlist items
    this.setupWatchlistEventListeners();
  },
  
  /**
   * Setup watchlist item event listeners
   */
  setupWatchlistEventListeners() {
    const containers = ['forex-watchlist', 'metals-watchlist', 'indices-watchlist', 'commodities-watchlist', 'crypto-watchlist'];
    
    for (const containerId of containers) {
      const container = UI.$(containerId);
      if (!container) continue;
      
      container.addEventListener('click', (e) => {
        const item = e.target.closest('.watchlist-item-compact');
        if (!item) return;
        
        const symbol = item.dataset.symbol;
        if (symbol) {
          // toggleSymbol handles state update AND calls updateSymbolSelection for UI sync
          this.toggleSymbol(symbol);
        }
      });
    }
  },

  /**
   * Load settings from storage
   */
  loadSettings() {
    const settings = Storage.getSettings();
    
    // Update form inputs if they exist
    const accountSizeInput = UI.$('account-size');
    const riskPercentInput = UI.$('risk-percent');
    const timezoneInput = UI.$('timezone');
    
    if (accountSizeInput) accountSizeInput.value = settings.accountSize;
    if (riskPercentInput) riskPercentInput.value = settings.riskPercent;
    if (timezoneInput) timezoneInput.value = settings.timezone;
    
    // Set trading mode radio
    const tradingModeRadio = document.querySelector(`input[name="trading-mode"][value="${settings.paperTrading ? 'paper' : 'live'}"]`);
    if (tradingModeRadio) tradingModeRadio.checked = true;
    
    // Set trading style radio
    const styleRadio = document.querySelector(`input[name="style"][value="${settings.style}"]`);
    if (styleRadio) styleRadio.checked = true;

    this.updateRiskHint();
    
    // Update ticker bar with account info
    this.updateTickerBar(settings);
  },
  
  /**
   * Update ticker bar with account info and stats
   */
  updateTickerBar(settings) {
    const tickerBalance = UI.$('ticker-balance');
    const tickerRisk = UI.$('ticker-risk');
    const tickerDailyLimit = UI.$('metric-daily-limit');
    const tickerMaxDD = UI.$('metric-max-dd');
    
    if (tickerBalance) tickerBalance.textContent = `$${settings.accountSize.toLocaleString()}`;
    if (tickerRisk) tickerRisk.textContent = `${settings.riskPercent}%`;
    
    // E8 Markets limits: 4% daily, 6% max drawdown
    if (tickerDailyLimit) tickerDailyLimit.textContent = `$${(settings.accountSize * 0.04).toFixed(0)}`;
    if (tickerMaxDD) tickerMaxDD.textContent = `$${(settings.accountSize * 0.06).toFixed(0)}`;
  },

  /**
   * Save settings
   */
  async saveSettings() {
    const settingsForm = UI.$('settings-form');
    if (!settingsForm) return false;
    
    const submitBtn = settingsForm.querySelector('button[type="submit"]');
    UI.setButtonLoading(submitBtn, true);
    
    try {
      const tradingMode = document.querySelector('input[name="trading-mode"]:checked')?.value || 'paper';
      const accountSizeEl = UI.$('account-size');
      const riskPercentEl = UI.$('risk-percent');
      const timezoneEl = UI.$('timezone');
      
      const settings = {
        accountSize: accountSizeEl ? parseFloat(accountSizeEl.value) || 10000 : 10000,
        riskPercent: riskPercentEl ? parseFloat(riskPercentEl.value) || 0.5 : 0.5,
        style: document.querySelector('input[name="style"]:checked')?.value || 'intraday',
        timezone: timezoneEl ? timezoneEl.value || 'America/Chicago' : 'America/Chicago',
        paperTrading: tradingMode === 'paper',
      };

      // Validate
      if (settings.accountSize < 100 || settings.accountSize > 1000000) {
        UI.toast('Account size must be between $100 and $1,000,000', 'error');
        return false;
      }

      Storage.saveSettings(settings);
      
      // Brief delay to show loading state
      await new Promise(r => setTimeout(r, 300));
      
      UI.toast('Settings saved successfully', 'success');
      return true;
    } finally {
      UI.setButtonLoading(submitBtn, false);
    }
  },

  /**
   * Update risk amount hint
   */
  updateRiskHint() {
    const accountSizeEl = UI.$('account-size');
    const riskPercentEl = UI.$('risk-percent');
    const hintEl = UI.$('risk-amount-hint');
    
    if (!accountSizeEl || !riskPercentEl || !hintEl) return;
    
    const accountSize = parseFloat(accountSizeEl.value) || 10000;
    const riskPercent = parseFloat(riskPercentEl.value) || 0.5;
    const riskAmount = (accountSize * riskPercent / 100).toFixed(0);
    hintEl.textContent = `Risk: $${riskAmount} per trade`;
  },

  /**
   * Get strategy name from cached strategies
   */
  getStrategyName(strategyId) {
    const select = UI.$('strategy-select');
    if (!select) return strategyId;
    const option = select.querySelector(`option[value="${strategyId}"]`);
    return option?.textContent || strategyId;
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
    // Update legacy symbol grid checkboxes
    UI.$$('.symbol-item').forEach(item => {
      const symbol = item.dataset.symbol;
      const isSelected = this.selectedSymbols.includes(symbol);
      item.classList.toggle('selected', isSelected);
      const checkbox = item.querySelector('input');
      if (checkbox) checkbox.checked = isSelected;
    });

    // Update Bloomberg-style watchlist sidebar items
    UI.$$('.watchlist-item-compact').forEach(item => {
      const symbol = item.dataset.symbol;
      const isSelected = this.selectedSymbols.includes(symbol);
      item.classList.toggle('selected', isSelected);
      const checkbox = item.querySelector('input[type="checkbox"]');
      if (checkbox) checkbox.checked = isSelected;
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
    const symbols = this.universe[category] || [];
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
    // Brief delay to show skeleton (storage is sync but this helps UX)
    setTimeout(() => {
      this.results = Storage.getResults();
      
      // Render using new table view if available
      UI.renderSignalsTable(this.results, this.currentFilter);
      // Also render legacy view if container exists
      UI.renderResults(this.results, this.currentFilter);
      
      if (this.results.length > 0) {
        const lastScan = new Date(this.results[0].timestamp);
        const lastScanTime = UI.$('last-scan-time');
        const refreshBtn = UI.$('refresh-btn');
        if (lastScanTime) lastScanTime.textContent = `Last scan: ${lastScan.toLocaleString()}`;
        if (refreshBtn) refreshBtn.disabled = false;
      }
    }, 100);
  },

  /**
   * Run scan
   */
  async runScan() {
    if (this.isScanning) {
      UI.toast('Scan already in progress', 'info');
      return;
    }
    
    if (this.selectedSymbols.length === 0) {
      UI.toast('Select at least one symbol', 'error');
      return;
    }

    this.isScanning = true;
    const scanBtn = UI.$('scan-btn');
    const refreshBtn = UI.$('refresh-btn');
    
    UI.setButtonLoading(scanBtn, true);
    if (refreshBtn) refreshBtn.disabled = true;
    
    const settings = Storage.getSettings();
    
    UI.showLoading('Starting scan...');

    try {
      const response = await API.scan(this.selectedSymbols, settings, this.selectedStrategy);
      
      this.results = response.decisions;
      Storage.saveResults(this.results);

      const trades = this.results.filter(d => d.grade !== 'no-trade').length;
      const gradeAPlus = this.results.filter(d => d.grade === 'A+').length;
      
      // Enhanced success message
      let successMsg = `Scan complete: ${trades} trade signal${trades !== 1 ? 's' : ''} found`;
      if (gradeAPlus > 0) {
        successMsg += ` (${gradeAPlus} A+)`;
      }
      UI.toast(successMsg, 'success');

      // Update UI
      const lastScanEl = UI.$('last-scan-time');
      if (lastScanEl) lastScanEl.textContent = `Last scan: ${new Date().toLocaleString()}`;
      
      // Update signals table (Bloomberg style)
      UI.switchScreen('dashboard');
      UI.renderSignalsTable(this.results, this.currentFilter);
      // Also update legacy results if container exists
      UI.renderResults(this.results, this.currentFilter);
      
      // Load market sentiment overview
      this.loadMarketOverview();

    } catch (error) {
      console.error('Scan error:', error);
      UI.toast(`Scan failed: ${error.message}`, 'error', 5000);
    } finally {
      this.isScanning = false;
      UI.setButtonLoading(scanBtn, false);
      if (scanBtn) scanBtn.disabled = this.selectedSymbols.length === 0;
      if (refreshBtn) refreshBtn.disabled = this.results.length === 0;
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
   * Refresh current screen based on active tab
   */
  async refreshCurrentScreen() {
    const refreshBtn = UI.$('refresh-btn');
    if (refreshBtn) {
      refreshBtn.disabled = true;
      refreshBtn.textContent = 'Refreshing...';
    }

    try {
      const activeScreen = document.querySelector('.nav-btn.active')?.dataset?.screen;
      
      switch (activeScreen) {
        case 'dashboard':
          await this.checkHealth();
          await this.loadJournal();
          await this.loadDetections();
          UI.toast('Dashboard refreshed', 'success');
          break;
        case 'auto-scan':
          await this.loadAutoScanStatus();
          await this.loadDetections();
          UI.toast('Auto-scan data refreshed', 'success');
          break;
        case 'journal':
          await this.loadJournal();
          UI.toast('Journal refreshed', 'success');
          break;
        case 'settings':
          this.loadSettings();
          UI.toast('Settings reloaded', 'success');
          break;
        default:
          await this.loadDetections();
          await this.checkHealth();
          UI.toast('Data refreshed', 'success');
      }
    } catch (error) {
      console.error('Refresh failed:', error);
      UI.toast('Refresh failed', 'error');
    } finally {
      if (refreshBtn) {
        refreshBtn.disabled = false;
        refreshBtn.textContent = 'Refresh';
      }
    }
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

    if (screen === 'journal') {
      this.loadJournal();
    } else if (screen === 'detections') {
      this.loadDetections();
      this.startDetectionRefresh();
    } else {
      // Stop detection refresh when leaving detections screen
      this.stopDetectionRefresh();
    }
  },

  /**
   * Copy signal to clipboard
   * @param {string} decisionKey - format: strategyId:symbol
   */
  async copySignal(decisionKey) {
    const decision = this.findDecisionByKey(decisionKey);
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
   * Find decision by compound key (strategyId:symbol)
   */
  findDecisionByKey(decisionKey) {
    const [strategyId, symbol] = decisionKey.split(':');
    return this.results.find(d => d.strategyId === strategyId && d.symbol === symbol);
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
  async exportJSON() {
    const btn = UI.$('export-btn');
    UI.setButtonLoading(btn, true);
    
    try {
      const data = JSON.stringify(this.results, null, 2);
      const blob = new Blob([data], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      
      const a = document.createElement('a');
      a.href = url;
      a.download = `scan-results-${new Date().toISOString().slice(0,10)}.json`;
      a.click();
      
      URL.revokeObjectURL(url);
      
      // Brief delay to show loading state
      await new Promise(r => setTimeout(r, 200));
      
      UI.toast('Results exported successfully', 'success');
    } catch (error) {
      UI.toast('Export failed', 'error');
    } finally {
      UI.setButtonLoading(btn, false);
    }
  },

  /**
   * Copy summary to clipboard
   */
  async copySummary() {
    const btn = UI.$('copy-summary-btn');
    UI.setButtonLoading(btn, true);
    
    try {
      const trades = this.results.filter(d => d.grade !== 'no-trade');
      const summary = trades.map(d => {
        const dir = d.direction.toUpperCase();
        return `${d.displayName}: ${dir} ${d.grade}`;
      }).join('\n');

      await navigator.clipboard.writeText(summary || 'No trade signals');
      UI.toast('Summary copied to clipboard', 'success');
    } catch {
      UI.toast('Failed to copy', 'error');
    } finally {
      UI.setButtonLoading(btn, false);
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

  // ═══════════════════════════════════════════════════════════════
  // SENTIMENT FUNCTIONALITY
  // ═══════════════════════════════════════════════════════════════

  sentimentCache: {},

  async fetchSentiment(symbol, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    // Find the button within the container
    const btn = container.querySelector('.btn-sentiment');

    if (this.sentimentCache[symbol]) {
      const cached = this.sentimentCache[symbol];
      const age = Date.now() - cached.fetchedAt;
      if (age < 5 * 60 * 1000) {
        container.innerHTML = UI.createSentimentBadge(cached.data);
        return;
      }
    }

    // Show loading state on button
    if (btn) {
      UI.setButtonLoading(btn, true);
    }
    container.innerHTML = `
      <div class="sentiment-loading-state">
        <span class="sentiment-spinner"></span>
        <span>Analyzing market sentiment...</span>
      </div>
    `;

    try {
      const response = await fetch(`/api/sentiment/${encodeURIComponent(symbol)}`);
      const data = await response.json();
      
      if (data.error) {
        container.innerHTML = `
          <div class="sentiment-error-state">
            <span>⚠️ ${data.error}</span>
            <button class="btn btn-small" onclick="App.fetchSentiment('${symbol}', '${containerId}')">Retry</button>
          </div>
        `;
        return;
      }
      
      if (data.rating) {
        this.sentimentCache[symbol] = { data: data, fetchedAt: Date.now() };
        container.innerHTML = UI.createSentimentBadge(data);
      } else {
        container.innerHTML = `
          <div class="sentiment-unavailable-state">
            <span>No sentiment data available</span>
            <button class="btn btn-small" onclick="App.fetchSentiment('${symbol}', '${containerId}')">Retry</button>
          </div>
        `;
      }
    } catch (error) {
      console.error('Sentiment fetch error:', error);
      container.innerHTML = `
        <div class="sentiment-error-state">
          <span>⚠️ Failed to fetch sentiment</span>
          <button class="btn btn-small" onclick="App.fetchSentiment('${symbol}', '${containerId}')">Retry</button>
        </div>
      `;
    }
  },

  // ═══════════════════════════════════════════════════════════════
  // JOURNAL FUNCTIONALITY
  // ═══════════════════════════════════════════════════════════════

  /**
   * Log trade from signal card
   * @param {string} decisionKey - format: strategyId:symbol
   */
  logTrade(decisionKey, action) {
    const decision = this.findDecisionByKey(decisionKey);
    if (!decision) {
      UI.toast('Signal not found', 'error');
      return;
    }

    if (action === 'taken') {
      this.openTradeModal(decision);
    } else {
      this.quickLogTrade(decision, action);
    }
  },

  /**
   * Quick log for skipped/missed trades
   */
  async quickLogTrade(decision, action) {
    try {
      const entry = {
        source: 'signal',
        symbol: decision.symbol,
        direction: decision.direction,
        style: decision.style,
        grade: decision.grade,
        // Strategy metadata (Phase 3)
        strategyId: decision.strategyId || this.selectedStrategy,
        strategyName: decision.strategyName || this.getStrategyName(this.selectedStrategy),
        confidence: decision.confidence,
        reasonCodes: decision.reasonCodes || [],
        tradeType: 'pullback',
        entryZoneLow: decision.entryZone?.low,
        entryZoneHigh: decision.entryZone?.high,
        entryPrice: decision.entryZone ? (decision.entryZone.low + decision.entryZone.high) / 2 : (decision.entryPrice || 0),
        stopLoss: decision.stopLoss?.price || 0,
        takeProfit: decision.takeProfit?.price || 0,
        lots: decision.position?.lots || 0,
        status: 'closed',
        action: action,
      };

      await API.addJournalEntry(entry);
      UI.toast(`Trade ${action}`, 'success');
    } catch (error) {
      UI.toast(`Failed to log trade: ${error.message}`, 'error');
    }
  },

  /**
   * Open trade modal
   */
  openTradeModal(decision) {
    this.currentTradeData = decision;

    const titleEl = UI.$('trade-modal-title');
    const symbolEl = UI.$('trade-symbol');
    const actionEl = UI.$('trade-action');
    const entryPriceEl = UI.$('trade-entry-price');
    const lotsEl = UI.$('trade-lots');
    const stopLossEl = UI.$('trade-stop-loss');
    const takeProfitEl = UI.$('trade-take-profit');
    const notesEl = UI.$('trade-notes');

    if (titleEl) titleEl.textContent = `Log Trade: ${decision.displayName} ${decision.direction.toUpperCase()}`;
    if (symbolEl) symbolEl.value = decision.symbol;
    if (actionEl) actionEl.value = 'taken';
    
    const entryMid = decision.entryZone ? (decision.entryZone.low + decision.entryZone.high) / 2 : 0;
    if (entryPriceEl) entryPriceEl.value = entryMid.toFixed(5);
    if (lotsEl) lotsEl.value = decision.position?.lots || 0.1;
    if (stopLossEl) stopLossEl.value = decision.stopLoss?.price?.toFixed(5) || '';
    if (takeProfitEl) takeProfitEl.value = decision.takeProfit?.price?.toFixed(5) || '';
    if (notesEl) notesEl.value = '';

    const statusRadio = document.querySelector('input[name="trade-status"][value="running"]');
    if (statusRadio) statusRadio.checked = true;
    UI.hide('trade-closed-fields');

    UI.show('trade-modal');
  },

  /**
   * Close trade modal
   */
  closeTradeModal() {
    UI.hide('trade-modal');
    this.currentTradeData = null;
    this.currentEditId = null;
  },

  /**
   * Load journal entries
   */
  async loadJournal() {
    try {
      const [entriesRes, statsRes] = await Promise.all([
        API.getJournalEntries(),
        API.getJournalStats(),
      ]);

      this.journalEntries = entriesRes.entries || [];
      this.renderJournal();
      this.renderJournalStats(statsRes.stats);
      
      // Also update running trades in dashboard
      UI.renderRunningTrades(this.journalEntries);
    } catch (error) {
      console.error('Failed to load journal:', error);
      UI.toast('Failed to load journal', 'error');
      // Show empty state on error in table
      const tbody = UI.$('journal-tbody');
      if (tbody) {
        tbody.innerHTML = '<tr><td colspan="13" class="empty-cell">Failed to load journal. <a href="#" onclick="App.loadJournal();return false;">Retry</a></td></tr>';
      }
    }
  },

  /**
   * Render journal stats
   */
  renderJournalStats(stats) {
    // Update journal stats
    const taken = UI.$('stat-taken');
    const winrate = UI.$('stat-winrate');
    const avgr = UI.$('stat-avgr');
    const pnl = UI.$('stat-pnl');
    
    if (taken) taken.textContent = stats.totalTaken;
    if (winrate) winrate.textContent = `${stats.winRate.toFixed(1)}%`;
    if (avgr) avgr.textContent = `${stats.avgR.toFixed(2)}R`;
    if (pnl) pnl.textContent = `$${stats.totalPnlDollars.toFixed(0)}`;
    
    // Also update ticker bar stats
    const tickerWinrate = UI.$('ticker-winrate');
    if (tickerWinrate) tickerWinrate.textContent = `${stats.winRate.toFixed(1)}%`;
    
    const metricWinrate = UI.$('metric-winrate');
    if (metricWinrate) metricWinrate.textContent = `${stats.winRate.toFixed(1)}%`;
    
    const metricAvgR = UI.$('metric-avgr');
    if (metricAvgR) metricAvgR.textContent = `${stats.avgR.toFixed(2)}R`;
  },

  /**
   * Render journal entries
   */
  renderJournal() {
    let entries = this.journalEntries;

    switch (this.journalFilter) {
      case 'taken':
        entries = entries.filter(e => e.action === 'taken');
        break;
      case 'pending':
        entries = entries.filter(e => e.status === 'pending');
        break;
      case 'running':
        entries = entries.filter(e => e.status === 'running');
        break;
      case 'closed':
        entries = entries.filter(e => e.status === 'closed');
        break;
    }

    // Render using Bloomberg-style table
    UI.renderJournalTable(entries);
    
    // Keep legacy container for backward compatibility
    const container = UI.$('journal-container');
    if (!container) return;

    if (entries.length === 0) {
      const isFiltered = this.journalFilter !== 'all';
      container.innerHTML = `
        <div class="empty-state enhanced">
          <div class="empty-illustration">
            <div class="empty-icon-stack">
              <span class="empty-icon-main">📓</span>
              <span class="empty-icon-sub">✏️</span>
            </div>
          </div>
          <h3 class="empty-title">${isFiltered ? 'No matching trades' : 'Your trading journal is empty'}</h3>
          <p class="empty-hint">${isFiltered ? 'Try adjusting your filter to see more trades' : 'Start logging trades from your scan results to track your performance and build your trading history'}</p>
          ${!isFiltered ? `<button class="btn btn-primary" onclick="App.switchScreen('dashboard')">View Scan Results</button>` : ''}
        </div>
      `;
      return;
    }

    const activeFirst = entries.sort((a, b) => {
      const priority = { running: 0, pending: 1 };
      const aPriority = priority[a.status] ?? 2;
      const bPriority = priority[b.status] ?? 2;
      if (aPriority !== bPriority) return aPriority - bPriority;
      return new Date(b.createdAt) - new Date(a.createdAt);
    });

    container.innerHTML = activeFirst.map(e => this.createJournalEntryCard(e)).join('');
  },

  /**
   * Create journal entry card HTML
   */
  createJournalEntryCard(entry) {
    const date = new Date(entry.createdAt).toLocaleDateString();
    const dirClass = entry.direction === 'long' ? 'long' : 'short';
    const dirText = entry.direction.toUpperCase();
    const isRunning = entry.status === 'running';
    const isPending = entry.status === 'pending';
    
    let resultHtml = '';
    if (entry.status === 'closed' && entry.result) {
      const resultClass = entry.result === 'win' ? 'win' : entry.result === 'loss' ? 'loss' : '';
      resultHtml = `<span class="journal-entry-result ${resultClass}">${entry.result.toUpperCase()} ${entry.pnlPips ? `(${entry.pnlPips} pips)` : ''}</span>`;
    } else if (isRunning) {
      resultHtml = `<span class="journal-entry-result" style="color: var(--accent-amber);">RUNNING</span>`;
    } else if (isPending) {
      resultHtml = `<span class="journal-entry-result" style="color: var(--accent-blue);">PENDING</span>`;
    } else if (entry.action !== 'taken') {
      resultHtml = `<span class="journal-entry-result">${entry.action.toUpperCase()}</span>`;
    }

    let actionsHtml = '';
    if (isRunning) {
      actionsHtml = `
        <div class="journal-entry-actions">
          <button class="btn btn-small btn-taken" onclick="App.closeJournalTrade('${entry.id}', 'tp')">Hit TP</button>
          <button class="btn btn-small btn-missed" onclick="App.closeJournalTrade('${entry.id}', 'sl')">Hit SL</button>
          <button class="btn btn-small" onclick="App.editJournalEntry('${entry.id}')">Edit</button>
        </div>
      `;
    } else if (entry.status === 'pending') {
      actionsHtml = `
        <div class="journal-entry-actions">
          <button class="btn btn-small btn-taken" onclick="App.fillPendingTrade('${entry.id}')">Order Filled</button>
          <button class="btn btn-small" onclick="App.editJournalEntry('${entry.id}')">Edit</button>
          <button class="btn btn-small btn-skipped" onclick="App.cancelTrade('${entry.id}')">Cancel</button>
        </div>
      `;
    } else {
      actionsHtml = `
        <div class="journal-entry-actions">
          <button class="btn btn-small" onclick="App.editJournalEntry('${entry.id}')">Edit</button>
        </div>
      `;
    }

    return `
      <div class="journal-entry ${isRunning ? 'running' : ''} ${isPending ? 'pending' : ''}" data-id="${entry.id}">
        <div class="journal-entry-header">
          <span class="journal-entry-symbol">${entry.symbol}</span>
          <span class="journal-entry-direction ${dirClass}">${dirText}</span>
        </div>
        <div class="journal-entry-meta">
          <span>${date}</span>
          <span>Entry: ${entry.entryPrice}</span>
          <span>${entry.lots} lots</span>
          ${resultHtml}
        </div>
        ${actionsHtml}
      </div>
    `;
  },

  /**
   * Edit journal entry
   */
  editJournalEntry(id) {
    const entry = this.journalEntries.find(e => e.id === id);
    if (!entry) return;

    this.currentEditId = id;
    this.currentTradeData = null;

    const titleEl = UI.$('trade-modal-title');
    const symbolEl = UI.$('trade-symbol');
    const actionEl = UI.$('trade-action');
    const entryPriceEl = UI.$('trade-entry-price');
    const lotsEl = UI.$('trade-lots');
    const stopLossEl = UI.$('trade-stop-loss');
    const takeProfitEl = UI.$('trade-take-profit');
    const notesEl = UI.$('trade-notes');

    if (titleEl) titleEl.textContent = `Edit Trade: ${entry.symbol} ${entry.direction.toUpperCase()}`;
    if (symbolEl) symbolEl.value = entry.symbol;
    if (actionEl) actionEl.value = entry.action || 'taken';
    if (entryPriceEl) entryPriceEl.value = entry.entryPrice;
    if (lotsEl) lotsEl.value = entry.lots;
    if (stopLossEl) stopLossEl.value = entry.stopLoss || '';
    if (takeProfitEl) takeProfitEl.value = entry.takeProfit || '';
    if (notesEl) notesEl.value = entry.notes || '';

    const statusRadio = document.querySelector(`input[name="trade-status"][value="${entry.status}"]`);
    if (statusRadio) statusRadio.checked = true;

    if (entry.status === 'closed') {
      UI.show('trade-closed-fields');
      const exitPriceEl = UI.$('trade-exit-price');
      if (exitPriceEl) exitPriceEl.value = entry.exitPrice || '';
      const resultRadio = document.querySelector(`input[name="trade-result"][value="${entry.result}"]`);
      if (resultRadio) resultRadio.checked = true;
    } else {
      UI.hide('trade-closed-fields');
    }

    UI.show('trade-modal');
  },

  /**
   * Save trade entry (create or update)
   */
  async saveTradeEntry() {
    const isEdit = !!this.currentEditId;
    
    const status = document.querySelector('input[name="trade-status"]:checked')?.value || 'running';
    
    const entryPriceEl = UI.$('trade-entry-price');
    const stopLossEl = UI.$('trade-stop-loss');
    const takeProfitEl = UI.$('trade-take-profit');
    const lotsEl = UI.$('trade-lots');
    const notesEl = UI.$('trade-notes');
    const exitPriceEl = UI.$('trade-exit-price');
    
    try {
      const updates = {
        entryPrice: entryPriceEl ? parseFloat(entryPriceEl.value) : 0,
        stopLoss: stopLossEl ? parseFloat(stopLossEl.value) : 0,
        takeProfit: takeProfitEl ? parseFloat(takeProfitEl.value) : 0,
        lots: lotsEl ? parseFloat(lotsEl.value) : 0,
        status: status,
        notes: notesEl ? notesEl.value || undefined : undefined,
      };

      if (status === 'closed') {
        updates.exitPrice = exitPriceEl ? parseFloat(exitPriceEl.value) : 0;
        updates.result = document.querySelector('input[name="trade-result"]:checked')?.value;
      }

      if (isEdit) {
        await API.updateJournalEntry(this.currentEditId, updates);
        UI.toast('Trade updated successfully', 'success');
        this.currentEditId = null;
        this.loadJournal();
      } else {
        const decision = this.currentTradeData;
        if (!decision) return;

        const entry = {
          source: 'signal',
          symbol: decision.symbol,
          direction: decision.direction,
          style: decision.style,
          grade: decision.grade,
          // Strategy metadata (Phase 3)
          strategyId: decision.strategyId || this.selectedStrategy,
          strategyName: decision.strategyName || this.getStrategyName(this.selectedStrategy),
          confidence: decision.confidence,
          reasonCodes: decision.reasonCodes || [],
          tradeType: 'pullback',
          entryZoneLow: decision.entryZone?.low,
          entryZoneHigh: decision.entryZone?.high,
          action: 'taken',
          ...updates,
        };

        await API.addJournalEntry(entry);
        UI.toast('Trade logged successfully', 'success');
      }

      this.closeTradeModal();
    } catch (error) {
      UI.toast(`Failed to save trade: ${error.message}`, 'error');
    }
  },

  /**
   * Close running trade quickly
   */
  async closeJournalTrade(id, type) {
    try {
      const entry = this.journalEntries.find(e => e.id === id);
      if (!entry) return;

      const exitPrice = type === 'tp' ? entry.takeProfit : entry.stopLoss;
      
      await API.updateJournalEntry(id, {
        status: 'closed',
        exitPrice: exitPrice,
      });

      UI.toast(`Trade closed at ${type.toUpperCase()}`, 'success');
      this.loadJournal();
    } catch (error) {
      UI.toast(`Failed to close trade: ${error.message}`, 'error');
    }
  },

  /**
   * Fill pending order (move to running)
   */
  async fillPendingTrade(id) {
    try {
      await API.updateJournalEntry(id, { status: 'running' });
      UI.toast('Order filled - trade now running', 'success');
      this.loadJournal();
    } catch (error) {
      UI.toast(`Failed to update trade: ${error.message}`, 'error');
    }
  },

  /**
   * Cancel pending order
   */
  async cancelTrade(id) {
    try {
      await API.deleteJournalEntry(id);
      UI.toast('Trade cancelled', 'success');
      this.loadJournal();
    } catch (error) {
      UI.toast(`Failed to cancel trade: ${error.message}`, 'error');
    }
  },

  /**
   * Filter journal
   */
  filterJournal(filter) {
    this.journalFilter = filter;
    
    UI.$$('[data-journal-filter]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.journalFilter === filter);
    });

    this.renderJournal();
  },

  /**
   * Setup event listeners
   */
  setupEventListeners() {
    // Navigation
    const navBtns = UI.$$('.nav-btn');
    console.log('Setting up nav buttons:', navBtns.length);
    navBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        console.log('Nav button clicked:', btn.dataset.screen);
        this.switchScreen(btn.dataset.screen);
      });
    });

    // Welcome screen - Get Started button
    const getStartedBtn = UI.$('get-started-btn');
    console.log('Get Started button found:', !!getStartedBtn);
    if (getStartedBtn) {
      getStartedBtn.addEventListener('click', () => {
        console.log('Get Started clicked');
        this.completeOnboarding();
      });
    }

    // Settings form - prevent duplicate handlers
    const settingsForm = UI.$('settings-form');
    if (settingsForm && !settingsForm._hasListener) {
      settingsForm._hasListener = true;
      settingsForm.addEventListener('submit', (e) => {
        e.preventDefault();
        if (this.saveSettings()) {
          UI.switchScreen('dashboard');
        }
      });
    }
    
    // Signal table filter buttons (dashboard)
    UI.$$('.panel-actions .filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        UI.$$('.panel-actions .filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.currentFilter = btn.dataset.filter;
        UI.renderSignalsTable(this.results, this.currentFilter);
      });
    });

    // Risk hint update
    UI.$('account-size')?.addEventListener('input', () => this.updateRiskHint());
    UI.$('risk-percent')?.addEventListener('change', () => this.updateRiskHint());

    // Watchlist
    UI.$('forex-symbols')?.addEventListener('click', (e) => {
      e.preventDefault();
      const item = e.target.closest('.symbol-item');
      if (item) this.toggleSymbol(item.dataset.symbol);
    });

    UI.$('crypto-symbols')?.addEventListener('click', (e) => {
      e.preventDefault();
      const item = e.target.closest('.symbol-item');
      if (item) this.toggleSymbol(item.dataset.symbol);
    });

    UI.$('metals-symbols')?.addEventListener('click', (e) => {
      e.preventDefault();
      const item = e.target.closest('.symbol-item');
      if (item) this.toggleSymbol(item.dataset.symbol);
    });

    UI.$('indices-symbols')?.addEventListener('click', (e) => {
      e.preventDefault();
      const item = e.target.closest('.symbol-item');
      if (item) this.toggleSymbol(item.dataset.symbol);
    });

    UI.$('commodities-symbols')?.addEventListener('click', (e) => {
      e.preventDefault();
      const item = e.target.closest('.symbol-item');
      if (item) this.toggleSymbol(item.dataset.symbol);
    });

    UI.$$('[data-select]').forEach(btn => {
      btn.addEventListener('click', () => this.selectCategory(btn.dataset.select));
    });

    UI.$('clear-selection-btn')?.addEventListener('click', () => this.clearSelection());
    UI.$('scan-btn')?.addEventListener('click', () => this.runScan());
    UI.$('symbol-search')?.addEventListener('input', (e) => this.searchSymbols(e.target.value));

    // Strategy selection - clear results when strategy changes
    UI.$('strategy-select')?.addEventListener('change', (e) => {
      this.selectedStrategy = e.target.value;
      localStorage.setItem('selectedStrategy', this.selectedStrategy);
      
      // Clear cached results when strategy changes to force fresh scan
      this.results = [];
      Storage.saveResults([]);
      UI.renderResults([], this.currentFilter);
      const refreshBtn = UI.$('refresh-btn');
      if (refreshBtn) refreshBtn.disabled = true;
      UI.toast(`Strategy changed to ${e.target.options[e.target.selectedIndex].text}`, 'info');
    });

    // Results
    UI.$$('.filter-btn[data-filter]').forEach(btn => {
      btn.addEventListener('click', () => this.filterResults(btn.dataset.filter));
    });

    UI.$('refresh-btn')?.addEventListener('click', () => this.refresh());
    UI.$('export-btn')?.addEventListener('click', () => this.exportJSON());
    UI.$('copy-summary-btn')?.addEventListener('click', () => this.copySummary());

    // Journal filters
    UI.$$('[data-journal-filter]').forEach(btn => {
      btn.addEventListener('click', () => this.filterJournal(btn.dataset.journalFilter));
    });

    // Trade modal status toggle
    document.querySelectorAll('input[name="trade-status"]').forEach(radio => {
      radio.addEventListener('change', (e) => {
        if (e.target.value === 'closed') {
          UI.show('trade-closed-fields');
        } else {
          UI.hide('trade-closed-fields');
        }
      });
    });

    // Go to watchlist from empty results
    document.addEventListener('click', (e) => {
      if (e.target.id === 'go-to-watchlist-btn') {
        this.switchScreen('watchlist');
      }
    });
    
    // Auto-scan toggle
    UI.$('autoscan-toggle')?.addEventListener('change', (e) => {
      if (e.target.checked) {
        this.startAutoScan();
      } else {
        this.stopAutoScan();
      }
    });
    
    // Load auto-scan status on init
    this.loadAutoScanStatus();
  },
  
  setupKeyboardNavigation() {
    document.addEventListener('keydown', (e) => {
      // Close modals with Escape
      if (e.key === 'Escape') {
        const tradeModal = UI.$('trade-modal');
        if (tradeModal && !tradeModal.classList.contains('hidden')) {
          this.closeTradeModal();
          return;
        }
      }
      
      // Navigate between screens with number keys (when not in input)
      if (document.activeElement.tagName !== 'INPUT' && 
          document.activeElement.tagName !== 'TEXTAREA' &&
          document.activeElement.tagName !== 'SELECT') {
        const screens = ['dashboard', 'auto-scan', 'journal', 'settings'];
        const keyNum = parseInt(e.key);
        
        if (keyNum >= 1 && keyNum <= screens.length) {
          e.preventDefault();
          this.switchScreen(screens[keyNum - 1]);
        }
        
        // Quick actions
        if (e.key === 's' || e.key === 'S') {
          e.preventDefault();
          UI.$('scan-btn')?.click();
        }
      }
    });
    
    // Arrow key navigation within results grid (using event delegation)
    document.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const resultsContainer = UI.$('results-container');
        if (!resultsContainer) return;
        
        const cards = resultsContainer.querySelectorAll('.decision-card');
        if (cards.length === 0) return;
        
        // Check if focus is on or within a decision card
        const focusedCard = document.activeElement.closest('.decision-card') || 
                           (document.activeElement.classList.contains('decision-card') ? document.activeElement : null);
        
        if (focusedCard) {
          e.preventDefault();
          const currentIndex = Array.from(cards).indexOf(focusedCard);
          const nextIndex = e.key === 'ArrowDown' 
            ? Math.min(currentIndex + 1, cards.length - 1)
            : Math.max(currentIndex - 1, 0);
          
          cards[nextIndex].focus();
        }
      }
    });
  },
  
  async loadAutoScanStatus() {
    try {
      const response = await fetch('/api/autoscan/status');
      const status = await response.json();
      this.updateAutoScanUI(status);
      
      if (status.isRunning) {
        const autoscanToggle = UI.$('autoscan-toggle');
        if (autoscanToggle) autoscanToggle.checked = true;
        UI.show('autoscan-config');
      }
    } catch (error) {
      console.error('Failed to load auto-scan status:', error);
    }
  },
  
  async startAutoScan() {
    const email = UI.$('autoscan-email')?.value?.trim() || '';
    const minGrade = UI.$('autoscan-grade')?.value || 'B';
    const watchlistPreset = UI.$('autoscan-preset')?.value || 'majors-gold';
    const intervalMs = parseInt(UI.$('autoscan-interval')?.value) || 300000;
    const respectMarketHours = UI.$('autoscan-market-hours')?.checked !== false;
    
    if (!email || !email.includes('@')) {
      const autoscanToggle = UI.$('autoscan-toggle');
      if (autoscanToggle) autoscanToggle.checked = false;
      UI.toast('Please enter a valid email address for alerts', 'error');
      UI.$('autoscan-email')?.focus();
      return;
    }
    
    try {
      const response = await fetch('/api/autoscan/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, minGrade, watchlistPreset, intervalMs, respectMarketHours }),
      });
      
      const data = await response.json();
      
      if (data.success) {
        UI.show('autoscan-config');
        this.updateAutoScanUI(data.status);
        UI.toast(`Auto-scan started! Alerts will be sent to ${email}`, 'success');
        
        this.autoScanInterval = setInterval(() => this.loadAutoScanStatus(), 60000);
      } else {
        const autoscanToggle = UI.$('autoscan-toggle');
      if (autoscanToggle) autoscanToggle.checked = false;
        UI.toast(data.error || 'Failed to start auto-scan', 'error');
      }
    } catch (error) {
      const autoscanToggle = UI.$('autoscan-toggle');
      if (autoscanToggle) autoscanToggle.checked = false;
      UI.toast('Failed to start auto-scan', 'error');
    }
  },
  
  async stopAutoScan() {
    try {
      const response = await fetch('/api/autoscan/stop', {
        method: 'POST',
      });
      
      const data = await response.json();
      
      if (data.success) {
        this.updateAutoScanUI(data.status);
        UI.toast('Auto-scan stopped', 'info');
        
        if (this.autoScanInterval) {
          clearInterval(this.autoScanInterval);
          this.autoScanInterval = null;
        }
      }
    } catch (error) {
      UI.toast('Failed to stop auto-scan', 'error');
    }
  },
  
  updateAutoScanUI(status) {
    const runningEl = UI.$('autoscan-running');
    const lastEl = UI.$('autoscan-last');
    const nextEl = UI.$('autoscan-next');
    const signalsEl = UI.$('autoscan-signals');
    const scannedEl = UI.$('autoscan-scanned');
    const forexEl = UI.$('market-forex');
    const cryptoEl = UI.$('market-crypto');
    const progressEl = UI.$('scan-progress');
    const progressFillEl = UI.$('scan-progress-fill');
    const progressTextEl = UI.$('scan-progress-text');
    
    // Update main status ticker
    const tickerAutoscan = UI.$('ticker-autoscan');
    if (tickerAutoscan) {
      tickerAutoscan.textContent = status.isRunning ? 'ON' : 'OFF';
      tickerAutoscan.className = 'ticker-value' + (status.isRunning ? ' positive' : '');
    }
    
    if (runningEl) {
      runningEl.textContent = status.isRunning ? 'Running' : 'Stopped';
      runningEl.className = 'status-value ' + (status.isRunning ? 'running' : 'stopped');
    }
    
    if (lastEl && status.lastScanAt) {
      const lastDate = new Date(status.lastScanAt);
      lastEl.textContent = lastDate.toLocaleTimeString();
    }
    
    if (nextEl && status.nextScanAt) {
      const nextDate = new Date(status.nextScanAt);
      nextEl.textContent = nextDate.toLocaleTimeString();
    } else if (nextEl) {
      nextEl.textContent = '-';
    }
    
    if (signalsEl && status.lastScanResults) {
      signalsEl.textContent = status.lastScanResults.newSignals;
    }
    
    if (scannedEl && status.lastScanResults) {
      const skipped = status.lastScanResults.skippedMarketClosed || 0;
      scannedEl.textContent = `${status.lastScanResults.symbolsScanned}${skipped > 0 ? ` (${skipped} skipped)` : ''}`;
    }
    
    if (forexEl && status.marketStatus) {
      forexEl.className = 'market-indicator forex ' + (status.marketStatus.forex ? 'active' : 'closed');
      forexEl.title = status.marketStatus.forex ? 'Forex: Open' : (status.marketStatus.forexReason || 'Forex: Closed');
    }
    
    if (cryptoEl && status.marketStatus) {
      cryptoEl.className = 'market-indicator crypto active';
    }
    
    if (progressEl && status.currentScan) {
      UI.show('scan-progress');
      const percent = Math.round((status.currentScan.progress / status.currentScan.total) * 100);
      if (progressFillEl) progressFillEl.style.width = `${percent}%`;
      if (progressTextEl) progressTextEl.textContent = `Scanning ${status.currentScan.strategyId}... ${percent}%`;
    } else if (progressEl) {
      UI.hide('scan-progress');
    }
    
    if (status.isRunning) {
      UI.show('autoscan-config');
    }
    
    if (status.config?.email) {
      const emailEl = UI.$('autoscan-email');
      if (emailEl && !emailEl.value) emailEl.value = status.config.email;
    }
    if (status.config?.watchlistPreset) {
      const presetEl = UI.$('autoscan-preset');
      if (presetEl) presetEl.value = status.config.watchlistPreset;
    }
    if (status.config?.intervalMs) {
      const intervalEl = UI.$('autoscan-interval');
      if (intervalEl) intervalEl.value = status.config.intervalMs.toString();
    }
    if (typeof status.config?.respectMarketHours !== 'undefined') {
      const marketHoursEl = UI.$('autoscan-market-hours');
      if (marketHoursEl) marketHoursEl.checked = status.config.respectMarketHours;
    }
  },
  
  async loadMarketOverview() {
    try {
      const response = await fetch('/api/sentiment/overview');
      if (!response.ok) return;

      const overview = await response.json();
      if (!overview) return;

      const sidebarContainer = UI.$('market-sidebar-container');
      if (sidebarContainer) {
        sidebarContainer.innerHTML = UI.createMarketSidebar(overview);
        if (overview.symbols && overview.symbols.length > 0) {
          sidebarContainer.classList.add('visible');
        } else {
          sidebarContainer.classList.remove('visible');
        }
      }
    } catch (error) {
      console.error('Failed to load market overview:', error);
    }
  },

  // ═══════════════════════════════════════════════════════════════
  // DETECTIONS (Auto-Scan Detected Trades Cache)
  // ═══════════════════════════════════════════════════════════════

  detections: [],
  detectionFilter: 'all',
  detectionRefreshInterval: null,

  /**
   * Load detections from API
   */
  async loadDetections() {
    try {
      const params = new URLSearchParams();
      if (this.detectionFilter !== 'all') {
        params.set('status', this.detectionFilter);
      }

      const response = await fetch(`/api/detections?${params}`);
      if (!response.ok) throw new Error('Failed to load detections');

      const data = await response.json();
      this.detections = data.detections || [];

      this.renderDetections();
      this.updateDetectionSummary(data.summary);
      this.updateDetectionBadge();
    } catch (error) {
      console.error('Failed to load detections:', error);
      UI.toast('Failed to load detections', 'error');
    }
  },

  /**
   * Render detections list
   */
  renderDetections() {
    const container = UI.$('detections-container');
    if (!container) return;

    if (this.detections.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🔍</div>
          <p>No detected trades yet</p>
          <p class="empty-hint">Start auto-scan to detect trading opportunities</p>
          <button class="btn btn-primary" id="go-to-autoscan-btn" onclick="UI.switchScreen('auto-scan')">Configure Auto-Scan</button>
        </div>
      `;
      return;
    }

    // Group by strategy
    const byStrategy = {};
    for (const detection of this.detections) {
      const key = detection.strategyId;
      if (!byStrategy[key]) {
        byStrategy[key] = {
          name: detection.strategyName || detection.strategyId,
          detections: []
        };
      }
      byStrategy[key].detections.push(detection);
    }

    let html = '';
    for (const [strategyId, group] of Object.entries(byStrategy)) {
      html += `
        <div class="detection-group">
          <div class="detection-group-header">
            <h3>${group.name}</h3>
            <span class="detection-count">${group.detections.length}</span>
          </div>
          <div class="detection-list">
      `;

      for (const detection of group.detections) {
        html += this.renderDetectionCard(detection);
      }

      html += '</div></div>';
    }

    container.innerHTML = html;

    // Start cooldown timers
    this.startCooldownTimers();
  },

  /**
   * Render single detection card
   */
  renderDetectionCard(detection) {
    const isEligible = detection.status === 'eligible';
    const isCooling = detection.status === 'cooling_down';

    const statusClass = isEligible ? 'eligible' : (isCooling ? 'cooling' : 'other');
    const statusIcon = isEligible ? '✅' : (isCooling ? '⏱️' : '📋');
    const statusText = isEligible ? 'ELIGIBLE' : (isCooling ? 'Cooling Down' : detection.status.replace('_', ' '));

    const gradeClass = detection.grade.replace('+', '-plus').toLowerCase();
    const directionIcon = detection.direction === 'long' ? '📈' : '📉';

    let cooldownHtml = '';
    if (isCooling && detection.cooldownEndsAt) {
      const remaining = this.formatCooldownRemaining(detection.cooldownEndsAt);
      cooldownHtml = `<span class="cooldown-timer" data-ends="${detection.cooldownEndsAt}">${remaining}</span>`;
    }

    const actionsHtml = isEligible ? `
      <button class="btn btn-small btn-primary" onclick="App.executeDetection('${detection.id}')">Take Trade</button>
      <button class="btn btn-small btn-secondary" onclick="App.dismissDetection('${detection.id}')">Dismiss</button>
    ` : `
      <button class="btn btn-small btn-secondary" onclick="App.dismissDetection('${detection.id}')">Dismiss</button>
    `;

    return `
      <div class="detection-card ${statusClass}" data-id="${detection.id}">
        <div class="detection-header">
          <div class="detection-symbol">
            <span class="symbol-name">${detection.symbol}</span>
            <span class="direction ${detection.direction}">${directionIcon} ${detection.direction.toUpperCase()}</span>
          </div>
          <div class="detection-grade grade-${gradeClass}">${detection.grade}</div>
        </div>

        <div class="detection-status">
          <span class="status-badge ${statusClass}">${statusIcon} ${statusText}</span>
          ${cooldownHtml}
        </div>

        <div class="detection-prices">
          <div class="price-row">
            <span class="price-label">Entry:</span>
            <span class="price-value">${detection.entry?.formatted || '-'}</span>
          </div>
          <div class="price-row">
            <span class="price-label">SL:</span>
            <span class="price-value sl">${detection.stopLoss?.formatted || '-'}</span>
          </div>
          <div class="price-row">
            <span class="price-label">TP:</span>
            <span class="price-value tp">${detection.takeProfit?.formatted || '-'}</span>
          </div>
          ${detection.lotSize ? `
          <div class="price-row position">
            <span class="price-label">Size:</span>
            <span class="price-value">${detection.lotSize} lots</span>
          </div>
          ` : ''}
        </div>
        
        ${detection.tieredExits ? `
        <div class="detection-exits">
          ${detection.tieredExits.tp1 ? `
          <div class="exit-row">
            <span class="exit-label">TP1 (1R):</span>
            <span class="exit-value tp">${detection.tieredExits.tp1.formatted || '-'}</span>
          </div>
          ` : ''}
          ${detection.tieredExits.tp2 ? `
          <div class="exit-row">
            <span class="exit-label">TP2 (2R):</span>
            <span class="exit-value tp">${detection.tieredExits.tp2.formatted || '-'}</span>
          </div>
          ` : ''}
        </div>
        ` : ''}

        <div class="detection-meta">
          <span title="First detected">First: ${new Date(detection.firstDetectedAt).toLocaleTimeString()}</span>
          <span title="Confirmation count">Confirmations: ${detection.detectionCount}</span>
          ${detection.barExpiresAt ? `
          <span class="bar-expires" title="Setup expires when candle closes" data-expires="${detection.barExpiresAt}">
            Expires: ${this.formatBarExpiry(detection.barExpiresAt)}
          </span>
          ` : ''}
        </div>

        <div class="detection-actions">
          ${actionsHtml}
        </div>
      </div>
    `;
  },

  /**
   * Format cooldown remaining time
   */
  formatCooldownRemaining(endsAt) {
    const now = Date.now();
    const end = new Date(endsAt).getTime();
    const remainingMs = end - now;

    if (remainingMs <= 0) return 'Ready!';

    const mins = Math.floor(remainingMs / 60000);
    const secs = Math.floor((remainingMs % 60000) / 1000);

    if (mins > 0) {
      return `${mins}m ${secs}s remaining`;
    }
    return `${secs}s remaining`;
  },

  formatBarExpiry(expiresAt) {
    const now = Date.now();
    const end = new Date(expiresAt).getTime();
    const remainingMs = end - now;

    if (remainingMs <= 0) return 'Expired';

    const mins = Math.floor(remainingMs / 60000);
    if (mins >= 60) {
      const hours = Math.floor(mins / 60);
      const remMins = mins % 60;
      return `${hours}h ${remMins}m`;
    }
    return `${mins}m`;
  },

  /**
   * Start cooldown timer updates
   */
  startCooldownTimers() {
    // Clear existing interval
    if (this.cooldownTimerInterval) {
      clearInterval(this.cooldownTimerInterval);
    }

    this.cooldownTimerInterval = setInterval(() => {
      const timers = document.querySelectorAll('.cooldown-timer');
      let needsRefresh = false;

      timers.forEach(timer => {
        const endsAt = timer.dataset.ends;
        const remaining = this.formatCooldownRemaining(endsAt);
        timer.textContent = remaining;

        if (remaining === 'Ready!') {
          needsRefresh = true;
        }
      });

      if (needsRefresh) {
        this.loadDetections();
      }
    }, 1000);
  },

  /**
   * Update detection summary stats
   */
  updateDetectionSummary(summary) {
    if (!summary) return;

    const coolingEl = UI.$('stat-cooling');
    const eligibleEl = UI.$('stat-eligible');
    const totalEl = UI.$('stat-total-detections');

    if (coolingEl) coolingEl.textContent = summary.coolingDown || 0;
    if (eligibleEl) eligibleEl.textContent = summary.eligible || 0;
    if (totalEl) totalEl.textContent = summary.total || 0;
  },

  /**
   * Update detection badge in navigation and ticker
   */
  updateDetectionBadge() {
    const badge = UI.$('detections-badge');
    const tickerSignals = UI.$('ticker-signals');

    const activeCount = this.detections.filter(d =>
      d.status === 'cooling_down' || d.status === 'eligible'
    ).length;

    if (badge) {
      if (activeCount > 0) {
        badge.textContent = activeCount;
        badge.classList.remove('hidden');
      } else {
        badge.classList.add('hidden');
      }
    }
    
    // Update ticker signals count
    if (tickerSignals) {
      tickerSignals.textContent = activeCount;
    }
  },

  /**
   * Execute a detection (take the trade)
   */
  async executeDetection(id) {
    try {
      const response = await fetch(`/api/detections/${id}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });

      if (!response.ok) throw new Error('Failed to execute detection');

      UI.toast('Trade executed! Added to journal.', 'success');
      await this.loadDetections();
    } catch (error) {
      console.error('Failed to execute detection:', error);
      UI.toast('Failed to execute trade', 'error');
    }
  },

  /**
   * Dismiss a detection
   */
  async dismissDetection(id) {
    if (!confirm('Dismiss this detected trade?')) return;

    try {
      const response = await fetch(`/api/detections/${id}/dismiss`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'User dismissed' })
      });

      if (!response.ok) throw new Error('Failed to dismiss detection');

      UI.toast('Detection dismissed', 'info');
      await this.loadDetections();
    } catch (error) {
      console.error('Failed to dismiss detection:', error);
      UI.toast('Failed to dismiss detection', 'error');
    }
  },

  /**
   * Setup detection filter listeners
   */
  setupDetectionFilters() {
    document.querySelectorAll('[data-detection-filter]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('[data-detection-filter]').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        this.detectionFilter = e.target.dataset.detectionFilter;
        this.loadDetections();
      });
    });
  },

  /**
   * Start auto-refresh for detections
   */
  startDetectionRefresh() {
    if (this.detectionRefreshInterval) {
      clearInterval(this.detectionRefreshInterval);
    }

    // Refresh every 30 seconds
    this.detectionRefreshInterval = setInterval(() => {
      this.loadDetections();
    }, 30000);
  },

  /**
   * Stop auto-refresh for detections
   */
  stopDetectionRefresh() {
    if (this.detectionRefreshInterval) {
      clearInterval(this.detectionRefreshInterval);
      this.detectionRefreshInterval = null;
    }
    if (this.cooldownTimerInterval) {
      clearInterval(this.cooldownTimerInterval);
      this.cooldownTimerInterval = null;
    }
  },
};

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => App.init());

// Export for global access
window.App = App;
