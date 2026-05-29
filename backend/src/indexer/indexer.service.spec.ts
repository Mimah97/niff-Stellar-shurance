import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

jest.mock('@stellar/stellar-sdk', () => {
  const actual = jest.requireActual('@stellar/stellar-sdk') as Record<string, unknown>;
  return {
    ...actual,
    scValToNative: jest.fn(() => ({})),
  };
});

import { IndexerService } from './indexer.service';

describe('IndexerService', () => {
  const network = 'unittest';

  function makeConfig() {
    return {
      get: jest.fn((key: string, def?: unknown) => {
        if (key === 'STELLAR_NETWORK') return network;
        if (key === 'INDEXER_GAP_ALERT_THRESHOLD_LEDGERS') return 50;
        if (key === 'INDEXER_GAP_ALERT_COOLDOWN_MS') return 60_000;
        return def;
      }),
    } as unknown as ConfigService;
  }

  it('resumes from ledger_cursors.last_processed_ledger after restart (empty RPC batch)', async () => {
    const txOps = {
      ledgerCursor: {
        findUnique: jest.fn().mockResolvedValue({ lastProcessedLedger: 900 }),
        upsert: jest.fn(),
      },
    };
    const prisma = {
      ledgerCursor: {
        findUnique: jest.fn().mockResolvedValue({
          network,
          lastProcessedLedger: 900,
          updatedAt: new Date(),
        }),
        create: jest.fn(),
      },
      indexerState: { findFirst: jest.fn() },
      ledgerGapAlertDedup: { findUnique: jest.fn(), upsert: jest.fn() },
      $transaction: jest.fn(async (fn: (t: typeof txOps) => Promise<void>) => fn(txOps)),
    };

    const soroban = {
      getLatestLedger: jest.fn().mockResolvedValue(950),
      getEvents: jest.fn().mockResolvedValue({ events: [] }),
    };

    const service = new IndexerService(prisma as never, soroban as never, makeConfig());
    await service.processNextBatchForNetwork(network);

    expect(soroban.getEvents).toHaveBeenCalledWith(901, expect.any(Number));
    expect(txOps.ledgerCursor.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { network },
        update: expect.objectContaining({ lastProcessedLedger: 950 }),
      }),
    );
  });

  it('advances cursor inside the same transaction as raw_event upsert', async () => {
    const event = {
      txHash: 'abc',
      ledger: 42,
      ledgerClosedAt: new Date().toISOString(),
      topic: [],
      value: { _value: {} },
      contractId: { toString: () => 'C' },
    };

    const tx = {
      rawEvent: { upsert: jest.fn() },
      ledgerCursor: {
        findUnique: jest.fn().mockResolvedValue({ lastProcessedLedger: 10 }),
        upsert: jest.fn(),
      },
      policy: { upsert: jest.fn() },
      claim: { upsert: jest.fn(), update: jest.fn() },
      vote: { upsert: jest.fn() },
    };

    const prisma = {
      ledgerCursor: {
        findUnique: jest.fn().mockResolvedValue({
          network,
          lastProcessedLedger: 10,
          updatedAt: new Date(),
        }),
        create: jest.fn(),
      },
      indexerState: { findFirst: jest.fn() },
      ledgerGapAlertDedup: { findUnique: jest.fn(), upsert: jest.fn() },
      $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<void>) => fn(tx)),
    };

    const soroban = {
      getLatestLedger: jest.fn().mockResolvedValue(55),
      getEvents: jest.fn().mockResolvedValue({ events: [event] }),
    };

    const service = new IndexerService(prisma as never, soroban as never, makeConfig());
    await service.processNextBatchForNetwork(network);

    expect(prisma.$transaction).toHaveBeenCalled();
    expect(tx.rawEvent.upsert).toHaveBeenCalled();
    expect(tx.ledgerCursor.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ lastProcessedLedger: 42 }),
      }),
    );
  });

  // ── Gap alert deduplication tests ────────────────────────────────────────

  it('first gap alert fires and upserts dedup row', async () => {
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    const txOps = {
      ledgerCursor: {
        findUnique: jest.fn().mockResolvedValue({ lastProcessedLedger: 0 }),
        upsert: jest.fn(),
      },
    };
    const prisma = {
      ledgerCursor: {
        findUnique: jest.fn().mockResolvedValue({ network, lastProcessedLedger: 0, updatedAt: new Date() }),
        create: jest.fn(),
      },
      indexerState: { findFirst: jest.fn() },
      ledgerGapAlertDedup: {
        findUnique: jest.fn().mockResolvedValue(null), // no prior alert
        upsert: jest.fn(),
      },
      $transaction: jest.fn(async (fn: (t: typeof txOps) => Promise<void>) => fn(txOps)),
    };
    const soroban = {
      getLatestLedger: jest.fn().mockResolvedValue(200),
      getEvents: jest.fn().mockResolvedValue({ events: [] }),
    };

    const service = new IndexerService(prisma as never, soroban as never, makeConfig());
    await service.processNextBatchForNetwork(network);

    const gapLogs = warnSpy.mock.calls.filter(
      (c) => typeof c[0] === 'string' && c[0].includes('indexer_ledger_gap'),
    );
    expect(gapLogs.length).toBe(1);
    expect(prisma.ledgerGapAlertDedup.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { network } }),
    );

    warnSpy.mockRestore();
  });

  it('suppressed duplicate alert is logged with reason', async () => {
    const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    const txOps = {
      ledgerCursor: {
        findUnique: jest.fn().mockResolvedValue({ lastProcessedLedger: 0 }),
        upsert: jest.fn(),
      },
    };
    const prisma = {
      ledgerCursor: {
        findUnique: jest.fn().mockResolvedValue({ network, lastProcessedLedger: 0, updatedAt: new Date() }),
        create: jest.fn(),
      },
      indexerState: { findFirst: jest.fn() },
      ledgerGapAlertDedup: {
        // Return a recent lastFiredAt so cooldown is still active
        findUnique: jest.fn().mockResolvedValue({ network, lastFiredAt: new Date() }),
        upsert: jest.fn(),
      },
      $transaction: jest.fn(async (fn: (t: typeof txOps) => Promise<void>) => fn(txOps)),
    };
    const soroban = {
      getLatestLedger: jest.fn().mockResolvedValue(200),
      getEvents: jest.fn().mockResolvedValue({ events: [] }),
    };

    const service = new IndexerService(prisma as never, soroban as never, makeConfig());
    await service.processNextBatchForNetwork(network);

    const suppressedLogs = logSpy.mock.calls.filter(
      (c) => typeof c[0] === 'string' && c[0].includes('indexer_ledger_gap_suppressed'),
    );
    expect(suppressedLogs.length).toBe(1);
    expect(suppressedLogs[0][0]).toContain('cooldown_active');
    // Dedup row must NOT be updated when suppressed
    expect(prisma.ledgerGapAlertDedup.upsert).not.toHaveBeenCalled();

    logSpy.mockRestore();
    jest.restoreAllMocks();
  });

  it('alert fires again after cooldown expires', async () => {
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    const txOps = {
      ledgerCursor: {
        findUnique: jest.fn().mockResolvedValue({ lastProcessedLedger: 0 }),
        upsert: jest.fn(),
      },
    };
    // lastFiredAt is 2 hours ago — well past the 60 s cooldown
    const expiredFiredAt = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const prisma = {
      ledgerCursor: {
        findUnique: jest.fn().mockResolvedValue({ network, lastProcessedLedger: 0, updatedAt: new Date() }),
        create: jest.fn(),
      },
      indexerState: { findFirst: jest.fn() },
      ledgerGapAlertDedup: {
        findUnique: jest.fn().mockResolvedValue({ network, lastFiredAt: expiredFiredAt }),
        upsert: jest.fn(),
      },
      $transaction: jest.fn(async (fn: (t: typeof txOps) => Promise<void>) => fn(txOps)),
    };
    const soroban = {
      getLatestLedger: jest.fn().mockResolvedValue(200),
      getEvents: jest.fn().mockResolvedValue({ events: [] }),
    };

    const service = new IndexerService(prisma as never, soroban as never, makeConfig());
    await service.processNextBatchForNetwork(network);

    const gapLogs = warnSpy.mock.calls.filter(
      (c) => typeof c[0] === 'string' && c[0].includes('indexer_ledger_gap'),
    );
    expect(gapLogs.length).toBe(1);
    expect(prisma.ledgerGapAlertDedup.upsert).toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it('deduplicates gap alerts within cooldown (staging outage simulation)', async () => {
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    const txOps = {
      ledgerCursor: {
        findUnique: jest.fn().mockResolvedValue({ lastProcessedLedger: 0 }),
        upsert: jest.fn(),
      },
    };
    const prisma = {
      ledgerCursor: {
        findUnique: jest.fn().mockResolvedValue({
          network,
          lastProcessedLedger: 0,
          updatedAt: new Date(),
        }),
        create: jest.fn(),
      },
      indexerState: { findFirst: jest.fn() },
      ledgerGapAlertDedup: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({ network, lastFiredAt: new Date() }),
        upsert: jest.fn(),
      },
      $transaction: jest.fn(async (fn: (t: typeof txOps) => Promise<void>) => fn(txOps)),
    };

    const soroban = {
      getLatestLedger: jest.fn().mockResolvedValue(200),
      getEvents: jest.fn().mockResolvedValue({ events: [] }),
    };

    const service = new IndexerService(prisma as never, soroban as never, makeConfig());

    await service.processNextBatchForNetwork(network);
    await service.processNextBatchForNetwork(network);

    const gapLogs = warnSpy.mock.calls.filter(
      (c) => typeof c[0] === 'string' && c[0].includes('indexer_ledger_gap'),
    );
    expect(gapLogs.length).toBe(1);

    warnSpy.mockRestore();
  });
});

