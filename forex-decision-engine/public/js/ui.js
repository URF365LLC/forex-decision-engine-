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
      <div class="decision-card ${gradeClass} ${staleClass}" data-key="${decisionKey}" data-symbol="${decision.symbol}" data-strategy="${decision.strategyId}" data-grade="${decision.grade}" tabindex="0" role="article" aria-label="${decision.displayName} ${decision.direction || 'no trade'} signal, Grade ${decision.grade}">
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
   * Render decision cards (legacy card-based view)
   */
  renderResults(decisions, filter = 'all') {
    const container = this.$('results-container');
    
    // Skip if container doesn't exist (new dashboard uses table view)
    if (!container) return;
    
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
          <button class="btn btn-primary" id="go-to-watchlist-btn" onclick="App.switchScreen('dashboard')">
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
    if (!container) return;
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
   * Render watchlist sidebar (Bloomberg style)
   * Now handles multi-signal structure: signalsBySymbol[symbol] = Decision[]
   */
  renderWatchlistSidebar(containerId, symbols, selectedSymbols = [], signalsBySymbol = {}) {
    const container = this.$(containerId);
    if (!container) return;

    container.innerHTML = symbols.map(symbol => {
      const isSelected = selectedSymbols.includes(symbol);
      const signals = signalsBySymbol[symbol] || [];  // Array of decisions
      const signalCount = signals.length;

      // Determine dominant direction (most signals)
      let longCount = 0, shortCount = 0;
      for (const s of signals) {
        if (s.direction === 'long') longCount++;
        else if (s.direction === 'short') shortCount++;
      }
      const dominantDirection = longCount > shortCount ? 'long' : shortCount > 0 ? 'short' : 'none';

      // Find best grade
      const gradeOrder = ['A+', 'A', 'B+', 'B', 'C'];
      let bestGrade = 'C';
      for (const s of signals) {
        if (gradeOrder.indexOf(s.grade) < gradeOrder.indexOf(bestGrade)) {
          bestGrade = s.grade;
        }
      }

      return `
        <div class="watchlist-item-compact ${isSelected ? 'selected' : ''}" data-symbol="${symbol}">
          <input type="checkbox" ${isSelected ? 'checked' : ''}>
          <span class="symbol-name">${symbol}</span>
          ${signalCount > 0 ? `
            <span class="signal-badge ${dominantDirection}" title="${signalCount} signal(s), best: ${bestGrade}">
              ${signalCount > 1 ? signalCount : ''}
            </span>
            <span class="signal-indicator" style="background:var(--${dominantDirection === 'long' ? 'positive' : 'negative'})"></span>
          ` : ''}
        </div>
      `;
    }).join('');
  },

  /**
   * Render signals as Bloomberg-style data table
   */
  renderSignalsTable(decisions = [], filter = 'all') {
    const tbody = this.$('signals-tbody');
    if (!tbody) return;

    let filtered = decisions;
    switch (filter) {
      case 'trades':
        filtered = decisions.filter(d => d.grade !== 'no-trade');
        break;
      case 'a+':
        filtered = decisions.filter(d => d.grade === 'A+');
        break;
    }

    if (filtered.length === 0) {
      tbody.innerHTML = '<tr><td colspan="11" class="empty-cell">No signals found. Select instruments and scan.</td></tr>';
      return;
    }

    tbody.innerHTML = filtered.map(d => {
      const dirClass = d.direction === 'long' ? 'long' : 'short';
      const gradeClass = d.grade.replace('+', '-plus').toLowerCase();
      const tp1 = d.tieredExits?.tp1?.formatted || d.takeProfit?.formatted || '-';
      const tp2 = d.tieredExits?.tp2?.formatted || '-';
      const lots = d.positionSize?.recommendedLots || d.lotSize || '-';
      const rr = d.riskReward ? d.riskReward.toFixed(1) : '-';
      const stratName = d.strategyName || d.strategyId || '-';
      const key = `${d.strategyId || 'default'}:${d.symbol}`;

      return `
        <tr data-key="${key}">
          <td class="col-symbol">${d.symbol}</td>
          <td class="col-direction ${dirClass}">${d.direction?.toUpperCase() || '-'}</td>
          <td class="col-grade"><span class="grade-badge ${gradeClass}">${d.grade}</span></td>
          <td class="col-price">${d.entry?.formatted || '-'}</td>
          <td class="col-price">${d.stopLoss?.formatted || '-'}</td>
          <td class="col-price">${tp1}</td>
          <td class="col-price">${tp2}</td>
          <td class="col-numeric">${lots}</td>
          <td class="col-numeric">${rr}</td>
          <td>${stratName}</td>
          <td class="col-actions">
            ${d.grade !== 'no-trade' ? `
              <button class="table-btn primary" onclick="App.takeSignalTrade('${key}')">Take</button>
              <button class="table-btn" onclick="App.copySignal('${key}')">Copy</button>
            ` : ''}
          </td>
        </tr>
      `;
    }).join('');

    // Update signal count
    const signalCount = this.$('ticker-signals');
    if (signalCount) signalCount.textContent = filtered.filter(d => d.grade !== 'no-trade').length;
    
    const metricSignals = this.$('metric-signals');
    if (metricSignals) metricSignals.textContent = filtered.filter(d => d.grade !== 'no-trade').length;
  },

  /**
   * Render journal entries as Bloomberg-style data table
   */
  renderJournalTable(entries = []) {
    const tbody = this.$('journal-tbody');
    if (!tbody) return;

    if (entries.length === 0) {
      tbody.innerHTML = '<tr><td colspan="13" class="empty-cell">No trades logged yet</td></tr>';
      return;
    }

    tbody.innerHTML = entries.map(e => {
      const dirClass = e.direction === 'long' ? 'long' : 'short';
      const date = new Date(e.entryDate || e.createdAt).toLocaleDateString();
      const pnlClass = e.pnlDollars > 0 ? 'pnl-positive' : e.pnlDollars < 0 ? 'pnl-negative' : 'pnl-zero';
      const pnlDisplay = e.pnlDollars != null ? `$${e.pnlDollars.toFixed(2)}` : '-';
      const rDisplay = e.rMultiple != null ? `${e.rMultiple.toFixed(2)}R` : '-';
      const statusClass = e.result === 'win' ? 'win' : e.result === 'loss' ? 'loss' : e.status;

      return `
        <tr data-id="${e.id}">
          <td>${date}</td>
          <td class="col-symbol">${e.symbol}</td>
          <td class="col-direction ${dirClass}">${e.direction?.toUpperCase() || '-'}</td>
          <td><span class="grade-badge ${(e.grade || '').replace('+', '-plus').toLowerCase()}">${e.grade || '-'}</span></td>
          <td class="col-price">${e.entryPrice?.toFixed(5) || '-'}</td>
          <td class="col-price">${e.stopLoss?.toFixed(5) || '-'}</td>
          <td class="col-price">${e.takeProfit?.toFixed(5) || '-'}</td>
          <td class="col-price">${e.exitPrice?.toFixed(5) || '-'}</td>
          <td class="col-numeric">${e.lotSize || '-'}</td>
          <td class="col-pnl ${pnlClass}">${pnlDisplay}</td>
          <td class="col-numeric">${rDisplay}</td>
          <td><span class="status-badge-inline ${statusClass}">${e.status}</span></td>
          <td class="col-actions">
            ${e.status === 'running' ? `<button class="table-btn" onclick="App.openCloseTrade('${e.id}')">Close</button>` : ''}
            ${e.status === 'pending' ? `<button class="table-btn" onclick="App.fillPendingTrade('${e.id}')">Fill</button>` : ''}
            <button class="table-btn danger" onclick="App.cancelTrade('${e.id}')">Del</button>
          </td>
        </tr>
      `;
    }).join('');
  },

  /**
   * Render running trades in dashboard bottom panel
   */
  renderRunningTrades(entries = []) {
    const tbody = this.$('running-trades-tbody');
    if (!tbody) return;

    const running = entries.filter(e => e.status === 'running' || e.status === 'pending');

    if (running.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" class="empty-cell">No running trades</td></tr>';
      return;
    }

    tbody.innerHTML = running.map(e => {
      const dirClass = e.direction === 'long' ? 'long' : 'short';
      const pnlClass = e.unrealizedPnl > 0 ? 'pnl-positive' : e.unrealizedPnl < 0 ? 'pnl-negative' : 'pnl-zero';

      return `
        <tr data-id="${e.id}">
          <td class="col-symbol">${e.symbol}</td>
          <td class="col-direction ${dirClass}">${e.direction?.toUpperCase() || '-'}</td>
          <td class="col-price">${e.entryPrice?.toFixed(5) || '-'}</td>
          <td class="col-price">${e.currentPrice?.toFixed(5) || '-'}</td>
          <td class="col-pnl ${pnlClass}">${e.unrealizedPnl ? `$${e.unrealizedPnl.toFixed(2)}` : '-'}</td>
          <td class="col-numeric">${e.lotSize || '-'}</td>
          <td><span class="status-badge-inline ${e.status}">${e.status}</span></td>
          <td class="col-actions">
            ${e.status === 'running' ? `<button class="table-btn" onclick="App.openCloseTrade('${e.id}')">Close</button>` : ''}
            ${e.status === 'pending' ? `<button class="table-btn" onclick="App.fillPendingTrade('${e.id}')">Fill</button>` : ''}
          </td>
        </tr>
      `;
    }).join('');

    // Update position count
    const metricPositions = this.$('metric-positions');
    if (metricPositions) metricPositions.textContent = running.length;
  },

  /**
   * Update selection count
   */
  updateSelectionCount(count) {
    const countEl = this.$('selected-count');
    const scanBtn = this.$('scan-btn');
    const scanEstimate = this.$('scan-estimate');
    
    if (countEl) countEl.textContent = count;
    if (scanBtn) scanBtn.disabled = count === 0;
    
    // Estimate scan time
    const callsPerSymbol = 8;
    const callsPerSecond = 2;
    const totalCalls = count * callsPerSymbol;
    const estimatedSeconds = Math.ceil(totalCalls / callsPerSecond);
    
    if (scanEstimate) {
      if (count > 0) {
        scanEstimate.textContent = `~${estimatedSeconds}s scan time`;
      } else {
        scanEstimate.textContent = '';
      }
    }
    
    // Update dashboard selection count if present
    const dashboardCount = this.$('dashboard-selected-count');
    if (dashboardCount) dashboardCount.textContent = count;
  },
  
  createSentimentBadge(sentiment) {
    if (!sentiment) return '';
    
    const ratingEmoji = {
      'extremely_bullish': '🟢🟢',
      'bullish': '🟢',
      'slightly_bullish': '🟢',
      'neutral': '⚪',
      'slightly_bearish': '🔴',
      'bearish': '🔴',
      'extremely_bearish': '🔴🔴'
    }[sentiment.rating] || '⚪';
    
    const ratingClass = this.getSentimentClass(sentiment.rating);
    const scoreDisplay = sentiment.score > 0 ? `+${sentiment.score}` : sentiment.score;
    const ratingLabel = sentiment.rating.replace(/_/g, ' ').toUpperCase();
    
    const shortTerm = sentiment.shortTermBias;
    const longTerm = sentiment.longTermBias;
    const contrarian = sentiment.contrarian;
    
    let biasHTML = '';
    if (shortTerm && longTerm) {
      const stClass = this.getSentimentClass(shortTerm.rating);
      const ltClass = this.getSentimentClass(longTerm.rating);
      const stLabel = shortTerm.rating.replace(/_/g, ' ');
      const ltLabel = longTerm.rating.replace(/_/g, ' ');
      
      biasHTML = `
        <div class="sentiment-bias-split">
          <div class="bias-item ${stClass}">
            <span class="bias-label">Short-term</span>
            <span class="bias-value">${stLabel} (${shortTerm.score > 0 ? '+' : ''}${shortTerm.score})</span>
          </div>
          <div class="bias-item ${ltClass}">
            <span class="bias-label">Long-term</span>
            <span class="bias-value">${ltLabel} (${longTerm.score > 0 ? '+' : ''}${longTerm.score})</span>
          </div>
        </div>
      `;
    }
    
    let contrarianHTML = '';
    if (contrarian && contrarian.detected) {
      const typeLabel = (contrarian.type || '').replace(/_/g, ' ').toUpperCase();
      contrarianHTML = `
        <div class="contrarian-warning">
          <span class="contrarian-icon">⚠️</span>
          <span class="contrarian-type">${typeLabel}</span>
          <span class="contrarian-strength">${contrarian.strength}%</span>
          ${contrarian.warning ? `<span class="contrarian-message">${contrarian.warning}</span>` : ''}
        </div>
      `;
    }
    
    let consensusHTML = '';
    if (sentiment.consensusLevel !== undefined) {
      const consensusLevel = sentiment.consensusLevel;
      const consensusClass = consensusLevel > 75 ? 'consensus-extreme' : consensusLevel > 50 ? 'consensus-high' : 'consensus-normal';
      consensusHTML = `<span class="consensus-indicator ${consensusClass}" title="Consensus: ${consensusLevel}%">C:${consensusLevel}%</span>`;
    }
    
    const sparklineHTML = sentiment.history && sentiment.history.length >= 2
      ? `<div class="sparkline-container">
          <span class="sparkline-label">Trend</span>
          ${this.createSparkline(sentiment.history)}
        </div>`
      : '';
    
    const varianceHTML = sentiment.variance !== undefined
      ? `<span class="variance-indicator" title="Score variance across samples">±${sentiment.variance}</span>`
      : '';
    
    return `
      <div class="sentiment-badge ${ratingClass}">
        <div class="sentiment-header">
          <span class="sentiment-icon">${ratingEmoji}</span>
          <span class="sentiment-rating">${ratingLabel}</span>
          <span class="sentiment-score">${scoreDisplay}</span>
          ${varianceHTML}
          ${consensusHTML}
        </div>
        ${sentiment.summary ? `<div class="sentiment-summary">${sentiment.summary}</div>` : ''}
        ${sparklineHTML}
        ${biasHTML}
        ${contrarianHTML}
      </div>
    `;
  },
  
  getSentimentClass(rating) {
    const ratingNorm = (rating || '').toLowerCase();
    if (ratingNorm.includes('extremely_bullish') || ratingNorm.includes('extremely bullish')) return 'sentiment-extremely-bullish';
    if (ratingNorm.includes('slightly_bullish') || ratingNorm.includes('slightly bullish')) return 'sentiment-slightly-bullish';
    if (ratingNorm.includes('bullish')) return 'sentiment-bullish';
    if (ratingNorm.includes('extremely_bearish') || ratingNorm.includes('extremely bearish')) return 'sentiment-extremely-bearish';
    if (ratingNorm.includes('slightly_bearish') || ratingNorm.includes('slightly bearish')) return 'sentiment-slightly-bearish';
    if (ratingNorm.includes('bearish')) return 'sentiment-bearish';
    return 'sentiment-neutral';
  },
  
  createSparkline(history, width = 80, height = 24) {
    if (!history || history.length < 2) {
      return '<span class="sparkline-empty">--</span>';
    }
    
    const scores = history.map(h => h.score);
    const min = Math.min(...scores);
    const max = Math.max(...scores);
    const range = max - min || 1;
    
    const points = scores.map((score, i) => {
      const x = (i / (scores.length - 1)) * width;
      const y = height - ((score - min) / range) * height;
      return `${x},${y}`;
    }).join(' ');
    
    const lastScore = scores[scores.length - 1];
    const strokeColor = lastScore > 15 ? 'var(--success)' : lastScore < -15 ? 'var(--danger)' : 'var(--text-muted)';
    
    return `
      <svg class="sparkline" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
        <polyline fill="none" stroke="${strokeColor}" stroke-width="1.5" points="${points}" />
      </svg>
    `;
  },
  
  createMarketSidebar(overview) {
    if (!overview || overview.symbols.length === 0) {
      return `
        <div class="market-sidebar">
          <h3 class="sidebar-title">Market Sentiment</h3>
          <p class="sidebar-empty">No sentiment data available. Fetch sentiment for symbols to see market overview.</p>
        </div>
      `;
    }
    
    const skew = overview.avgScore > 15 ? 'Bullish' : overview.avgScore < -15 ? 'Bearish' : 'Neutral';
    const skewClass = overview.avgScore > 15 ? 'skew-bullish' : overview.avgScore < -15 ? 'skew-bearish' : 'skew-neutral';
    
    const moversHTML = (overview.topMovers || []).map(m => {
      const changeClass = m.change > 0 ? 'mover-up' : m.change < 0 ? 'mover-down' : 'mover-flat';
      const arrow = m.change > 0 ? '↑' : m.change < 0 ? '↓' : '→';
      return `
        <div class="mover-item ${changeClass}">
          <span class="mover-symbol">${m.symbol}</span>
          <span class="mover-change">${arrow} ${Math.abs(m.change)}</span>
        </div>
      `;
    }).join('');
    
    return `
      <div class="market-sidebar">
        <h3 class="sidebar-title">Market Sentiment</h3>
        
        <div class="sidebar-stat">
          <span class="stat-label">Overall Skew</span>
          <span class="stat-value ${skewClass}">${skew} (${overview.avgScore > 0 ? '+' : ''}${overview.avgScore})</span>
        </div>
        
        <div class="sidebar-stat">
          <span class="stat-label">Bullish</span>
          <span class="stat-value text-success">${overview.bullishCount} symbols</span>
        </div>
        
        <div class="sidebar-stat">
          <span class="stat-label">Bearish</span>
          <span class="stat-value text-danger">${overview.bearishCount} symbols</span>
        </div>
        
        <div class="sidebar-section">
          <h4 class="section-title">Top Movers</h4>
          ${moversHTML || '<p class="sidebar-empty">No significant moves</p>'}
        </div>
      </div>
    `;
  },
  
  updateMarketSidebar(overview) {
    const container = this.$('market-sidebar-container');
    if (container) {
      container.innerHTML = this.createMarketSidebar(overview);
    }
  },
};

// Export for use in other scripts
window.UI = UI;
