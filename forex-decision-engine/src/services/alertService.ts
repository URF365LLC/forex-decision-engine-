/**
 * Alert Service
 * Sends email notifications for new trade signals using Resend
 */

import { createLogger } from './logger.js';
import { Decision } from '../strategies/types.js';

const logger = createLogger('AlertService');

class AlertService {
  private resendApiKey: string | null = null;
  private fromEmail: string = 'Forex Engine <alerts@resend.dev>';
  
  constructor() {
    this.resendApiKey = process.env.RESEND_API_KEY || null;
    
    if (!this.resendApiKey) {
      logger.warn('RESEND_API_KEY not configured - email alerts disabled');
    }
  }
  
  async sendTradeAlert(decision: Decision, toEmail: string): Promise<boolean> {
    if (!this.resendApiKey) {
      logger.warn('Email alert skipped - RESEND_API_KEY not configured');
      return false;
    }
    
    try {
      const subject = `🎯 ${decision.grade} Signal: ${decision.symbol} ${decision.direction.toUpperCase()}`;
      
      const html = this.buildEmailHtml(decision);
      
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
      
      logger.info(`ALERT_SENT: ${decision.symbol} ${decision.grade} to ${toEmail}`);
      return true;
    } catch (error) {
      logger.error(`Email alert error: ${error}`);
      return false;
    }
  }
  
  private buildEmailHtml(decision: Decision): string {
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
    
    const signalAge = decision.timing?.signalAge || 'Just detected';
    const entryPrice = decision.entry?.formatted || '-';
    const stopLossPrice = decision.stopLoss?.formatted || '-';
    const takeProfitPrice = decision.takeProfit?.formatted || '-';
    const lotSize = decision.position?.lots?.toFixed(2) || '-';
    
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
      <p style="color: #94a3b8; margin: 5px 0;">Trade Signal</p>
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
}

export const alertService = new AlertService();
