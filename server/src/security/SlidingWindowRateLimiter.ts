/** Small in-memory limiter for socket events. HTTP uses express-rate-limit. */
export class SlidingWindowRateLimiter {
  private events: number[] = [];

  allow(limit: number, windowMs: number, now = Date.now()): boolean {
    this.events = this.events.filter((at) => at > now - windowMs);
    if (this.events.length >= limit) return false;
    this.events.push(now);
    return true;
  }
}
