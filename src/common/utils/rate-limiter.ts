import { Logger } from '@nestjs/common';

const logger = new Logger('RateLimiter');

interface RateLimitRecord {
  count: number;
  resetTime: number;
}

export class RateLimiter {
  private limits = new Map<string, RateLimitRecord>();
  private readonly windowMs: number;
  private readonly maxRequests: number;

  constructor(windowMs: number = 60000, maxRequests: number = 5) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;

    setInterval(() => this.cleanup(), 5 * 60 * 1000);
  }

  check(key: string): boolean {
    const now = Date.now();
    const record = this.limits.get(key);

    if (!record || now > record.resetTime) {
      this.limits.set(key, {
        count: 1,
        resetTime: now + this.windowMs,
      });
      return true;
    }

    if (record.count >= this.maxRequests) {
      logger.warn(
        `Request rate limited, key: ${key.substring(0, 10)}, count: ${record.count}, maxRequests: ${this.maxRequests}`,
      );
      return false;
    }

    record.count++;
    return true;
  }

  getRemaining(key: string): number {
    const record = this.limits.get(key);
    if (!record || Date.now() > record.resetTime) {
      return this.maxRequests;
    }
    return Math.max(0, this.maxRequests - record.count);
  }

  getResetTime(key: string): number {
    const record = this.limits.get(key);
    if (!record || Date.now() > record.resetTime) {
      return 0;
    }
    return record.resetTime - Date.now();
  }

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
      logger.debug(`Cleaned up expired records, cleaned: ${cleaned}`);
    }
  }

  reset(key: string): void {
    this.limits.delete(key);
  }

  clear(): void {
    this.limits.clear();
  }
}

export const openaiRateLimiter = new RateLimiter(60000, 5);
export const roomCreationRateLimiter = new RateLimiter(60000, 10);
export const roomJoinRateLimiter = new RateLimiter(60000, 20);
export const answerSubmissionRateLimiter = new RateLimiter(60000, 60);
export const transcriptSubmissionRateLimiter = new RateLimiter(1000, 2);
