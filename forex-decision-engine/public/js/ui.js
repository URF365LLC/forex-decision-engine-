/**
 * UI Utilities
 * DOM manipulation helpers
 */

const UI = {
  /**
   * Get element by ID
   */
  $(id) {
    return document.getElementById(id);
  },

  /**
   * Query selector
   */
  $$(selector) {
    return document.querySelectorAll(selector);
  },

  /**
   * Show element
   */
  show(element) {
    if (typeof element === 'string') element = this.$(element);
    if (element) element.classList.remove('hidden');
  },

  /**
   * Hide element
   */
  hide(element) {
    if (typeof element === 'string') element = this.$(element);
    if (element) element.classList.add('hidden');
  },

  /**
   * Toggle element visibility
   */
  toggle(element) {
    if (typeof element === 'string') element = this.$(element);
    if (element) element.classList.toggle('hidden');
  },

  /**
   * Show toast notification
   */
  toast(message, type = 'info', duration = 3000) {
    const container = this.$('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 300);
    }, duration);
  },

  /**
   * Show loading overlay
   */
  showLoading(text = 'Loading...') {
    this.$('loading-text').textContent = text;
    this.$('progress-fill').style.width = '0%';
    this.$('progress-text').textContent = '';
    this.show('loading-overlay');
  },

  /**
   * Update loading progress
   */
  updateProgress(current, total, currentSymbol) {
    const percent = Math.round((current / total) * 100);
    this.$('progress-fill').style.width = `${percent}%`;
    this.$('progress-text').textContent = `${current}/${total} complete`;
    if (currentSymbol) {
      this.$('loading-text').textContent = `Analyzing ${currentSymbol}...`;
    }
  },

  /**
   * Hide loading overlay
   */
  hideLoading() {
    this.hide('loading-overlay');
  },

  /**
   * Switch to screen
   */
  switchScreen(screenId) {
    // Hide all screens
    this.$$('.screen').forEach(screen => screen.classList.add('hidden'));
    
    // Show target screen
    this.show(`${screenId}-screen`);
    
    // Update nav buttons
    this.$$('.nav-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.screen === screenId);
    });
  },

  /**
   * Create decision card HTML
   */
  createDecisionCard(decision) {
    const isNoTrade = decision.grade === 'no-trade';
    const gradeClass = decision.grade === 'A+' ? 'grade-a' : 
                       decision.grade === 'B' ? 'grade-b' : '';
    
    const directionClass = decision.direction === 'long' ? 'direction-long' :
                           decision.direction === 'short' ? 'direction-short' : 'direction-none';
    
    const directionText = decision.direction === 'long' ? '▲ LONG' :
                          decision.direction === 'short' ? '▼ SHORT' : '— NO TRADE';

    const gradeDisplay = decision.grade === 'A+' ? 'A+' :
                         decision.grade === 'B' ? 'B' : '—';
    
    const gradeBadgeClass = decision.grade === 'A+' ? 'grade-a-plus' :
                            decision.grade === 'B' ? 'grade-b' : 'grade-no-trade';

    // Build trade info section
    let tradeInfoHTML = '';
    if (!isNoTrade && decision.entryZone) {
      tradeInfoHTML = `
        <div class="card-trade-info">
          <div class="trade-item">
            <span class="trade-label">Entry Zone</span>
            <span class="trade-value">${decision.entryZone.formatted}</span>
          </div>
          <div class="trade-item">
            <span class="trade-label">Stop Loss</span>
            <span class="trade-value">${decision.stopLoss?.formatted || '—'}</span>
          </div>
          <div class="trade-item">
            <span class="trade-label">Take Profit</span>
            <span class="trade-value">${decision.takeProfit?.formatted || '—'}</span>
          </div>
          <div class="trade-item">
            <span class="trade-label">Position</span>
            <span class="trade-value">${decision.position?.lots || '—'} lots</span>
          </div>
        </div>
      `;
    }

    // Format time
    const timestamp = new Date(decision.timestamp).toLocaleString();
    const validUntil = new Date(decision.validUntil);
    const isExpired = validUntil < new Date();
    const validText = isExpired ? 'Expired' : `Valid until ${validUntil.toLocaleTimeString()}`;

    return `
      <div class="decision-card ${gradeClass}" data-symbol="${decision.symbol}" data-grade="${decision.grade}">
        <div class="card-header">
          <div>
            <span class="card-symbol">${decision.displayName}</span>
            <span class="card-grade ${gradeBadgeClass}">${gradeDisplay}</span>
          </div>
          <span class="card-direction ${directionClass}">${directionText}</span>
        </div>
        <div class="card-body">
          ${tradeInfoHTML}
          <div class="card-reason">"${decision.reason}"</div>
        </div>
        <div class="card-footer">
          <span>${decision.timeframes.trend}/${decision.timeframes.entry} | ${validText}</span>
          <div class="card-actions">
            ${!isNoTrade ? `<button class="btn btn-small" onclick="App.copySignal('${decision.symbol}')">📋 Copy</button>` : ''}
          </div>
        </div>
      </div>
    `;
  },

  /**
   * Render decision cards
   */
  renderResults(decisions, filter = 'all') {
    const container = this.$('results-container');
    
    if (!decisions || decisions.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">📋</div>
          <p>No results yet</p>
          <p class="empty-hint">Go to Watchlist and scan some symbols</p>
          <button class="btn btn-primary" id="go-to-watchlist-btn" onclick="App.switchScreen('watchlist')">Open Watchlist</button>
        </div>
      `;
      this.hide('results-footer');
      return;
    }

    // Filter results
    let filtered = decisions;
    switch (filter) {
      case 'trades':
        filtered = decisions.filter(d => d.grade !== 'no-trade');
        break;
      case 'a+':
        filtered = decisions.filter(d => d.grade === 'A+');
        break;
      case 'no-trade':
        filtered = decisions.filter(d => d.grade === 'no-trade');
        break;
    }

    if (filtered.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🔍</div>
          <p>No ${filter} signals found</p>
        </div>
      `;
      return;
    }

    container.innerHTML = filtered.map(d => this.createDecisionCard(d)).join('');
    this.show('results-footer');
  },

  /**
   * Render symbol grid
   */
  renderSymbolGrid(containerId, symbols, selectedSymbols = []) {
    const container = this.$(containerId);
    container.innerHTML = symbols.map(symbol => {
      const isSelected = selectedSymbols.includes(symbol);
      return `
        <label class="symbol-item ${isSelected ? 'selected' : ''}" data-symbol="${symbol}">
          <input type="checkbox" ${isSelected ? 'checked' : ''}>
          ${symbol}
        </label>
      `;
    }).join('');
  },

  /**
   * Update selection count
   */
  updateSelectionCount(count) {
    this.$('selected-count').textContent = count;
    this.$('scan-btn').disabled = count === 0;
    
    // Estimate scan time
    const callsPerSymbol = 8;
    const callsPerSecond = 2;
    const totalCalls = count * callsPerSymbol;
    const estimatedSeconds = Math.ceil(totalCalls / callsPerSecond);
    
    if (count > 0) {
      this.$('scan-estimate').textContent = `~${estimatedSeconds}s scan time`;
    } else {
      this.$('scan-estimate').textContent = '';
    }
  },
};

// Export for use in other scripts
window.UI = UI;
