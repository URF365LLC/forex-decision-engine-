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
  isScanning: false,
  journalEntries: [],
  journalFilter: 'all',
  currentTradeData: null,
  selectedStrategy: localStorage.getItem('selectedStrategy') || 'ema-pullback-intra',
  strategies: [],

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

    console.log('✅ Application initialized');
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
    if (this.isScanning) {
      UI.toast('Scan already in progress', 'info');
      return;
    }
    
    if (this.selectedSymbols.length === 0) {
      UI.toast('Select at least one symbol', 'error');
      return;
    }

    this.isScanning = true;
    UI.$('scan-btn').disabled = true;
    UI.$('refresh-btn').disabled = true;
    
    const settings = Storage.getSettings();
    
    UI.showLoading('Starting scan...');

    try {
      const response = await API.scan(this.selectedSymbols, settings, this.selectedStrategy);
      
      this.results = response.decisions;
      Storage.saveResults(this.results);

      const trades = this.results.filter(d => d.grade !== 'no-trade').length;
      UI.toast(`Scan complete: ${trades} trade signals found`, 'success');

      // Update UI
      UI.$('last-scan-time').textContent = `Last scan: ${new Date().toLocaleString()}`;
      
      // Switch to results screen
      UI.switchScreen('results');
      UI.renderResults(this.results, this.currentFilter);

    } catch (error) {
      console.error('Scan error:', error);
      UI.toast(`Scan failed: ${error.message}`, 'error');
    } finally {
      this.isScanning = false;
      UI.$('scan-btn').disabled = this.selectedSymbols.length === 0;
      UI.$('refresh-btn').disabled = this.results.length === 0;
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

  // ═══════════════════════════════════════════════════════════════
  // JOURNAL FUNCTIONALITY
  // ═══════════════════════════════════════════════════════════════

  /**
   * Log trade from signal card
   */
  logTrade(symbol, action) {
    const decision = this.results.find(d => d.symbol === symbol);
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
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">📓</div>
          <p>No trades found</p>
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
  },
};

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => App.init());

// Export for global access
window.App = App;
