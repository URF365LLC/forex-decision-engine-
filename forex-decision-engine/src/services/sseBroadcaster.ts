/**
 * SSE Broadcaster
 * Centralized module for Server-Sent Events broadcasting
 */

import express from 'express';
import { createLogger } from './logger.js';

const logger = createLogger('SSEBroadcaster');

const clients = new Set<express.Response>();

export function addSSEClient(res: express.Response): void {
  clients.add(res);
  logger.debug(`SSE client connected (${clients.size} total)`);
}

export function removeSSEClient(res: express.Response): void {
  clients.delete(res);
  logger.debug(`SSE client disconnected (${clients.size} remaining)`);
}

export function getSSEClientCount(): number {
  return clients.size;
}

export function broadcastSSE(payload: Record<string, unknown>): void {
  const message = JSON.stringify(payload);
  
  for (const client of clients) {
    try {
      client.write(`data: ${message}\n\n`);
    } catch (e) {
      clients.delete(client);
      try { client.end(); } catch {}
    }
  }
}

export function broadcastError(source: string, message: string, details?: Record<string, unknown>): void {
  broadcastSSE({ type: 'error', source, message, ...details });
}

export function broadcastDetectionError(symbol: string, error: string): void {
  broadcastSSE({ type: 'detection_error', symbol, error, timestamp: new Date().toISOString() });
}
