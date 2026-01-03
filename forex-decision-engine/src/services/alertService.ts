/**
 * Alert Service
 * Sends email notifications for new trade signals using Resend
 */

import { createLogger } from './logger.js';
import { Decision, SignalGrade } from '../strategies/types.js';

const logger = createLogger('AlertService');

class AlertService {
  private resendApiKey: string | null = null;
  private fromEmail: string = 'Forex Engine <alerts@resend.dev>';
  private sentAlerts: Map<string, { grade: SignalGrade; expiresAt: number; lastSent: string }> = new Map();
  
  constructor() {
    this.resendApiKey = process.env.RESEND_API_KEY || null;
    
    if (!this.resendApiKey) {
      logger.warn('RESEND_API_KEY not configured - email alerts disabled');
    }

    // Clean up expired dedupe windows
    setInterval(() => this.cleanup(), 5 * 60 * 1000);
  }
  
  async sendTradeAlert(decision: Decision, toEmail: string, context: { isNew?: boolean } = {}): Promise<boolean> {
    if (!this.resendApiKey) {
      logger.warn('Email alert skipped - RESEND_API_KEY not configured');
      return false;
    }

    const isNew = context.isNew ?? false;
    const sendCheck = this.shouldSend(decision, isNew);
    if (!sendCheck.allowed) {
      return false;
    }
    const key = this.makeKey(decision);
    
    try {
      const subject = `🎯 ${decision.grade} Signal: ${decision.symbol} ${decision.direction.toUpperCase()}`;
      const html = this.buildEmailHtml(decision, isNew);
      
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.resendApiKey}`,
        },
        body: JSON.stringify({
          from: this.fromEmail,
          to: toEmail,
          subject,
          html,
        }),
      });
      
      if (!response.ok) {
        const error = await response.text();
        logger.error(`Email send failed: ${response.status} - ${error}`);
        return false;
      }

      if (sendCheck.expiresAt) {
        this.sentAlerts.set(key, { grade: decision.grade, expiresAt: sendCheck.expiresAt, lastSent: new Date().toISOString() });
      }
      
      logger.info(`ALERT_SENT: ${decision.symbol} ${decision.grade} to ${toEmail}`);
      return true;
    } catch (error) {
      logger.error(`Email alert error: ${error}`);
      return false;
    }
  }
  
  private buildEmailHtml(decision: Decision, isNew: boolean): string {
    const gradeColor = {
      'A+': '#22c55e',
      'A': '#22c55e',
      'B+': '#eab308',
      'B': '#eab308',
      'C': '#94a3b8',
      'no-trade': '#ef4444',
    }[decision.grade] || '#94a3b8';
    
    const directionColor = decision.direction === 'long' ? '#22c55e' : '#ef4444';
    const directionLabel = decision.direction === 'long' ? 'BUY' : 'SELL';
    
    const signalAge = decision.timing?.signalAge?.display || 'Just detected';
    const entryPrice = decision.entry?.formatted || '-';
    const stopLossPrice = decision.stopLoss?.formatted || '-';
    const takeProfitPrice = decision.takeProfit?.formatted || '-';
    const lotSize = decision.position?.lots?.toFixed(2) || '-';
    const validity = decision.validUntil ? new Date(decision.validUntil).toUTCString() : 'Not provided';
    const gatingNotes: string[] = [];

    if (decision.gating?.volatilityBlocked) {
      gatingNotes.push(`Volatility: ${decision.gating.volatilityReason || 'Elevated ATR/volatility'}`);
    }
    if (decision.gating?.cooldownBlocked) {
      gatingNotes.push(`Cooldown: ${decision.gating.cooldownReason || 'Prior trade still valid'}`);
    }

    const gatingSummary = gatingNotes.length > 0 ? gatingNotes.join(' | ') : 'Clear: no gating blocks';
    const eventLabel = isNew
      ? 'New A-grade signal'
      : decision.upgrade
        ? `Upgrade: ${decision.upgrade.previousGrade} → ${decision.upgrade.newGrade}`
        : 'Signal update';
    
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Trade Alert</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #e2e8f0; padding: 20px; margin: 0;">
  <div style="max-width: 500px; margin: 0 auto; background: #1e293b; border-radius: 12px; padding: 24px;">
    <div style="text-align: center; margin-bottom: 20px;">
      <h1 style="color: ${gradeColor}; font-size: 48px; margin: 0;">${decision.grade}</h1>
      <p style="color: #94a3b8; margin: 5px 0;">${eventLabel}</p>
    </div>
    
    <div style="display: flex; justify-content: space-between; align-items: center; padding: 16px; background: #334155; border-radius: 8px; margin-bottom: 16px;">
      <div>
        <div style="font-size: 24px; font-weight: bold; color: #f1f5f9;">${decision.symbol}</div>
        <div style="color: #94a3b8;">${decision.strategyId || 'Strategy'}</div>
      </div>
      <div style="text-align: right;">
        <span style="background: ${directionColor}; color: white; padding: 8px 16px; border-radius: 4px; font-weight: bold; text-transform: uppercase;">
          ${directionLabel}
        </span>
      </div>
    </div>
    
    <table style="width: 100%; border-collapse: collapse;">
      <tr>
        <td style="padding: 12px 0; border-bottom: 1px solid #334155; color: #94a3b8;">Entry Price</td>
        <td style="padding: 12px 0; border-bottom: 1px solid #334155; text-align: right; font-weight: bold; color: #f1f5f9;">${entryPrice}</td>
      </tr>
      <tr>
        <td style="padding: 12px 0; border-bottom: 1px solid #334155; color: #94a3b8;">Stop Loss</td>
        <td style="padding: 12px 0; border-bottom: 1px solid #334155; text-align: right; color: #ef4444;">${stopLossPrice}</td>
      </tr>
      <tr>
        <td style="padding: 12px 0; border-bottom: 1px solid #334155; color: #94a3b8;">Take Profit</td>
        <td style="padding: 12px 0; border-bottom: 1px solid #334155; text-align: right; color: #22c55e;">${takeProfitPrice}</td>
      </tr>
      <tr>
        <td style="padding: 12px 0; border-bottom: 1px solid #334155; color: #94a3b8;">Lot Size</td>
        <td style="padding: 12px 0; border-bottom: 1px solid #334155; text-align: right; font-weight: bold; color: #f1f5f9;">${lotSize}</td>
      </tr>
      <tr>
        <td style="padding: 12px 0; border-bottom: 1px solid #334155; color: #94a3b8;">Confidence</td>
        <td style="padding: 12px 0; border-bottom: 1px solid #334155; text-align: right; color: #f1f5f9;">${decision.confidence || 0}%</td>
      </tr>
      <tr>
        <td style="padding: 12px 0; color: #94a3b8;">Signal Age</td>
        <td style="padding: 12px 0; text-align: right; color: #f1f5f9;">${signalAge}</td>
      </tr>
      <tr>
        <td style="padding: 12px 0; border-bottom: 1px solid #334155; color: #94a3b8;">Valid Until</td>
        <td style="padding: 12px 0; border-bottom: 1px solid #334155; text-align: right; color: #f1f5f9;">${validity}</td>
      </tr>
      <tr>
        <td style="padding: 12px 0; color: #94a3b8;">Gating</td>
        <td style="padding: 12px 0; text-align: right; color: #e2e8f0;">${gatingSummary}</td>
      </tr>
    </table>
    
    <div style="margin-top: 20px; padding: 12px; background: #0f172a; border-radius: 8px;">
      <div style="color: #94a3b8; font-size: 12px; margin-bottom: 8px;">REASONING</div>
      <div style="color: #e2e8f0; line-height: 1.5;">${decision.reason || 'No reasoning provided'}</div>
    </div>
    
    <div style="margin-top: 24px; text-align: center; color: #64748b; font-size: 12px;">
      Forex Decision Engine | Generated at ${new Date().toISOString()}
    </div>
  </div>
</body>
</html>
    `;
  }
  
