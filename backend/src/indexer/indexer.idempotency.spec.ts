/**
 * Integration tests for idempotent event processing in IndexerService.
 *
 * Covers:
 *  - First-time inserts (no duplicate metric)
 *  - Exact duplicate raw_events (dedup metric incremented, no new row)
 *  - Partial duplicate batches (valid records processed, duplicates counted)
 *  - Concurrent processing (no duplicate rows under parallel calls)
 *  - Vote upserts (first insert vs. duplicate detection)
 *  - Immutable field protection (txHash, eventIndex, contractId, ledger unchanged on conflict)
 *  - Metric tracking (recordDuplicateEvent called with correct labels)
 */

import { ConfigService } from '@nestjs/config';
import { IndexerService } from './indexer.service';
import { MetricsService } from '../metrics/metrics.service';

jest.mock('@stellar/stellar-sdk', () => {
  const actual = jest.requireActual('@stellar/stellar-sdk') as Record<string, unknown>;
  return {
    ...actual,
    scValToNative: jest.fn(() => ({})),
  };
});

// Allow vote events through the parser by making isWarningRow return false
jest.mock('../events/parser-registry', () => {
  const actual = jest.requireActual('../events/parser-registry') as Record<string, unknown>;
  return {
    ...actual,
    isWarningRow: jest.fn(() => false),
    selectParser: jest.fn(() => ({
      parse: jest.fn(() => ({ kind: 'parsed' })),
    })),
  };
});

const NETWORK = 'testnet';

function makeConfig() {
  return {
    get: jest.fn((key: string, def?: unknown) => {
      if (key === 'STELLAR_NETWORK') return NETWORK;
      if (key === 'INDEXER_GAP_ALERT_THRESHOLD_LEDGERS') return 100;
      if (key === 'INDEXER_GAP_ALERT_COOLDOWN_MS') return 3_600_000;
      return def;
    }),
  } as unknown as ConfigService;
}

function makeEvent(txHash: string, ledger = 100) {
  return {
    txHash,
    ledger,
    ledgerClosedAt: new Date().toISOString(),
    topic: [],
    value: {},
    contractId: { toString: () => 'CONTRACT_A' },
  };
}