// ── processUntilCaughtUp: progress tracking, interruption, resume ────────────

describe('IndexerService.processUntilCaughtUp — progress tracking', () => {
  const network = 'unittest';

  function makeConfig() {
    return {
      get: jest.fn((key: string, def?: unknown) => {
        if (key === 'STELLAR_NETWORK') return network;
        if (key === 'INDEXER_GAP_ALERT_THRESHOLD_LEDGERS') return 50;
        if (key === 'INDEXER_GAP_ALERT_COOLDOWN_MS') return 60_000;
        return def;
      }),
    } as unknown as ConfigService;
  }

  function makePrisma(lastProcessed: number, progressUpsert = jest.fn(), progressUpdate = jest.fn()) {
    const txOps = {
      ledgerCursor: {
        findUnique: jest.fn().mockResolvedValue({ lastProcessedLedger: lastProcessed }),
        upsert: jest.fn(),
      },
    };
    return {
      ledgerCursor: {
        findUnique: jest.fn().mockResolvedValue({ network, lastProcessedLedger: lastProcessed, updatedAt: new Date() }),
        create: jest.fn(),
      },
      indexerState: { findFirst: jest.fn() },
      ledgerGapAlertDedup: { findUnique: jest.fn(), upsert: jest.fn() },
      reindexProgress: {
        upsert: progressUpsert,
        update: progressUpdate,
        findFirst: jest.fn(),
      },
      $transaction: jest.fn(async (fn: (t: typeof txOps) => Promise<void>) => fn(txOps)),
    };
  }

  it('records progress row on start and marks completed when caught up', async () => {
    const progressUpsert = jest.fn();
    const progressUpdate = jest.fn();
    const prisma = makePrisma(900, progressUpsert, progressUpdate);

    const soroban = {
      getLatestLedger: jest.fn().mockResolvedValue(900), // already caught up
      getEvents: jest.fn().mockResolvedValue({ events: [] }),
    };

    const service = new IndexerService(prisma as never, soroban as never, makeConfig());
    await service.processUntilCaughtUp(network, 'job-abc');

    expect(progressUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { jobId: 'job-abc' },
        create: expect.objectContaining({ jobId: 'job-abc', network, status: 'running' }),
      }),
    );
    // Final update marks completed
    expect(progressUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { jobId: 'job-abc' },
        data: expect.objectContaining({ status: 'completed' }),
      }),
    );
  });

  it('updates currentLedger after each batch', async () => {
    const progressUpdate = jest.fn();
    const txOps = {
      ledgerCursor: {
        findUnique: jest.fn().mockResolvedValue({ lastProcessedLedger: 901 }),
        upsert: jest.fn(),
      },
      rawEvent: { upsert: jest.fn() },
    };
    // ledgerCursor.findUnique: first call for ensureCursor in processUntilCaughtUp,
    // then once per processNextBatchForNetwork call (2 batches), then once per progress update (2)
    const cursorFindUnique = jest.fn()
      .mockResolvedValueOnce({ network, lastProcessedLedger: 900, updatedAt: new Date() }) // ensureCursor in processUntilCaughtUp
      .mockResolvedValueOnce({ network, lastProcessedLedger: 900, updatedAt: new Date() }) // ensureCursor in batch 1
      .mockResolvedValueOnce({ network, lastProcessedLedger: 901, updatedAt: new Date() }) // progress update after batch 1
      .mockResolvedValueOnce({ network, lastProcessedLedger: 901, updatedAt: new Date() }) // ensureCursor in batch 2
      .mockResolvedValueOnce({ network, lastProcessedLedger: 901, updatedAt: new Date() }); // progress update after batch 2

    const prisma = {
      ledgerCursor: { findUnique: cursorFindUnique, create: jest.fn() },
      indexerState: { findFirst: jest.fn() },
      ledgerGapAlertDedup: { findUnique: jest.fn(), upsert: jest.fn() },
      reindexProgress: { upsert: jest.fn(), update: progressUpdate, findFirst: jest.fn() },
      $transaction: jest.fn(async (fn: (t: typeof txOps) => Promise<void>) => fn(txOps)),
    };

    const event = {
      txHash: 'tx1', ledger: 901, ledgerClosedAt: new Date().toISOString(),
      topic: [], value: { _value: {} }, contractId: { toString: () => 'C' },
    };
    const soroban = {
      getLatestLedger: jest.fn().mockResolvedValue(901),
      getEvents: jest.fn()
        .mockResolvedValueOnce({ events: [event] })
        .mockResolvedValueOnce({ events: [] }),
    };

    const service = new IndexerService(prisma as never, soroban as never, makeConfig());
    await service.processUntilCaughtUp(network, 'job-xyz');

    const batchUpdates = progressUpdate.mock.calls.filter(
      (c) => c[0]?.data?.currentLedger !== undefined,
    );
    expect(batchUpdates.length).toBeGreaterThanOrEqual(1);
  });

  it('resumes from last recorded ledger after interruption', async () => {
    // Cursor is at 950, latest is 960 — should fetch from 951
    const prisma = makePrisma(950);
    const soroban = {
      getLatestLedger: jest.fn().mockResolvedValue(960),
      getEvents: jest.fn().mockResolvedValue({ events: [] }),
    };

    const service = new IndexerService(prisma as never, soroban as never, makeConfig());
    await service.processUntilCaughtUp(network, 'job-resume');

    expect(soroban.getEvents).toHaveBeenCalledWith(951, expect.any(Number));
  });

  it('works without jobId (no progress writes)', async () => {
    const progressUpsert = jest.fn();
    const prisma = makePrisma(900, progressUpsert);
    const soroban = {
      getLatestLedger: jest.fn().mockResolvedValue(900),
      getEvents: jest.fn().mockResolvedValue({ events: [] }),
    };

    const service = new IndexerService(prisma as never, soroban as never, makeConfig());
    await service.processUntilCaughtUp(network); // no jobId

    expect(progressUpsert).not.toHaveBeenCalled();
  });
});
