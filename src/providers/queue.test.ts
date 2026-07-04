import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FetchQueue, RetryableError } from './queue';

describe('FetchQueue', () => {
  it('never runs more than `concurrency` tasks at once', async () => {
    const queue = new FetchQueue({ concurrency: 4 });
    let active = 0;
    let maxActive = 0;
    const task = () =>
      new Promise<void>((resolve) => {
        active++;
        maxActive = Math.max(maxActive, active);
        setTimeout(() => {
          active--;
          resolve();
        }, 10);
      });

    await Promise.all(Array.from({ length: 20 }, (_, i) => queue.run(`k${i}`, task)));
    expect(maxActive).toBeLessThanOrEqual(4);
  });

  it('coalesces concurrent calls with the same key into one execution', async () => {
    const queue = new FetchQueue({ concurrency: 4 });
    let calls = 0;
    const task = () =>
      new Promise<string>((resolve) => {
        calls++;
        setTimeout(() => resolve('result'), 10);
      });

    const results = await Promise.all([
      queue.run('same-key', task),
      queue.run('same-key', task),
      queue.run('same-key', task),
    ]);

    expect(calls).toBe(1);
    expect(results).toEqual(['result', 'result', 'result']);
  });

  it('fetches a repeated key again once the first call has finished', async () => {
    const queue = new FetchQueue({ concurrency: 4 });
    let calls = 0;
    const task = async () => {
      calls++;
      return calls;
    };

    const first = await queue.run('k', task);
    const second = await queue.run('k', task);
    expect(first).toBe(1);
    expect(second).toBe(2);
  });

  describe('retry behavior', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('retries on a RetryableError (e.g. 429) and eventually succeeds', async () => {
      const queue = new FetchQueue({ concurrency: 4, baseDelayMs: 500, backoffFactor: 2 });
      let attempts = 0;
      const task = async () => {
        attempts++;
        if (attempts === 1) throw new RetryableError('rate limited', 429);
        return 'ok';
      };

      const promise = queue.run('k', task);
      await vi.advanceTimersByTimeAsync(500);
      await expect(promise).resolves.toBe('ok');
      expect(attempts).toBe(2);
    });

    it('honors Retry-After when present instead of the computed backoff', async () => {
      const queue = new FetchQueue({ concurrency: 4, baseDelayMs: 500, backoffFactor: 2 });
      let attempts = 0;
      const task = async () => {
        attempts++;
        if (attempts === 1) throw new RetryableError('rate limited', 429, 2000);
        return 'ok';
      };

      const promise = queue.run('k', task);
      await vi.advanceTimersByTimeAsync(1999);
      expect(attempts).toBe(1);
      await vi.advanceTimersByTimeAsync(1);
      await expect(promise).resolves.toBe('ok');
    });

    it('gives up after maxAttempts', async () => {
      const queue = new FetchQueue({ concurrency: 4, maxAttempts: 3, baseDelayMs: 1 });
      let attempts = 0;
      const task = async () => {
        attempts++;
        throw new RetryableError('still failing', 500);
      };

      const promise = queue.run('k', task).catch((e) => e);
      await vi.advanceTimersByTimeAsync(10_000);
      const result = await promise;
      expect(result).toBeInstanceOf(RetryableError);
      expect(attempts).toBe(3);
    });

    it('does not retry a non-retryable error (e.g. 404)', async () => {
      const queue = new FetchQueue({ concurrency: 4 });
      let attempts = 0;
      const task = async () => {
        attempts++;
        throw new Error('not found');
      };

      await expect(queue.run('k', task)).rejects.toThrow('not found');
      expect(attempts).toBe(1);
    });
  });
});
