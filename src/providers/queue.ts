// A retryable error carries the HTTP status (and, if the server sent one,
// the Retry-After delay) so the queue can decide whether and how long to
// back off, without the queue needing to know anything about HTTP itself.
export class RetryableError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly retryAfterMs?: number
  ) {
    super(message);
    this.name = 'RetryableError';
  }
}

interface FetchQueueOptions {
  concurrency?: number;
  maxAttempts?: number;
  baseDelayMs?: number;
  backoffFactor?: number;
}

type Listener = (stats: { active: number; pending: number }) => void;

// Bounded-concurrency, in-flight-deduplicating, retrying task queue. Fetching
// isn't core (it's an effect), but the policy of "how many at once, retry
// how, dedupe how" is itself pure enough to isolate and test without a
// network in sight — that's what this class is.
export class FetchQueue {
  private readonly concurrency: number;
  private readonly maxAttempts: number;
  private readonly baseDelayMs: number;
  private readonly backoffFactor: number;

  private active = 0;
  private waiting: Array<() => void> = [];
  private inFlight = new Map<string, Promise<unknown>>();
  private listeners = new Set<Listener>();

  constructor(opts: FetchQueueOptions = {}) {
    this.concurrency = opts.concurrency ?? 4;
    this.maxAttempts = opts.maxAttempts ?? 3;
    this.baseDelayMs = opts.baseDelayMs ?? 500;
    this.backoffFactor = opts.backoffFactor ?? 2;
  }

  get stats() {
    return { active: this.active, pending: this.waiting.length };
  }

  onChange(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    for (const l of this.listeners) l(this.stats);
  }

  // Runs task() under the concurrency limit, retrying on RetryableError, and
  // coalescing concurrent calls with the same key into a single execution.
  run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const existing = this.inFlight.get(key);
    if (existing) return existing as Promise<T>;

    const promise = this.schedule(task).finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, promise);
    return promise;
  }

  private async schedule<T>(task: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await this.withRetry(task);
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.concurrency) {
      this.active++;
      this.notify();
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.waiting.push(() => {
        this.active++;
        resolve();
      });
      this.notify();
    });
  }

  private release() {
    this.active--;
    const next = this.waiting.shift();
    if (next) next();
    this.notify();
  }

  private async withRetry<T>(task: () => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await task();
      } catch (err) {
        if (!(err instanceof RetryableError) || attempt >= this.maxAttempts) throw err;
        const delay = err.retryAfterMs ?? this.baseDelayMs * this.backoffFactor ** (attempt - 1);
        await sleep(delay);
      }
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
