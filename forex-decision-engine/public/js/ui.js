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
   * Set button loading state
   */
  setButtonLoading(btnOrId, loading = true, originalText = null) {
    const btn = typeof btnOrId === 'string' ? this.$(btnOrId) : btnOrId;
    if (!btn) return;
    
    if (loading) {
      btn.dataset.originalText = btn.textContent;
      btn.classList.add('loading');
      btn.disabled = true;
    } else {
      btn.classList.remove('loading');
      btn.disabled = false;
      if (originalText !== null) {
        btn.textContent = originalText;
      } else if (btn.dataset.originalText) {
        btn.textContent = btn.dataset.originalText;
        delete btn.dataset.originalText;
      }
    }
  },

  /**
   * Show toast notification with enhanced styling
   */
  toast(message, type = 'info', duration = 3000) {
    const container = this.$('toast-container');
    if (!container) return;
    
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    const textSpan = document.createElement('span');
    textSpan.textContent = message;
    toast.appendChild(textSpan);
    
    // Add close button for longer toasts
    if (duration > 3000 || type === 'error') {
      const closeBtn = document.createElement('button');
      closeBtn.innerHTML = '×';
      closeBtn.style.cssText = 'background:none;border:none;color:var(--text-muted);cursor:pointer;padding:0 0 0 8px;font-size:1.2rem;opacity:0.7;';
      closeBtn.onclick = () => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(10px)';
        setTimeout(() => toast.remove(), 200);
      };
      toast.appendChild(closeBtn);
    }
    
    container.appendChild(toast);

    // Store reference for persistent toasts
    if (duration === 0) {
      return toast;
    }

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      setTimeout(() => toast.remove(), 300);
    }, duration);
    
    return toast;
  },
  
  /**
   * Show persistent loading toast (returns dismiss function)
   */
  loadingToast(message) {
    const toast = this.toast(message, 'loading', 0);
    return () => {
      if (toast && toast.parentElement) {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(10px)';
        setTimeout(() => toast.remove(), 200);
      }
    };
  },

  /**
   * Render skeleton loaders
   */
  showSkeletons(containerId, count = 3, type = 'card') {
    const container = this.$(containerId);
    if (!container) return;
    
    let html = '';
    if (type === 'stat') {
      // Stats are in a flex row
      html = '<div class="skeleton-row">';
      for (let i = 0; i < count; i++) {
        html += '<div class="skeleton skeleton-stat"></div>';
      }
      html += '</div>';
    } else {
      for (let i = 0; i < count; i++) {
        if (type === 'card') {
          html += '<div class="skeleton skeleton-card"></div>';
        } else if (type === 'text') {
          html += '<div class="skeleton skeleton-text medium"></div>';
        }
      }
    }
    container.innerHTML = html;
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
    const hasErrors = decision.errors && decision.errors.length > 0;
    const isNoTrade = decision.grade === 'no-trade';
    const isError = hasErrors && isNoTrade;
    
    // Extended grade support for new strategies
    const gradeClass = ['A+', 'A'].includes(decision.grade) ? 'grade-a' :
                       ['B+', 'B'].includes(decision.grade) ? 'grade-b' :
                       decision.grade === 'C' ? 'grade-c' :
                       isError ? 'grade-error' : '';
    
    const directionClass = decision.direction === 'long' ? 'direction-long' :
                           decision.direction === 'short' ? 'direction-short' : 'direction-none';
    
    const directionText = decision.direction === 'long' ? '▲ LONG' :
                          decision.direction === 'short' ? '▼ SHORT' : 
                          isError ? '⚠️ ERROR' : '— NO TRADE';

    const gradeDisplay = ['A+', 'A', 'B+', 'B', 'C'].includes(decision.grade) ? decision.grade :
                         isError ? '⚠️' : '—';
    
    const gradeBadgeClass = decision.grade === 'A+' ? 'grade-a-plus' :
                            decision.grade === 'A' ? 'grade-a' :
                            decision.grade === 'B+' ? 'grade-b-plus' :
                            decision.grade === 'B' ? 'grade-b' :
                            decision.grade === 'C' ? 'grade-c' :
                            isError ? 'grade-error' : 'grade-no-trade';

    // Strategy info section
    const strategyInfo = decision.strategyName ? 
      `<div class="card-strategy">
        <span class="strategy-name">${decision.strategyName}</span>
        ${decision.confidence !== undefined ? 
          `<span class="strategy-confidence">${decision.confidence}%</span>` : ''}
      </div>` : '';
    
    // Reason codes (tags)
    const reasonCodesHTML = decision.reasonCodes && decision.reasonCodes.length > 0 ?
      `<div class="reason-tags">
        ${decision.reasonCodes.map(code => 
          `<span class="reason-tag">${code.replace(/_/g, ' ')}</span>`
        ).join('')}
      </div>` : '';
    
    // Warnings (preflight/safety checks) - show for both trades and no-trades
    const warningsHTML = decision.warnings && decision.warnings.length > 0 ?
      `<div class="warnings-list">
        ${decision.warnings.map(warning => 
          `<div class="warning-item">⚠️ ${warning}</div>`
        ).join('')}
      </div>` : '';
    
    // For no-trade cards, show the rejection reason more prominently
    const noTradeReasonHTML = isNoTrade && decision.reason && decision.reason !== 'No trade setup found' ?
      `<div class="rejection-reason">🚫 ${decision.reason}</div>` : '';

    // Build trade info section - handle NEXT_OPEN execution model + tiered exits
    let tradeInfoHTML = '';
    if (!isNoTrade) {
      const entryDisplay = decision.entryZone?.formatted ||
        (decision.entry?.formatted ? `${decision.entry.formatted} (NEXT_OPEN)` : '—');

      // Tiered exit management display
      const exitMgmt = decision.exitManagement;
      const tp1 = exitMgmt?.tieredExits?.[0]; // TP1 at 1R
      const tp2 = exitMgmt?.tieredExits?.[1]; // TP2 at 2R

      const tieredExitsHTML = exitMgmt ? `
        <div class="tiered-exits">
          <div class="tiered-exit-header">📊 Exit Management (Tiered)</div>
          <div class="tiered-exit-row">
            <span class="tiered-label">TP1 (+1R)</span>
            <span class="tiered-value">${tp1?.formatted || '—'}</span>
            <span class="tiered-action">Close 50%, move SL to BE</span>
          </div>
          <div class="tiered-exit-row">
            <span class="tiered-label">TP2 (+2R)</span>
            <span class="tiered-value">${tp2?.formatted || '—'}</span>
            <span class="tiered-action">Close remaining 50%</span>
          </div>
          ${exitMgmt.trailingStop ? `
          <div class="tiered-exit-row trail">
            <span class="tiered-label">Trail</span>
            <span class="tiered-value">${exitMgmt.trailingStop.trailDistancePips} pips</span>
            <span class="tiered-action">After TP1, trail stop behind price</span>
          </div>
          ` : ''}
        </div>
      ` : '';

      tradeInfoHTML = `
        <div class="card-trade-info">
          <div class="trade-item">
            <span class="trade-label">Entry</span>
            <span class="trade-value">${entryDisplay}</span>
          </div>
          <div class="trade-item">
            <span class="trade-label">Stop Loss</span>
            <span class="trade-value loss">${decision.stopLoss?.formatted || '—'}</span>
          </div>
          <div class="trade-item">
            <span class="trade-label">Take Profit</span>
            <span class="trade-value profit">${decision.takeProfit?.formatted || '—'} (${decision.takeProfit?.rr || 2}R)</span>
          </div>
          <div class="trade-item">
            <span class="trade-label">Position</span>
            <span class="trade-value">${decision.position?.lots || '—'} lots</span>
          </div>
        </div>
        ${tieredExitsHTML}
      `;
    }

    // Format time and validity window
    const timestamp = new Date(decision.timestamp).toLocaleString();
    const timing = decision.timing || {};
    const validUntil = new Date(timing.validUntil || decision.validUntil);
    const degradeAfter = timing.degradeAfter ? new Date(timing.degradeAfter) : null;
    const isExpired = validUntil < new Date();
    const timingState = timing.state || (isExpired ? 'expired' : 'optimal');
    const validText = isExpired ? 'Expired' : `Valid until ${validUntil.toLocaleTimeString()}`;
    const degradeText = degradeAfter ? `Degrades after ${degradeAfter.toLocaleTimeString()}` : '';

    // Signal freshness display
    const signalAgeDisplay = decision.timing?.signalAge?.display || '';
    const isStale = decision.timing?.isStale || isExpired;
    const staleClass = isStale ? 'stale-signal' : '';
    const freshnessHTML = signalAgeDisplay ?
      `<span class="signal-age ${isStale ? 'stale' : ''}">🕐 Detected ${signalAgeDisplay}</span>` : '';

    // Optimal entry window display
    const optimalWindow = decision.timing?.optimalEntryWindow || decision.timing?.optimalWindowMinutes;
    const optimalHTML = optimalWindow && timingState === 'optimal' ?
      `<span class="optimal-window">⏱️ Best entry within ${optimalWindow} min</span>` : '';

    // Sentiment display - no longer on decision object, fetched on-demand
    const sentimentHTML = '';

    const decisionKey = `${decision.strategyId}:${decision.symbol}`;
    const sentimentId = `sentiment-${decision.strategyId}-${decision.symbol}`.replace(/[^a-zA-Z0-9-]/g, '-');

    return `
      <div class="decision-card ${gradeClass} ${staleClass}" data-key="${decisionKey}" data-symbol="${decision.symbol}" data-strategy="${decision.strategyId}" data-grade="${decision.grade}">
        <div class="card-header">
          <div>
            <span class="card-symbol">${decision.displayName}</span>
            <span class="card-grade ${gradeBadgeClass}">${gradeDisplay}</span>
          </div>
          <span class="card-direction ${directionClass}">${directionText}</span>
        </div>
        ${strategyInfo}
        <div class="card-body">
          ${tradeInfoHTML}
          ${noTradeReasonHTML}
          ${warningsHTML}
          ${optimalHTML}
          ${freshnessHTML}
          ${sentimentHTML}
          ${reasonCodesHTML}
          ${!isNoTrade || !noTradeReasonHTML ? `<div class="card-reason">"${decision.reason}"</div>` : ''}
        </div>
        <div class="card-footer">
          <span class="timing ${timingState}">
            ${decision.timeframes?.trend || 'H4'}/${decision.timeframes?.entry || 'H1'} | ${validText}${degradeText ? ` • ${degradeText}` : ''}
          </span>
          <div class="card-actions">
            ${!isNoTrade ? `<button class="btn btn-small" onclick="App.copySignal('${decisionKey}')">📋 Copy</button>` : ''}
          </div>
        </div>
        ${!isNoTrade ? `
        <div class="card-journal-actions">
          <button class="btn btn-journal btn-taken" onclick="App.logTrade('${decisionKey}', 'taken')">✓ Took Trade</button>
          <button class="btn btn-journal btn-skipped" onclick="App.logTrade('${decisionKey}', 'skipped')">✗ Skipped</button>
          <button class="btn btn-journal btn-missed" onclick="App.logTrade('${decisionKey}', 'missed')">⏰ Missed</button>
        </div>
        <div class="sentiment-container" id="${sentimentId}">
          <button class="btn btn-sentiment" onclick="App.fetchSentiment('${decision.symbol}', '${sentimentId}')">🧠 Get Sentiment</button>
        </div>
        ` : ''}
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
        <div class="empty-state enhanced">
          <div class="empty-illustration">
            <div class="empty-icon-stack">
              <span class="empty-icon-main">📊</span>
              <span class="empty-icon-sub">🎯</span>
            </div>
          </div>
          <h3 class="empty-title">No scan results yet</h3>
          <p class="empty-hint">Select symbols from your watchlist and run a scan to find trading opportunities</p>
          <button class="btn btn-primary" id="go-to-watchlist-btn" onclick="App.switchScreen('watchlist')">
            Open Watchlist
          </button>
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
      const filterLabels = {
        'trades': 'trade signals',
        'a+': 'A+ signals',
        'no-trade': 'no-trade results'
      };
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🔍</div>
          <p>No ${filterLabels[filter] || filter} found</p>
          <p class="empty-hint">Try adjusting your filter or running a new scan</p>
        </div>
      `;
      return;
    }

    container.innerHTML = filtered.map(d => this.createDecisionCard(d)).join('');
    this.show('results-footer');
  },

  /**
   * Render symbol grid with displayName support
   */
  renderSymbolGrid(containerId, symbols, selectedSymbols = [], metadata = {}) {
    const container = this.$(containerId);
    container.innerHTML = symbols.map(symbol => {
      const isSelected = selectedSymbols.includes(symbol);
      const displayName = metadata[symbol]?.displayName || symbol;
      return `
        <label class="symbol-item ${isSelected ? 'selected' : ''}" data-symbol="${symbol}">
          <input type="checkbox" ${isSelected ? 'checked' : ''}>
          ${displayName}
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
  
  createSentimentBadge(sentiment) {
    if (!sentiment) return '';
    
    const ratingEmoji = {
      'bullish': '🟢',
      'bearish': '🔴',
      'neutral': '⚪',
      'mixed': '🟡'
    }[sentiment.rating] || '⚪';
    
    const ratingClass = {
      'bullish': 'sentiment-bullish',
      'bearish': 'sentiment-bearish',
      'neutral': 'sentiment-neutral',
      'mixed': 'sentiment-mixed'
    }[sentiment.rating] || 'sentiment-neutral';
    
    const scoreDisplay = sentiment.score > 0 ? `+${sentiment.score}` : sentiment.score;
    
    return `
      <div class="sentiment-badge ${ratingClass}">
        <span class="sentiment-icon">${ratingEmoji}</span>
        <span class="sentiment-rating">${sentiment.rating.toUpperCase()}</span>
        <span class="sentiment-score">${scoreDisplay}</span>
        ${sentiment.summary ? `<span class="sentiment-summary">${sentiment.summary}</span>` : ''}
      </div>
    `;
  },
};

// Export for use in other scripts
window.UI = UI;
