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

export type SentimentRating = 'extremely_bullish' | 'bullish' | 'slightly_bullish' | 'neutral' | 'slightly_bearish' | 'bearish' | 'extremely_bearish';

export interface SentimentBias {
  rating: SentimentRating;
  score: number;
}

export interface ContrarianSignal {
  detected: boolean;
  type: 'crowded_long' | 'crowded_short' | 'capitulation' | 'euphoria' | null;
  strength: number;
  warning: string | null;
}

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
  shortTermBias: SentimentBias;
  longTermBias: SentimentBias;
  contrarian: ContrarianSignal;
  consensusLevel: number;
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
      
      const systemPrompt = `You are an institutional-grade financial sentiment analyst specializing in forex, metals, and cryptocurrency markets.
Analyze X/Twitter posts about the given trading pair to determine market sentiment with advanced contrarian analysis.

Provide your analysis in JSON format with these exact fields:

1. OVERALL SENTIMENT:
- rating: One of "extremely_bullish", "bullish", "slightly_bullish", "neutral", "slightly_bearish", "bearish", "extremely_bearish"
- score: number from -100 (extremely bearish) to +100 (extremely bullish)
- confidence: number from 0 to 1 indicating analysis confidence
- summary: 1-2 sentence summary of sentiment

2. TIME-HORIZON SPLIT:
- shortTermBias: { rating: (same 7-tier scale), score: -100 to +100 } - sentiment for next 1-4 hours based on immediate reactions
- longTermBias: { rating: (same 7-tier scale), score: -100 to +100 } - sentiment for next 1-7 days based on fundamental views

3. CONTRARIAN ANALYSIS (CRITICAL for institutional trading):
- contrarian: {
    detected: boolean - true if extreme consensus suggests reversal risk
    type: "crowded_long" | "crowded_short" | "capitulation" | "euphoria" | null
    strength: 0-100 (how extreme the crowding is)
    warning: string or null - specific contrarian warning message
  }
- consensusLevel: 0-100 (how unified sentiment is - high values = potential reversal)

CONTRARIAN DETECTION RULES:
- "crowded_long": >80% bullish with excessive leverage/position mentions = fade signal
- "crowded_short": >80% bearish with capitulation language = bounce signal  
- "euphoria": Price targets wildly optimistic, "can't lose" mentality = top signal
- "capitulation": Extreme despair, "selling everything", panic = bottom signal

4. ADDITIONAL:
- keyThemes: array of 2-3 main themes
- postCount: estimated relevant posts analyzed

Focus on:
- Retail vs institutional sentiment divergence
- Positioning extremes and leverage mentions
- Fear/greed language intensity
- Contrarian signals when consensus is extreme`;

      const userPrompt = `Analyze current X/Twitter sentiment for ${symbol} trading.
Search keywords: ${keywords}

Provide comprehensive sentiment analysis including:
1. Overall 7-tier sentiment rating
2. Short-term (intraday) vs long-term (swing) bias split
3. Contrarian signal detection (crowded trades, euphoria, capitulation)
4. Consensus level (how one-sided is the crowd)

Consider posts from the last 24 hours. Flag any extreme positioning that suggests reversal risk.`;

      const response = await this.client.chat.completions.create({
        model: 'grok-3',
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
      
      const shortTermBias: SentimentBias = {
        rating: this.normalizeRating(parsed.shortTermBias?.rating || parsed.rating),
        score: Math.max(-100, Math.min(100, parsed.shortTermBias?.score || parsed.score || 0)),
      };
      
      const longTermBias: SentimentBias = {
        rating: this.normalizeRating(parsed.longTermBias?.rating || parsed.rating),
        score: Math.max(-100, Math.min(100, parsed.longTermBias?.score || parsed.score || 0)),
      };
      
      const contrarian: ContrarianSignal = {
        detected: parsed.contrarian?.detected || false,
        type: this.normalizeContrarianType(parsed.contrarian?.type),
        strength: Math.max(0, Math.min(100, parsed.contrarian?.strength || 0)),
        warning: parsed.contrarian?.warning || null,
      };
      
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
        shortTermBias,
        longTermBias,
        contrarian,
        consensusLevel: Math.max(0, Math.min(100, parsed.consensusLevel || 50)),
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
    const normalized = (rating || '').toLowerCase().replace(/[_-]/g, '');
    
    if (normalized.includes('extremelybullish') || normalized.includes('verybullish')) return 'extremely_bullish';
    if (normalized.includes('slightlybullish') || normalized.includes('mildlybullish')) return 'slightly_bullish';
    if (normalized.includes('bullish') || normalized.includes('positive')) return 'bullish';
    
    if (normalized.includes('extremelybearish') || normalized.includes('verybearish')) return 'extremely_bearish';
    if (normalized.includes('slightlybearish') || normalized.includes('mildlybearish')) return 'slightly_bearish';
    if (normalized.includes('bearish') || normalized.includes('negative')) return 'bearish';
    
    return 'neutral';
  }
  
  private normalizeContrarianType(type: string | null | undefined): ContrarianSignal['type'] {
    if (!type) return null;
    const normalized = type.toLowerCase().replace(/[_-]/g, '');
    
    if (normalized.includes('crowdedlong')) return 'crowded_long';
    if (normalized.includes('crowdedshort')) return 'crowded_short';
    if (normalized.includes('capitulation')) return 'capitulation';
    if (normalized.includes('euphoria')) return 'euphoria';
    
    return null;
  }
  
  async getBatchSentiment(symbols: string[], concurrency: number = 3): Promise<Map<string, SentimentResult | null>> {
    const results = new Map<string, SentimentResult | null>();
    
    const chunks: string[][] = [];
    for (let i = 0; i < symbols.length; i += concurrency) {
      chunks.push(symbols.slice(i, i + concurrency));
    }
    
    for (const chunk of chunks) {
      const promises = chunk.map(symbol => 
        this.getSentiment(symbol).then(result => ({ symbol, result }))
      );
      const chunkResults = await Promise.all(promises);
      
      for (const { symbol, result } of chunkResults) {
        results.set(symbol, result);
      }
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
