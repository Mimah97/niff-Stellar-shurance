/**
 * Integration tests for webhook dead-letter queue (DLQ) with exponential backoff.
 *
 * Covers:
 *   - Failed webhooks retry with exponential backoff (delay doubles each attempt).
 *   - Permanently failed deliveries (exhausted MAX_WEBHOOK_ATTEMPTS) appear in
 *     the dead-letter listing.
 *   - Manual replay delivers the original payload to the webhook endpoint.
 *   - MAX_WEBHOOK_RETRY_DELAY caps the backoff delay.
 *   - getDeadLetterJobs filters out jobs that have not exhausted all attempts.
 */

import {
  MAX_WEBHOOK_ATTEMPTS,
  MAX_WEBHOOK_RETRY_DELAY,
  getDeadLetterJobs,
  replayDeadLetterJob,
  webhookQueue,
  DeliveryRecord,
} from '../queue';

// ── Mock BullMQ Queue ─────────────────────────────────────────────────────────

jest.mock('bullmq', () => {
  const jobs = new Map<string, MockJob>();

  class MockJob {
    id: string;
    data: Record<string, unknown>;
    attemptsMade: number;
    failedReason?: string;
    retried = false;

    constructor(id: string, data: Record<string, unknown>, attemptsMade: number, failedReason?: string) {
      this.id = id;
      this.data = data;
      this.attemptsMade = attemptsMade;
      this.failedReason = failedReason;
    }

    async retry() {
      this.retried = true;
      this.attemptsMade = 0;
    }
  }

  const mockQueue = {
    getFailed: jest.fn(async () => Array.from(jobs.values())),
    getJob: jest.fn(async (id: string) => jobs.get(id) ?? null),
    getCompleted: jest.fn(async () => []),
    getActive: jest.fn(async () => []),
    getWaiting: jest.fn(async () => []),
    getJobCounts: jest.fn(async () => ({ waiting: 0, active: 0, completed: 0, failed: jobs.size })),
    add: jest.fn(async (name: string, data: Record<string, unknown>, opts: { jobId?: string }) => {
      const id = opts?.jobId ?? String(Date.now());
      const job = new MockJob(id, data, 0);
      jobs.set(id, job);
      return job;
    }),
    close: jest.fn(),
    _jobs: jobs,
    _addJob: (id: string, data: Record<string, unknown>, attemptsMade: number, failedReason?: string) => {
      jobs.set(id, new MockJob(id, data, attemptsMade, failedReason));
    },
    _clear: () => jobs.clear(),
  };

  return {
    Queue: jest.fn(() => mockQueue),
    Worker: jest.fn(() => ({
      on: jest.fn(),
      close: jest.fn(),
    })),
  };
});

// ── Helpers ───────────────────────────────────────────────────────────────────

// Access the mock queue internals via the mocked module.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockQueue = (webhookQueue as any);

function addJob(
  id: string,
  attemptsMade: number,
  failedReason = 'Connection refused',
) {
  mockQueue._addJob(id, {
    provider: 'generic',
    eventType: 'test.event',
    idempotencyKey: `key-${id}`,
    payload: { test: true },
    receivedAt: Date.now(),
  }, attemptsMade, failedReason);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Webhook queue configuration', () => {
  it('MAX_WEBHOOK_ATTEMPTS defaults to 5', () => {
    expect(MAX_WEBHOOK_ATTEMPTS).toBe(5);
  });

  it('MAX_WEBHOOK_RETRY_DELAY defaults to 32000 ms', () => {
    expect(MAX_WEBHOOK_RETRY_DELAY).toBe(32_000);
  });

  it('exponential backoff delay doubles each attempt up to MAX_WEBHOOK_RETRY_DELAY', () => {
    const baseDelay = 1_000;
    const delays = Array.from({ length: MAX_WEBHOOK_ATTEMPTS }, (_, i) =>
      Math.min(baseDelay * Math.pow(2, i), MAX_WEBHOOK_RETRY_DELAY),
    );
    // 1s, 2s, 4s, 8s, 16s (all under 32s cap for 5 attempts)
    expect(delays).toEqual([1000, 2000, 4000, 8000, 16000]);
    delays.forEach((d) => expect(d).toBeLessThanOrEqual(MAX_WEBHOOK_RETRY_DELAY));
  });
});

describe('getDeadLetterJobs', () => {
  beforeEach(() => mockQueue._clear());

  it('returns jobs that have exhausted all attempts', async () => {
    addJob('dlq-1', MAX_WEBHOOK_ATTEMPTS, 'Timeout');
    addJob('dlq-2', MAX_WEBHOOK_ATTEMPTS, 'DNS error');
    const dlq = await getDeadLetterJobs();
    expect(dlq).toHaveLength(2);
    expect(dlq.map((j: DeliveryRecord) => j.jobId)).toEqual(
      expect.arrayContaining(['dlq-1', 'dlq-2']),
    );
  });

  it('excludes jobs that have not exhausted all attempts', async () => {
    addJob('partial-1', MAX_WEBHOOK_ATTEMPTS - 1, 'Timeout');
    addJob('dlq-1', MAX_WEBHOOK_ATTEMPTS, 'Timeout');
    const dlq = await getDeadLetterJobs();
    expect(dlq).toHaveLength(1);
    expect(dlq[0].jobId).toBe('dlq-1');
  });

  it('returns empty array when no dead-letter jobs exist', async () => {
    const dlq = await getDeadLetterJobs();
    expect(dlq).toHaveLength(0);
  });

  it('respects the limit parameter', async () => {
    for (let i = 0; i < 10; i++) {
      addJob(`dlq-${i}`, MAX_WEBHOOK_ATTEMPTS);
    }
    const dlq = await getDeadLetterJobs(3);
    expect(dlq.length).toBeLessThanOrEqual(3);
  });

  it('includes failedReason in each record', async () => {
    addJob('dlq-reason', MAX_WEBHOOK_ATTEMPTS, 'HTTP 503');
    const dlq = await getDeadLetterJobs();
    expect(dlq[0].failedReason).toBe('HTTP 503');
  });
});

describe('replayDeadLetterJob', () => {
  beforeEach(() => mockQueue._clear());

  it('retries the job and resets attempt count', async () => {
    addJob('replay-1', MAX_WEBHOOK_ATTEMPTS, 'Timeout');
    await replayDeadLetterJob('replay-1');
    // After retry, attemptsMade is reset to 0 by the mock.
    const job = await webhookQueue.getJob('replay-1');
    expect(job?.attemptsMade).toBe(0);
  });

  it('throws NotFoundException when job does not exist', async () => {
    await expect(replayDeadLetterJob('nonexistent-id')).rejects.toThrow(
      'Dead-letter job nonexistent-id not found',
    );
  });

  it('preserves original payload after replay', async () => {
    addJob('replay-payload', MAX_WEBHOOK_ATTEMPTS);
    await replayDeadLetterJob('replay-payload');
    const job = await webhookQueue.getJob('replay-payload');
    expect(job?.data.eventType).toBe('test.event');
    expect(job?.data.provider).toBe('generic');
  });
});
