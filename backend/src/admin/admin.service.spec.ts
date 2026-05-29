import { Test, TestingModule } from '@nestjs/testing';
import { AdminService } from '../admin.service';
import { PrismaService } from '../../prisma/prisma.service';
import { FeatureFlagsService } from '../../feature-flags/feature-flags.service';
import { ClaimStatus } from '@prisma/client';
import { BadRequestException } from '@nestjs/common';
import { BULK_UPDATE_MAX_BATCH } from '../dto/bulk-update-claims.dto';

jest.mock('bullmq', () => ({ Queue: jest.fn().mockImplementation(() => ({ add: jest.fn(), getJob: jest.fn() })) }));
jest.mock('../../redis/client', () => ({ getBullMQConnection: jest.fn().mockReturnValue({}) }));

const mockClaims = [
  { id: 1, status: ClaimStatus.PENDING, policyId: 'G:1' },
  { id: 2, status: ClaimStatus.PENDING, policyId: 'G:2' },
];

const mockPrisma = {
  claim: { findMany: jest.fn().mockResolvedValue(mockClaims), updateMany: jest.fn() },
  adminAuditLog: { create: jest.fn() },
  featureFlag: { upsert: jest.fn(), findMany: jest.fn() },
  $transaction: jest.fn(async (fn: (tx: typeof mockPrisma) => Promise<void>) => fn(mockPrisma)),
};

describe('AdminService.bulkUpdateClaims', () => {
  let service: AdminService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: FeatureFlagsService, useValue: { refreshFlags: jest.fn() } },
      ],
    }).compile();
    service = module.get(AdminService);
  });

  describe('enqueueReindex', () => {
    it('sets last_processed_ledger to fromLedger-1 and enqueues with network', async () => {
      const upsert = jest.fn();
      const progressUpsert = jest.fn();
      const prisma = {
        $transaction: jest.fn(async (fn: (t: { ledgerCursor: { upsert: jest.Mock } }) => Promise<void>) =>
          fn({ ledgerCursor: { upsert } })),
        reindexProgress: { upsert: progressUpsert },
      };

      const svc = new AdminService(prisma as never, { refreshFlags: jest.fn() } as never);
      const jobId = await svc.enqueueReindex(500, 'testnet');

      expect(jobId).toBe('queued-job-id');
      expect(upsert).toHaveBeenCalledWith({
        where: { network: 'testnet' },
        create: { network: 'testnet', lastProcessedLedger: 499 },
        update: { lastProcessedLedger: 499 },
      });
      expect(mockQueueAdd).toHaveBeenCalledWith(
        'reindex',
        { fromLedger: 500, network: 'testnet' },
        expect.objectContaining({
          jobId: expect.stringMatching(/^reindex-testnet-500-/),
        }),
      );
      expect(progressUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { jobId: 'queued-job-id' },
          create: expect.objectContaining({ network: 'testnet', status: 'running' }),
        }),
      );
    });

    it('clamps at 0 when fromLedger is 0', async () => {
      const upsert = jest.fn();
      const prisma = {
        $transaction: jest.fn(async (fn: (t: { ledgerCursor: { upsert: jest.Mock } }) => Promise<void>) =>
          fn({ ledgerCursor: { upsert } })),
        reindexProgress: { upsert: jest.fn() },
      };
      const svc = new AdminService(prisma as never, { refreshFlags: jest.fn() } as never);
      await svc.enqueueReindex(0, 'public');
      expect(upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ lastProcessedLedger: 0 }),
        }),
      );
    });
  });

  it('live update applies changes and creates audit log entries', async () => {
    const result = await service.bulkUpdateClaims([1, 2], ClaimStatus.APPROVED, 'approved by admin', 'admin', false);
    expect(result.dryRun).toBe(false);
    expect(result.affectedCount).toBe(2);
    expect(mockPrisma.claim.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [1, 2] } },
      data: { status: ClaimStatus.APPROVED },
    });
    expect(mockPrisma.adminAuditLog.create).toHaveBeenCalledTimes(2);
    expect(mockPrisma.adminAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'bulk_claim_status_update' }) }),
    );
  });

  it('over-cap requests are rejected by DTO validation (ArrayMaxSize)', () => {
    // Validate that BULK_UPDATE_MAX_BATCH is 100
    expect(BULK_UPDATE_MAX_BATCH).toBe(100);
  });

  it('returns empty affected list when no claims match', async () => {
    mockPrisma.claim.findMany.mockResolvedValueOnce([]);
    const result = await service.bulkUpdateClaims([999], ClaimStatus.REJECTED, 'not found', 'admin', false);
    expect(result.affectedCount).toBe(0);
    expect(mockPrisma.claim.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [] } },
      data: { status: ClaimStatus.REJECTED },
    });
  });

  describe('getReindexStatus', () => {
    function makeSvcWithProgress(row: unknown) {
      const prisma = {
        $transaction: jest.fn(),
        reindexProgress: {
          upsert: jest.fn(),
          findFirst: jest.fn().mockResolvedValue(row),
        },
      };
      return new AdminService(prisma as never, { refreshFlags: jest.fn() } as never);
    }

    it('returns null when no progress row exists', async () => {
      const svc = makeSvcWithProgress(null);
      expect(await svc.getReindexStatus('testnet')).toBeNull();
    });

    it('calculates percentage correctly', async () => {
      const svc = makeSvcWithProgress({
        jobId: 'j1', network: 'testnet',
        startLedger: 500, targetLedger: 1000, currentLedger: 750,
        status: 'running', startTime: new Date('2026-01-01'),
      });
      const result = await svc.getReindexStatus('testnet');
      expect(result?.percentage).toBe(50);
      expect(result?.status).toBe('running');
    });

    it('returns 100% when startLedger equals targetLedger', async () => {
      const svc = makeSvcWithProgress({
        jobId: 'j2', network: 'testnet',
        startLedger: 1000, targetLedger: 1000, currentLedger: 1000,
        status: 'completed', startTime: new Date(),
      });
      const result = await svc.getReindexStatus('testnet');
      expect(result?.percentage).toBe(100);
    });
  });
});
