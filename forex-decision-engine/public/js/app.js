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
      UI.show('results-screen');
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

    // Check API health
    this.checkHealth();
    
    // Connect to upgrade notifications
    this.connectUpgradeStream();

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
      
      // Render symbol grids for all 5 asset classes (with displayNames from metadata)
      UI.renderSymbolGrid('forex-symbols', this.universe.forex, this.selectedSymbols, this.metadata);
      UI.renderSymbolGrid('metals-symbols', this.universe.metals, this.selectedSymbols, this.metadata);
      UI.renderSymbolGrid('indices-symbols', this.universe.indices, this.selectedSymbols, this.metadata);
      UI.renderSymbolGrid('commodities-symbols', this.universe.commodities, this.selectedSymbols, this.metadata);
      UI.renderSymbolGrid('crypto-symbols', this.universe.crypto, this.selectedSymbols, this.metadata);
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
    
    // Set trading mode radio
    const tradingModeRadio = document.querySelector(`input[name="trading-mode"][value="${settings.paperTrading ? 'paper' : 'live'}"]`);
    if (tradingModeRadio) tradingModeRadio.checked = true;
    
    // Set trading style radio
    const styleRadio = document.querySelector(`input[name="style"][value="${settings.style}"]`);
    if (styleRadio) styleRadio.checked = true;

    this.updateRiskHint();
  },

  /**
   * Save settings
   */
  async saveSettings() {
    const submitBtn = UI.$('settings-form').querySelector('button[type="submit"]');
    UI.setButtonLoading(submitBtn, true);
    
    try {
      const tradingMode = document.querySelector('input[name="trading-mode"]:checked')?.value || 'paper';
      const settings = {
        accountSize: parseFloat(UI.$('account-size').value) || 10000,
        riskPercent: parseFloat(UI.$('risk-percent').value) || 0.5,
        style: document.querySelector('input[name="style"]:checked')?.value || 'intraday',
        timezone: UI.$('timezone').value || 'America/Chicago',
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
    const accountSize = parseFloat(UI.$('account-size').value) || 10000;
    const riskPercent = parseFloat(UI.$('risk-percent').value) || 0.5;
    const riskAmount = (accountSize * riskPercent / 100).toFixed(0);
    UI.$('risk-amount-hint').textContent = `Risk: $${riskAmount} per trade`;
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
    // Show skeleton while loading from storage
    UI.showSkeletons('results-container', 2, 'card');
    
    // Brief delay to show skeleton (storage is sync but this helps UX)
    setTimeout(() => {
      this.results = Storage.getResults();
      UI.renderResults(this.results, this.currentFilter);
      
      if (this.results.length > 0) {
        const lastScan = new Date(this.results[0].timestamp);
        UI.$('last-scan-time').textContent = `Last scan: ${lastScan.toLocaleString()}`;
        UI.$('refresh-btn').disabled = false;
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
      UI.$('last-scan-time').textContent = `Last scan: ${new Date().toLocaleString()}`;
      
      // Switch to results screen
      UI.switchScreen('results');
      UI.renderResults(this.results, this.currentFilter);

    } catch (error) {
      console.error('Scan error:', error);
      UI.toast(`Scan failed: ${error.message}`, 'error', 5000);
    } finally {
      this.isScanning = false;
      UI.setButtonLoading(scanBtn, false);
      scanBtn.disabled = this.selectedSymbols.length === 0;
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

    UI.$('trade-modal-title').textContent = `Log Trade: ${decision.displayName} ${decision.direction.toUpperCase()}`;
    UI.$('trade-symbol').value = decision.symbol;
    UI.$('trade-action').value = 'taken';
    
    const entryMid = decision.entryZone ? (decision.entryZone.low + decision.entryZone.high) / 2 : 0;
    UI.$('trade-entry-price').value = entryMid.toFixed(5);
    UI.$('trade-lots').value = decision.position?.lots || 0.1;
    UI.$('trade-stop-loss').value = decision.stopLoss?.price?.toFixed(5) || '';
    UI.$('trade-take-profit').value = decision.takeProfit?.price?.toFixed(5) || '';
    UI.$('trade-notes').value = '';

    document.querySelector('input[name="trade-status"][value="running"]').checked = true;
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
    // Show skeleton loaders while fetching
    UI.showSkeletons('journal-container', 3, 'card');
    UI.showSkeletons('journal-stats', 4, 'stat');
    
    try {
      const [entriesRes, statsRes] = await Promise.all([
        API.getJournalEntries(),
        API.getJournalStats(),
      ]);

      this.journalEntries = entriesRes.entries || [];
      this.renderJournal();
      this.renderJournalStats(statsRes.stats);
    } catch (error) {
      console.error('Failed to load journal:', error);
      UI.toast('Failed to load journal', 'error');
      // Show empty state on error
      UI.$('journal-container').innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">⚠️</div>
          <p>Failed to load journal</p>
          <button class="btn btn-primary" onclick="App.loadJournal()">Retry</button>
        </div>
      `;
    }
  },

  /**
   * Render journal stats
   */
  renderJournalStats(stats) {
    UI.$('stat-taken').textContent = stats.totalTaken;
    UI.$('stat-winrate').textContent = `${stats.winRate.toFixed(1)}%`;
    UI.$('stat-avgr').textContent = `${stats.avgR.toFixed(2)}R`;
    UI.$('stat-pnl').textContent = `$${stats.totalPnlDollars.toFixed(0)}`;
  },

  /**
   * Render journal entries
   */
  renderJournal() {
    const container = UI.$('journal-container');
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
          ${!isFiltered ? `<button class="btn btn-primary" onclick="App.switchScreen('results')">View Scan Results</button>` : ''}
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

    UI.$('trade-modal-title').textContent = `Edit Trade: ${entry.symbol} ${entry.direction.toUpperCase()}`;
    UI.$('trade-symbol').value = entry.symbol;
    UI.$('trade-action').value = entry.action || 'taken';
    UI.$('trade-entry-price').value = entry.entryPrice;
    UI.$('trade-lots').value = entry.lots;
    UI.$('trade-stop-loss').value = entry.stopLoss || '';
    UI.$('trade-take-profit').value = entry.takeProfit || '';
    UI.$('trade-notes').value = entry.notes || '';

    const statusRadio = document.querySelector(`input[name="trade-status"][value="${entry.status}"]`);
    if (statusRadio) statusRadio.checked = true;

    if (entry.status === 'closed') {
      UI.show('trade-closed-fields');
      UI.$('trade-exit-price').value = entry.exitPrice || '';
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
    
    try {
      const updates = {
        entryPrice: parseFloat(UI.$('trade-entry-price').value),
        stopLoss: parseFloat(UI.$('trade-stop-loss').value),
        takeProfit: parseFloat(UI.$('trade-take-profit').value),
        lots: parseFloat(UI.$('trade-lots').value),
        status: status,
        notes: UI.$('trade-notes').value || undefined,
      };

      if (status === 'closed') {
        updates.exitPrice = parseFloat(UI.$('trade-exit-price').value);
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
      UI.$('refresh-btn').disabled = true;
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
  
  async loadAutoScanStatus() {
    try {
      const response = await fetch('/api/autoscan/status');
      const status = await response.json();
      this.updateAutoScanUI(status);
      
      if (status.isRunning) {
        UI.$('autoscan-toggle').checked = true;
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
      UI.$('autoscan-toggle').checked = false;
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
        UI.$('autoscan-toggle').checked = false;
        UI.toast(data.error || 'Failed to start auto-scan', 'error');
      }
    } catch (error) {
      UI.$('autoscan-toggle').checked = false;
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
};

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => App.init());

// Export for global access
window.App = App;
