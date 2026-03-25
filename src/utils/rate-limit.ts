import { logger } from './logger.js';

/**
 * Simple in-memory rate limiter for preventing abuse
 */

interface RateLimitRecord {
  count: number;
  resetTime: number;
}

class RateLimiter {
  private limits = new Map<string, RateLimitRecord>();
  private readonly windowMs: number; // Time window in milliseconds
  private readonly maxRequests: number; // Maximum requests per window

  constructor(windowMs: number = 60000, maxRequests: number = 5) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
    
    // Cleanup expired records every 5 minutes
    setInterval(() => this.cleanup(), 5 * 60 * 1000);
  }

  /**
   * Check if a request should be rate limited
   * @param key Unique identifier (e.g., IP address, socket ID)
   * @returns true if request should be allowed, false if rate limited
   */
  check(key: string): boolean {
    const now = Date.now();
    const record = this.limits.get(key);

    if (!record || now > record.resetTime) {
      // New window or first request
      this.limits.set(key, {
        count: 1,
        resetTime: now + this.windowMs,
      });
      return true;
    }

    if (record.count >= this.maxRequests) {
      logger.warn('RateLimiter', 'Request rate limited', { 
        key: key.substring(0, 10), 
        count: record.count, 
        maxRequests: this.maxRequests 
      });
      return false;
    }

    // Increment count
    record.count++;
    return true;
  }

  /**
   * Get remaining requests for a key
   */
  getRemaining(key: string): number {
    const record = this.limits.get(key);
    if (!record || Date.now() > record.resetTime) {
      return this.maxRequests;
    }
    return Math.max(0, this.maxRequests - record.count);
  }

  /**
   * Get time until rate limit resets for a key (in milliseconds)
   */
  getResetTime(key: string): number {
    const record = this.limits.get(key);
    if (!record || Date.now() > record.resetTime) {
      return 0;
    }
    return record.resetTime - Date.now();
  }

  /**
   * Clean up expired records
   */
  private cleanup(): void {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [key, record] of this.limits.entries()) {
      if (now > record.resetTime) {
        this.limits.delete(key);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      logger.debug('RateLimiter', 'Cleaned up expired records', { cleaned });
    }
  }

  /**
   * Reset rate limit for a key
   */
  reset(key: string): void {
    this.limits.delete(key);
  }

  /**
   * Clear all rate limits
   */
  clear(): void {
    this.limits.clear();
  }
}

// Rate limiters for different operations
// Allow 5 requests per minute for OpenAI API calls (expensive)
export const openaiRateLimiter = new RateLimiter(60000, 5);

// Allow 10 requests per minute for room creation
export const roomCreationRateLimiter = new RateLimiter(60000, 10);

// Allow 20 requests per minute for room joins
export const roomJoinRateLimiter = new RateLimiter(60000, 20);

// Allow 60 requests per minute for answer submissions (1 per second)
export const answerSubmissionRateLimiter = new RateLimiter(60000, 60);