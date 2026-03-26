// circuit-breaker.ts — Prevents hammering a failing remote API.
// States: CLOSED (normal) → OPEN (trip) → HALF_OPEN (probe).

export class CircuitOpenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CircuitOpenError';
  }
}

type State = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerOptions {
  /** Number of consecutive failures before opening. Default: 3 */
  failureThreshold?: number;
  /** Ms to wait in OPEN before allowing a probe. Default: 30_000 */
  recoveryMs?: number;
  /** Name for use in error messages. Default: 'circuit' */
  name?: string;
}

export class CircuitBreaker {
  private state: State = 'CLOSED';
  private failures = 0;
  private openedAt: number | null = null;

  private readonly failureThreshold: number;
  private readonly recoveryMs: number;
  private readonly name: string;

  constructor(options: CircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? 3;
    this.recoveryMs = options.recoveryMs ?? 30_000;
    this.name = options.name ?? 'circuit';
  }

  /** Returns current state — exposed for tests and observability. */
  getState(): State {
    return this.state;
  }

  /**
   * Ignore a thrown error — undo the failure that call() would otherwise count.
   * Use for non-retriable errors (e.g. 4xx) that are the caller's fault.
   * Must be called synchronously from within the catch block of breaker.call().
   */
  ignore(): void {
    this.failures = Math.max(0, this.failures - 1);
    if (this.state === 'OPEN' && this.failures < this.failureThreshold) {
      this.state = 'CLOSED';
      this.openedAt = null;
    }
  }

  /** Returns current failure count — exposed for tests. */
  getFailures(): number {
    return this.failures;
  }

  /**
   * Execute `fn` through the breaker.
   * - CLOSED: runs fn normally.
   * - OPEN: throws CircuitOpenError immediately (no fn call).
   * - HALF_OPEN: runs fn as a probe; success → CLOSED, failure → OPEN.
   */
  async call<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      const elapsed = Date.now() - (this.openedAt ?? 0);
      if (elapsed < this.recoveryMs) {
        throw new CircuitOpenError(
          `${this.name} is OPEN — backing off for ${Math.ceil((this.recoveryMs - elapsed) / 1000)}s more`,
        );
      }
      // Recovery window has passed — probe with HALF_OPEN
      this.state = 'HALF_OPEN';
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  /** Record a success: reset failures and close the circuit. */
  private onSuccess(): void {
    this.failures = 0;
    this.state = 'CLOSED';
    this.openedAt = null;
  }

  /** Record a failure: increment count and open if threshold reached. */
  private onFailure(): void {
    this.failures += 1;
    if (this.failures >= this.failureThreshold || this.state === 'HALF_OPEN') {
      this.state = 'OPEN';
      this.openedAt = Date.now();
    }
  }
}

/** Shared singleton for deepSearch — one breaker per process lifetime. */
export const deepSearchBreaker = new CircuitBreaker({
  name: 'databricks-vector-search',
  failureThreshold: 3,
  recoveryMs: 30_000,
});