  isConfigured(): boolean {
    return !!this.resendApiKey;
  }

  private makeKey(decision: Decision): string {
    return `${decision.symbol}:${decision.strategyId}:${decision.direction}`;
  }

  private getExpiry(decision: Decision): number {
    const validUntil = decision.validUntil ? new Date(decision.validUntil).getTime() : NaN;
    if (!Number.isNaN(validUntil) && validUntil > Date.now()) {
      return validUntil;
    }
    // Default validity: 4 hours (matches intraday signal window)
    return Date.now() + 4 * 60 * 60 * 1000;
  }

  private shouldSend(decision: Decision, isNew: boolean): { allowed: boolean; expiresAt?: number } {
    if (!['A', 'A+'].includes(decision.grade)) {
      logger.debug(`Alert skipped - grade ${decision.grade} below threshold`);
      return { allowed: false };
    }

    const upgradeEvent = decision.upgrade?.upgradeType === 'grade-improvement' || decision.upgrade?.upgradeType === 'new-signal';
    if (!isNew && !upgradeEvent) {
      logger.debug('Alert skipped - not a new or upgraded signal');
      return { allowed: false };
    }

    const key = this.makeKey(decision);
    const expiresAt = this.getExpiry(decision);
    const existing = this.sentAlerts.get(key);

    const gradeRank: Record<SignalGrade, number> = {
      'no-trade': 0,
      'C': 1,
      'B': 2,
      'B+': 3,
      'A': 4,
      'A+': 5,
    };

    if (existing && existing.expiresAt > Date.now()) {
      const existingRank = gradeRank[existing.grade];
      const incomingRank = gradeRank[decision.grade];
      if (incomingRank <= existingRank) {
        logger.info(`ALERT_DEDUPED: ${key} (existing ${existing.grade} until ${new Date(existing.expiresAt).toISOString()})`);
        return { allowed: false };
      }
    }

    return { allowed: true, expiresAt };
  }

  private cleanup(): void {
    const now = Date.now();
    let removed = 0;
    for (const [key, record] of this.sentAlerts.entries()) {
      if (record.expiresAt <= now) {
        this.sentAlerts.delete(key);
        removed++;
      }
    }
    if (removed > 0) {
      logger.debug(`Cleaned up ${removed} expired alert dedupe entries`);
    }
  }
}

export const alertService = new AlertService();
