/**
 * Circuit Breaker Service
 * Prevents cascading failures when external APIs are down
 *
 * States:
 * - CLOSED: Normal operation, requests pass through
 * - OPEN: API failing, requests rejected immediately
 * - HALF_OPEN: Testing if API recovered
 */

import { createLogger } from './logger.js';

const logger = createLogger('CircuitBreaker');

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerConfig {
  name: string;
  failureThreshold: number;
  resetTimeout: number;
  successThreshold: number;
}

export interface CircuitStats {
  state: CircuitState;
  failures: number;
  successes: number;
  lastFailure: string | null;
  lastSuccess: string | null;
  totalRequests: number;
  totalFailures: number;
  totalSuccesses: number;
}

export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failures: number = 0;
  private successes: number = 0;
  private lastFailure: Date | null = null;
  private lastSuccess: Date | null = null;
  private nextRetry: Date | null = null;
  private totalRequests: number = 0;
  private totalFailures: number = 0;
  private totalSuccesses: number = 0;
  private readonly config: CircuitBreakerConfig;

  constructor(config: CircuitBreakerConfig) {
    this.config = config;
    logger.info(`Circuit breaker "${config.name}" initialized`, {
      failureThreshold: config.failureThreshold,
      resetTimeout: config.resetTimeout,
      successThreshold: config.successThreshold,
    });
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    this.totalRequests++;

    if (this.state === 'OPEN') {
      if (this.shouldAttemptReset()) {
        this.state = 'HALF_OPEN';
        logger.info(`Circuit "${this.config.name}" entering HALF_OPEN state`);
      } else {
        throw new CircuitOpenError(this.config.name, this.nextRetry!);
      }
    }

    try {
      const result = await fn();
      this.recordSuccess();
      return result;
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }

  private shouldAttemptReset(): boolean {
    if (!this.nextRetry) return false;
    return Date.now() >= this.nextRetry.getTime();
  }

  private recordSuccess(): void {
    this.lastSuccess = new Date();
    this.totalSuccesses++;

    if (this.state === 'HALF_OPEN') {
      this.successes++;
      if (this.successes >= this.config.successThreshold) {
        this.state = 'CLOSED';
        this.failures = 0;
        this.successes = 0;
        this.nextRetry = null;
        logger.info(`Circuit "${this.config.name}" CLOSED (recovered)`);
      }
    } else if (this.state === 'CLOSED') {
      // Reset failure count on success in CLOSED state
      this.failures = 0;
      this.successes = 0;
    }
  }

  private recordFailure(): void {
    this.lastFailure = new Date();
    this.failures++;
    this.totalFailures++;

    if (this.state === 'HALF_OPEN') {
      this.state = 'OPEN';
      this.nextRetry = new Date(Date.now() + this.config.resetTimeout);
      this.successes = 0;
      logger.warn(`Circuit "${this.config.name}" OPEN (recovery failed)`, {
        nextRetry: this.nextRetry.toISOString(),
      });
    } else if (this.failures >= this.config.failureThreshold) {
      this.state = 'OPEN';
      this.nextRetry = new Date(Date.now() + this.config.resetTimeout);
      logger.warn(`Circuit "${this.config.name}" OPEN (threshold reached)`, {
        failures: this.failures,
        threshold: this.config.failureThreshold,
        nextRetry: this.nextRetry.toISOString(),
      });
    }
  }

  reset(): void {
    this.state = 'CLOSED';
    this.failures = 0;
    this.successes = 0;
    this.nextRetry = null;
    logger.info(`Circuit "${this.config.name}" manually reset`);
  }

  getStats(): CircuitStats {
    return {
      state: this.state,
      failures: this.failures,
      successes: this.successes,
      lastFailure: this.lastFailure?.toISOString() || null,
      lastSuccess: this.lastSuccess?.toISOString() || null,
      totalRequests: this.totalRequests,
      totalFailures: this.totalFailures,
      totalSuccesses: this.totalSuccesses,
    };
  }

  isAvailable(): boolean {
    if (this.state === 'CLOSED') return true;
    if (this.state === 'HALF_OPEN') return true;
    return this.shouldAttemptReset();
  }

  getState(): CircuitState {
    return this.state;
  }
}

export class CircuitOpenError extends Error {
  public readonly circuitName: string;
  public readonly nextRetry: Date;

  constructor(circuitName: string, nextRetry: Date) {
    const retryIn = Math.ceil((nextRetry.getTime() - Date.now()) / 1000);
    super(`Circuit "${circuitName}" is OPEN. Retry in ${retryIn}s`);
    this.name = 'CircuitOpenError';
    this.circuitName = circuitName;
    this.nextRetry = nextRetry;
  }
}

export const twelveDataCircuit = new CircuitBreaker({
  name: 'TwelveData',
  failureThreshold: 5,
  resetTimeout: 60000,
  successThreshold: 2,
});

export const grokCircuit = new CircuitBreaker({
  name: 'Grok',
  failureThreshold: 3,
  resetTimeout: 120000,
  successThreshold: 1,
});

export const databaseCircuit = new CircuitBreaker({
  name: 'Database',
  failureThreshold: 3,
  resetTimeout: 30000,
  successThreshold: 1,
});

class CircuitManager {
  private circuits: Map<string, CircuitBreaker> = new Map();

  constructor() {
    this.circuits.set('TwelveData', twelveDataCircuit);
    this.circuits.set('Grok', grokCircuit);
    this.circuits.set('Database', databaseCircuit);
  }

  register(name: string, circuit: CircuitBreaker): void {
    this.circuits.set(name, circuit);
  }

  get(name: string): CircuitBreaker | undefined {
    return this.circuits.get(name);
  }

  getAllStats(): Record<string, CircuitStats> {
    const stats: Record<string, CircuitStats> = {};
    for (const [name, circuit] of this.circuits) {
      stats[name] = circuit.getStats();
    }
    return stats;
  }

  resetAll(): void {
    for (const circuit of this.circuits.values()) {
      circuit.reset();
    }
    logger.info('All circuits reset');
  }
}

export const circuitManager = new CircuitManager();
