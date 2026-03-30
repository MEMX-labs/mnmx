import { QUOTE_EXPIRY_MS, QUOTE_STALENESS_MS } from '../constants.js';

export function isQuoteExpired(quotedAt: number, now: number = Date.now()): boolean {
  return now - quotedAt > QUOTE_EXPIRY_MS;
}

export function isQuoteStale(quotedAt: number, now: number = Date.now()): boolean {
  return now - quotedAt > QUOTE_STALENESS_MS;
}

export function quoteTimeRemaining(quotedAt: number, now: number = Date.now()): number {
  return Math.max(0, QUOTE_EXPIRY_MS - (now - quotedAt));
}