/** Build a minimal prisma mock with in-memory rawEvent and vote stores. */
function makePrismaWithStore() {
  const rawEvents = new Map<string, Record<string, unknown>>();
  const votes = new Map<string, Record<string, unknown>>();

  const rawEventKey = (txHash: string, eventIndex: number) => `${txHash}:${eventIndex}`;
  const voteKey = (claimId: number, voterAddress: string) => `${claimId}:${voterAddress}`;

  const txOps = {
    rawEvent: {
      findUnique: jest.fn(({ where }: { where: { txHash_eventIndex: { txHash: string; eventIndex: number } } }) => {
        const k = rawEventKey(where.txHash_eventIndex.txHash, where.txHash_eventIndex.eventIndex);
        return Promise.resolve(rawEvents.get(k) ?? null);
      }),
      upsert: jest.fn(({ where, create }: { where: { txHash_eventIndex: { txHash: string; eventIndex: number } }; create: Record<string, unknown> }) => {
        const k = rawEventKey(where.txHash_eventIndex.txHash, where.txHash_eventIndex.eventIndex);
        if (!rawEvents.has(k)) {
          rawEvents.set(k, { ...create });
        }
        return Promise.resolve(rawEvents.get(k));
      }),
    },
    vote: {
      findUnique: jest.fn(({ where }: { where: { claimId_voterAddress: { claimId: number; voterAddress: string } } }) => {
        const k = voteKey(where.claimId_voterAddress.claimId, where.claimId_voterAddress.voterAddress);
        return Promise.resolve(votes.get(k) ?? null);
      }),
      upsert: jest.fn(({ where, create, update }: { where: { claimId_voterAddress: { claimId: number; voterAddress: string } }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
        const k = voteKey(where.claimId_voterAddress.claimId, where.claimId_voterAddress.voterAddress);
        if (!votes.has(k)) {
          votes.set(k, { ...create });
        } else {
          votes.set(k, { ...votes.get(k), ...update });
        }
        return Promise.resolve(votes.get(k));
      }),
    },
    claim: {
      upsert: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({}),
    },
    policy: { upsert: jest.fn().mockResolvedValue({}) },
    ledgerCursor: {
      findUnique: jest.fn().mockResolvedValue({ lastProcessedLedger: 0 }),
      upsert: jest.fn(),
    },
  };

  const prisma = {
    ledgerCursor: {
      findUnique: jest.fn().mockResolvedValue({ network: NETWORK, lastProcessedLedger: 0, updatedAt: new Date() }),
      create: jest.fn(),
    },
    indexerState: { findFirst: jest.fn() },
    ledgerGapAlertDedup: { findUnique: jest.fn(), upsert: jest.fn() },
    $transaction: jest.fn(async (fn: (t: typeof txOps) => Promise<void>) => fn(txOps)),
    _rawEvents: rawEvents,
    _votes: votes,
    _txOps: txOps,
  };

  return prisma;
}

function makeSoroban(events: unknown[]) {
  return {
    getLatestLedger: jest.fn().mockResolvedValue(200),
    getEvents: jest.fn().mockResolvedValue({ events }),
  };
}

function makeMetrics() {
  return {
    recordIndexerLag: jest.fn(),
    recordDuplicateEvent: jest.fn(),
  } as unknown as MetricsService;
}

// ── First-time insert ────────────────────────────────────────────────────────

describe('first-time insert', () => {
  it('does not increment dedup metric for a new raw_event', async () => {
    const metrics = makeMetrics();
    const prisma = makePrismaWithStore();
    const event = makeEvent('tx_new_001');
    const soroban = makeSoroban([event]);

    const svc = new IndexerService(prisma as never, soroban as never, makeConfig(), metrics);
    await svc.processNextBatchForNetwork(NETWORK);

    expect(metrics.recordDuplicateEvent).not.toHaveBeenCalled();
    expect(prisma._rawEvents.size).toBe(1);
  });
});

// ── Exact duplicate raw_event ────────────────────────────────────────────────

describe('exact duplicate raw_event', () => {
  it('increments dedup metric and does not create a second row', async () => {
    const metrics = makeMetrics();
    const prisma = makePrismaWithStore();
    const event = makeEvent('tx_dup_001');
    const soroban = makeSoroban([event]);

    const svc = new IndexerService(prisma as never, soroban as never, makeConfig(), metrics);

    // First pass — insert
    await svc.processNextBatchForNetwork(NETWORK);
    expect(prisma._rawEvents.size).toBe(1);
    expect(metrics.recordDuplicateEvent).not.toHaveBeenCalled();

    // Second pass — duplicate
    await svc.processNextBatchForNetwork(NETWORK);
    expect(prisma._rawEvents.size).toBe(1); // still one row
    expect(metrics.recordDuplicateEvent).toHaveBeenCalledTimes(1);
    expect(metrics.recordDuplicateEvent).toHaveBeenCalledWith({
      eventType: 'raw_event',
      network: NETWORK,
    });
  });

  it('preserves immutable fields (contractId, ledger) on conflict', async () => {
    const metrics = makeMetrics();
    const prisma = makePrismaWithStore();
    const event = makeEvent('tx_immutable_001', 42);
    const soroban = makeSoroban([event]);

    const svc = new IndexerService(prisma as never, soroban as never, makeConfig(), metrics);

    await svc.processNextBatchForNetwork(NETWORK);
    const original = prisma._rawEvents.get('tx_immutable_001:0');
    expect(original?.contractId).toBe('CONTRACT_A');
    expect(original?.ledger).toBe(42);

    // Replay — update:{} means no fields change
    await svc.processNextBatchForNetwork(NETWORK);
    const after = prisma._rawEvents.get('tx_immutable_001:0');
    expect(after?.contractId).toBe('CONTRACT_A');
    expect(after?.ledger).toBe(42);
    expect(after?.txHash).toBe('tx_immutable_001');
  });
});

// ── Partial duplicate batch ──────────────────────────────────────────────────

describe('partial duplicate batch', () => {
  it('processes new events and counts duplicates without failing valid records', async () => {
    const metrics = makeMetrics();
    const prisma = makePrismaWithStore();

    const existingEvent = makeEvent('tx_existing_001', 100);
    const newEvent = makeEvent('tx_new_002', 101);

    // Pre-seed the existing event
    const soroban1 = makeSoroban([existingEvent]);
    const svc = new IndexerService(prisma as never, soroban1 as never, makeConfig(), metrics);
    await svc.processNextBatchForNetwork(NETWORK);
    expect(prisma._rawEvents.size).toBe(1);

    // Now process a batch with one duplicate + one new
    const soroban2 = makeSoroban([existingEvent, newEvent]);
    const svc2 = new IndexerService(prisma as never, soroban2 as never, makeConfig(), metrics);
    await svc2.processNextBatchForNetwork(NETWORK);

    expect(prisma._rawEvents.size).toBe(2); // both rows present
    expect(metrics.recordDuplicateEvent).toHaveBeenCalledTimes(1);
    expect(metrics.recordDuplicateEvent).toHaveBeenCalledWith({
      eventType: 'raw_event',
      network: NETWORK,
    });
  });

  it('counts each duplicate independently in a multi-duplicate batch', async () => {
    const metrics = makeMetrics();
    const prisma = makePrismaWithStore();

    const events = [
      makeEvent('tx_batch_001', 100),
      makeEvent('tx_batch_002', 101),
      makeEvent('tx_batch_003', 102),
    ];

    // First pass — all new
    const soroban1 = makeSoroban(events);
    const svc1 = new IndexerService(prisma as never, soroban1 as never, makeConfig(), metrics);
    await svc1.processNextBatchForNetwork(NETWORK);
    expect(metrics.recordDuplicateEvent).not.toHaveBeenCalled();

    // Second pass — all duplicates
    const soroban2 = makeSoroban(events);
    const svc2 = new IndexerService(prisma as never, soroban2 as never, makeConfig(), metrics);
    await svc2.processNextBatchForNetwork(NETWORK);
    expect(metrics.recordDuplicateEvent).toHaveBeenCalledTimes(3);
  });
});

// ── Concurrent processing ────────────────────────────────────────────────────

describe('concurrent processing', () => {
  it('does not create duplicate rows when two workers process the same event simultaneously', async () => {
    const metrics = makeMetrics();
    const prisma = makePrismaWithStore();
    const event = makeEvent('tx_concurrent_001', 100);

    // Simulate concurrent calls by running them sequentially with shared state
    // (true DB-level concurrency requires a real DB; here we verify the upsert
    // logic is idempotent regardless of ordering)
    const soroban = makeSoroban([event]);
    const svc = new IndexerService(prisma as never, soroban as never, makeConfig(), metrics);

    await svc.processNextBatchForNetwork(NETWORK);
    await svc.processNextBatchForNetwork(NETWORK);

    // Only one row should exist
    expect(prisma._rawEvents.size).toBe(1);
    // Second call detected a duplicate
    expect((metrics.recordDuplicateEvent as jest.Mock).mock.calls.length).toBe(1);
  });
});

// ── Vote upserts ─────────────────────────────────────────────────────────────

describe('vote upserts', () => {
  it('does not increment dedup metric for a first-time vote', async () => {
    const metrics = makeMetrics();
    const prisma = makePrismaWithStore();

    const { scValToNative } = jest.requireMock('@stellar/stellar-sdk') as {
      scValToNative: jest.Mock;
    };

    // scValToNative is called once per topic (3 topics) then once for the value
    // topics: [0]='vote', [1]=claimId(1), [2]='VOTER_A'
    // value: { vote: 'Approve', approve_votes: 1, reject_votes: 0 }
    scValToNative
      .mockReturnValueOnce('vote')
      .mockReturnValueOnce(1)
      .mockReturnValueOnce('VOTER_A')
      .mockReturnValue({ vote: 'Approve', approve_votes: 1, reject_votes: 0 });

    const event = {
      txHash: 'tx_vote_001',
      ledger: 100,
      ledgerClosedAt: new Date().toISOString(),
      topic: [{}, {}, {}], // 3 topics, values provided by mock
      value: {},
      contractId: { toString: () => 'CONTRACT_A' },
    };

    const soroban = makeSoroban([event]);
    const svc = new IndexerService(prisma as never, soroban as never, makeConfig(), metrics);
    await svc.processNextBatchForNetwork(NETWORK);

    expect(metrics.recordDuplicateEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'vote' }),
    );
    expect(prisma._votes.size).toBe(1);
  });

  it('increments vote dedup metric when the same voter replays', async () => {
    const metrics = makeMetrics();
    const prisma = makePrismaWithStore();

    const { scValToNative } = jest.requireMock('@stellar/stellar-sdk') as {
      scValToNative: jest.Mock;
    };

    const votePayload = { vote: 'Approve', approve_votes: 1, reject_votes: 0 };

    // First pass: topics + value
    scValToNative
      .mockReturnValueOnce('vote').mockReturnValueOnce(1).mockReturnValueOnce('VOTER_B')
      .mockReturnValueOnce(votePayload)
      // Second pass: topics + value
      .mockReturnValueOnce('vote').mockReturnValueOnce(1).mockReturnValueOnce('VOTER_B')
      .mockReturnValue(votePayload);

    const event = {
      txHash: 'tx_vote_002',
      ledger: 100,
      ledgerClosedAt: new Date().toISOString(),
      topic: [{}, {}, {}],
      value: {},
      contractId: { toString: () => 'CONTRACT_A' },
    };

    const soroban = makeSoroban([event]);
    const svc = new IndexerService(prisma as never, soroban as never, makeConfig(), metrics);

    // First pass
    await svc.processNextBatchForNetwork(NETWORK);
    expect(prisma._votes.size).toBe(1);

    // Second pass — same txHash → raw_event duplicate detected, vote row unchanged
    await svc.processNextBatchForNetwork(NETWORK);
    expect(prisma._votes.size).toBe(1); // still one row

    // A duplicate was detected (at raw_event level since same txHash)
    expect(metrics.recordDuplicateEvent).toHaveBeenCalledTimes(1);
    expect(metrics.recordDuplicateEvent).toHaveBeenCalledWith(
      expect.objectContaining({ network: NETWORK }),
    );
  });

  it('does not create duplicate vote rows for two different voters', async () => {
    const metrics = makeMetrics();
    const prisma = makePrismaWithStore();

    const { scValToNative } = jest.requireMock('@stellar/stellar-sdk') as {
      scValToNative: jest.Mock;
    };

    const votePayload = { vote: 'Approve', approve_votes: 1, reject_votes: 0 };

    // First event: VOTER_C
    scValToNative
      .mockReturnValueOnce('vote').mockReturnValueOnce(5).mockReturnValueOnce('VOTER_C')
      .mockReturnValueOnce(votePayload)
      // Second event: VOTER_D
      .mockReturnValueOnce('vote').mockReturnValueOnce(5).mockReturnValueOnce('VOTER_D')
      .mockReturnValue(votePayload);

    const event1 = {
      txHash: 'tx_v_c',
      ledger: 100,
      ledgerClosedAt: new Date().toISOString(),
      topic: [{}, {}, {}],
      value: {},
      contractId: { toString: () => 'CONTRACT_A' },
    };
    const event2 = {
      txHash: 'tx_v_d',
      ledger: 101,
      ledgerClosedAt: new Date().toISOString(),
      topic: [{}, {}, {}],
      value: {},
      contractId: { toString: () => 'CONTRACT_A' },
    };

    const soroban1 = makeSoroban([event1]);
    const svc1 = new IndexerService(prisma as never, soroban1 as never, makeConfig(), metrics);
    await svc1.processNextBatchForNetwork(NETWORK);

    const soroban2 = makeSoroban([event2]);
    const svc2 = new IndexerService(prisma as never, soroban2 as never, makeConfig(), metrics);
    await svc2.processNextBatchForNetwork(NETWORK);

    expect(prisma._votes.size).toBe(2);
    expect(metrics.recordDuplicateEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'vote' }),
    );
  });
});

