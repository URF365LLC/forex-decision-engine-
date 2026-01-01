/**
 * Grok Sentiment Service
 * Uses xAI's Grok API with X/Twitter search for real-time market sentiment
 * 
 * Features:
 * - X/Twitter sentiment analysis for forex/crypto symbols
 * - 5-minute cache TTL to reduce API costs
 * - Rate limiting to stay within xAI limits
 * - Graceful degradation when API unavailable
 */

import OpenAI from 'openai';
import { createLogger } from './logger.js';

const logger = createLogger('GrokSentiment');

export type SentimentRating = 'bullish' | 'bearish' | 'neutral' | 'mixed';

export interface SentimentResult {
  symbol: string;
  rating: SentimentRating;
  score: number;
  confidence: number;
  summary: string;
  samplePosts: string[];
  postCount: number;
  timestamp: string;
  cached: boolean;
}

interface CacheEntry {
  result: SentimentResult;
  expiresAt: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const sentimentCache = new Map<string, CacheEntry>();

const SYMBOL_KEYWORDS: Record<string, string[]> = {
  EURUSD: ['EURUSD', 'EUR/USD', 'euro dollar', '#EURUSD'],
  GBPUSD: ['GBPUSD', 'GBP/USD', 'pound dollar', 'cable', '#GBPUSD'],
  USDJPY: ['USDJPY', 'USD/JPY', 'dollar yen', '#USDJPY'],
  XAUUSD: ['XAUUSD', 'XAU/USD', 'gold', 'gold price', '#gold', '#XAUUSD'],
  BTCUSD: ['BTCUSD', 'BTC/USD', 'bitcoin', '#bitcoin', '#BTC', '$BTC'],
  ETHUSD: ['ETHUSD', 'ETH/USD', 'ethereum', '#ethereum', '#ETH', '$ETH'],
  SOLUSD: ['SOLUSD', 'SOL/USD', 'solana', '#solana', '#SOL', '$SOL'],
  SP: ['S&P 500', 'SPX', 'SP500', '#SPX', '$SPY'],
  NSDQ: ['Nasdaq', 'NDX', 'Nasdaq 100', '#nasdaq', '$QQQ'],
  DOW: ['Dow Jones', 'DJIA', 'Dow 30', '#dow'],
  WTI: ['WTI', 'crude oil', 'oil price', '#WTI', '#crudeoil'],
};

function getSearchKeywords(symbol: string): string {
  const keywords = SYMBOL_KEYWORDS[symbol];
  if (keywords) {
    return keywords.slice(0, 3).join(' OR ');
  }
  return symbol.replace(/USD$/, '').replace(/^XAU/, 'gold');
}

class GrokSentimentService {
  private client: OpenAI | null = null;
  private isConfigured: boolean = false;
  private lastRequestTime: number = 0;
  private minRequestInterval: number = 1000;
  
  constructor() {
    const apiKey = process.env.XAI_API_KEY;
    
    if (apiKey) {
      this.client = new OpenAI({
        baseURL: 'https://api.x.ai/v1',
        apiKey,
      });
      this.isConfigured = true;
      logger.info('Grok sentiment service initialized');
    } else {
      logger.warn('XAI_API_KEY not configured - sentiment analysis disabled');
    }
  }
  
  async getSentiment(symbol: string): Promise<SentimentResult | null> {
    if (!this.isConfigured || !this.client) {
      return null;
    }
    
    const cached = sentimentCache.get(symbol);
    if (cached && cached.expiresAt > Date.now()) {
      logger.debug(`SENTIMENT_CACHE_HIT: ${symbol}`);
      return { ...cached.result, cached: true };
    }
    
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    if (timeSinceLastRequest < this.minRequestInterval) {
      await new Promise(resolve => 
        setTimeout(resolve, this.minRequestInterval - timeSinceLastRequest)
      );
    }
    this.lastRequestTime = Date.now();
    
    try {
      const keywords = getSearchKeywords(symbol);
      
      const systemPrompt = `You are a financial sentiment analyst specializing in forex and cryptocurrency markets.
Analyze X/Twitter posts about the given trading pair to determine market sentiment.

Provide your analysis in JSON format with these fields:
- rating: "bullish", "bearish", "neutral", or "mixed"
- score: number from -100 (extremely bearish) to +100 (extremely bullish)
- confidence: number from 0 to 1 indicating how confident you are
- summary: 1-2 sentence summary of the sentiment
- keyThemes: array of 2-3 main themes from the posts
- postCount: estimated number of relevant posts analyzed

Focus on:
- Trader sentiment and positioning mentions
- Price predictions and targets
- Technical analysis comments
- News reactions and fundamental views

Ignore spam, bots, and promotional content.`;

      const userPrompt = `Analyze current X/Twitter sentiment for ${symbol} trading.
Search keywords: ${keywords}

What is the current market sentiment based on recent posts? Consider posts from the last 24 hours.`;

      const response = await this.client.chat.completions.create({
        model: 'grok-2-1212',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
        max_tokens: 500,
      });
      
      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error('Empty response from Grok');
      }
      
      const parsed = JSON.parse(content);
      
      const result: SentimentResult = {
        symbol,
        rating: this.normalizeRating(parsed.rating),
        score: Math.max(-100, Math.min(100, parsed.score || 0)),
        confidence: Math.max(0, Math.min(1, parsed.confidence || 0.5)),
        summary: parsed.summary || 'No summary available',
        samplePosts: parsed.keyThemes || [],
        postCount: parsed.postCount || 0,
        timestamp: new Date().toISOString(),
        cached: false,
      };
      
      sentimentCache.set(symbol, {
        result,
        expiresAt: Date.now() + CACHE_TTL_MS,
      });
      
      logger.info(`SENTIMENT_FETCHED: ${symbol} = ${result.rating} (score: ${result.score})`);
      
      return result;
    } catch (error) {
      logger.error(`SENTIMENT_ERROR: ${symbol} - ${error}`);
      return null;
    }
  }
  
  private normalizeRating(rating: string): SentimentRating {
    const normalized = (rating || '').toLowerCase();
    if (normalized.includes('bullish') || normalized.includes('positive')) return 'bullish';
    if (normalized.includes('bearish') || normalized.includes('negative')) return 'bearish';
    if (normalized.includes('mixed')) return 'mixed';
    return 'neutral';
  }
  
  async getBatchSentiment(symbols: string[]): Promise<Map<string, SentimentResult | null>> {
    const results = new Map<string, SentimentResult | null>();
    
    for (const symbol of symbols) {
      const sentiment = await this.getSentiment(symbol);
      results.set(symbol, sentiment);
    }
    
    return results;
  }
  
  isEnabled(): boolean {
    return this.isConfigured;
  }
  
  getCacheStats(): { size: number; symbols: string[] } {
    const now = Date.now();
    const validEntries = Array.from(sentimentCache.entries())
      .filter(([_, entry]) => entry.expiresAt > now);
    
    return {
      size: validEntries.length,
      symbols: validEntries.map(([symbol]) => symbol),
    };
  }
  
  clearCache(): void {
    sentimentCache.clear();
    logger.info('Sentiment cache cleared');
  }
}

export const grokSentimentService = new GrokSentimentService();
