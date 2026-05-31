/**
 * Shared probe utilities: timing wrapper and timeout-with-isolation helper.
 */

export type ComponentStatus = 'up' | 'down' | 'degraded';

export interface ProbeResult {
  status: ComponentStatus;
  responseTimeMs: number;
  [key: string]: unknown;
}

/** Wraps a probe fn, measuring elapsed time and catching all errors. */
export async function runProbe<T extends Record<string, unknown>>(
  fn: () => Promise<T & { status: ComponentStatus }>,
  timeoutMs: number,
): Promise<ProbeResult & T> {
  const start = Date.now();
  try {
    const result = await Promise.race([
      fn(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`probe timed out after ${timeoutMs}ms`)), timeoutMs),
      ),
    ]);
    return { ...result, responseTimeMs: Date.now() - start } as ProbeResult & T;
  } catch {
    return { status: 'down', responseTimeMs: Date.now() - start } as ProbeResult & T;
  }
}