// ── Metric tracking ──────────────────────────────────────────────────────────

describe('metric tracking', () => {
  it('passes correct network label to recordDuplicateEvent', async () => {
    const metrics = makeMetrics();
    const prisma = makePrismaWithStore();
    const event = makeEvent('tx_metric_001');
    const soroban = makeSoroban([event]);

    const svc = new IndexerService(prisma as never, soroban as never, makeConfig(), metrics);
    await svc.processNextBatchForNetwork(NETWORK);
    await svc.processNextBatchForNetwork(NETWORK); // duplicate

    expect(metrics.recordDuplicateEvent).toHaveBeenCalledWith({
      eventType: 'raw_event',
      network: NETWORK,
    });
  });

  it('does not call recordDuplicateEvent when metrics service is absent', async () => {
    const prisma = makePrismaWithStore();
    const event = makeEvent('tx_no_metrics_001');
    const soroban = makeSoroban([event]);

    // No metrics service injected
    const svc = new IndexerService(prisma as never, soroban as never, makeConfig());
    await svc.processNextBatchForNetwork(NETWORK);
    await svc.processNextBatchForNetwork(NETWORK); // duplicate — should not throw
    // If we reach here without throwing, the optional chaining works correctly
  });

  it('increments metric once per duplicate, not per batch call', async () => {
    const metrics = makeMetrics();
    const prisma = makePrismaWithStore();
    const events = [makeEvent('tx_count_001'), makeEvent('tx_count_002')];

    const soroban1 = makeSoroban(events);
    const svc1 = new IndexerService(prisma as never, soroban1 as never, makeConfig(), metrics);
    await svc1.processNextBatchForNetwork(NETWORK);

    // Replay same batch
    const soroban2 = makeSoroban(events);
    const svc2 = new IndexerService(prisma as never, soroban2 as never, makeConfig(), metrics);
    await svc2.processNextBatchForNetwork(NETWORK);

    // Two events replayed → two dedup increments
    expect(metrics.recordDuplicateEvent).toHaveBeenCalledTimes(2);
  });
});
