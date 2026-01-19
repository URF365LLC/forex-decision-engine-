/**
 * Promise Pool Utility
 *
 * Executes async tasks with controlled concurrency to prevent
 * overwhelming rate-limited APIs while maximizing throughput.
 *
 * Used by: autoScanService.ts for parallel symbol scanning
 */

export interface PromisePoolOptions<T, R> {
  /** Array of items to process */
  items: T[];
  /** Maximum concurrent tasks (default: 5) */
  concurrency?: number;
  /** Async function to process each item */
  handler: (item: T, index: number) => Promise<R>;
  /** Optional callback after each item completes */
  onProgress?: (completed: number, total: number, result: R) => void;
  /** Optional delay between starting new tasks in ms (default: 0) */
  delayBetweenStarts?: number;
}

export interface PromisePoolResult<R> {
  results: R[];
  errors: Array<{ index: number; error: Error }>;
  duration: number;
}

/**
 * Execute async tasks with controlled concurrency
 *
 * @example
 * const result = await promisePool({
 *   items: symbols,
 *   concurrency: 5,
 *   handler: async (symbol, index) => await analyzeSymbol(symbol),
 *   onProgress: (completed, total) => console.log(`${completed}/${total}`)
 * });
 */
export async function promisePool<T, R>(
  options: PromisePoolOptions<T, R>
): Promise<PromisePoolResult<R>> {
  const {
    items,
    concurrency = 5,
    handler,
    onProgress,
    delayBetweenStarts = 0,
  } = options;

  const startTime = Date.now();
  const results: R[] = new Array(items.length);
  const errors: Array<{ index: number; error: Error }> = [];
  let completed = 0;
  let nextIndex = 0;

  // Worker function that processes items from the queue
  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      const item = items[index];

      // Optional delay between starting new tasks
      if (delayBetweenStarts > 0 && index > 0) {
        await new Promise(resolve => setTimeout(resolve, delayBetweenStarts));
      }

      try {
        const result = await handler(item, index);
        results[index] = result;
        completed++;

        if (onProgress) {
          onProgress(completed, items.length, result);
        }
      } catch (err) {
        errors.push({
          index,
          error: err instanceof Error ? err : new Error(String(err)),
        });
        completed++;

        // Still call onProgress for errors so counts stay accurate
        if (onProgress) {
          onProgress(completed, items.length, undefined as unknown as R);
        }
      }
    }
  }

  // Start workers up to concurrency limit
  const workers: Promise<void>[] = [];
  const actualConcurrency = Math.min(concurrency, items.length);

  for (let i = 0; i < actualConcurrency; i++) {
    workers.push(worker());
  }

  // Wait for all workers to complete
  await Promise.all(workers);

  return {
    results: results.filter((r): r is R => r !== undefined),
    errors,
    duration: Date.now() - startTime,
  };
}

/**
 * Batch items into chunks for processing
 * Useful when you need to process in discrete batches rather than a continuous pool
 */
export function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}
