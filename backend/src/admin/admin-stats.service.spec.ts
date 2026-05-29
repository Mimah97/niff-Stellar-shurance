import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AdminStatsService } from './admin-stats.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../cache/redis.service';

const FIXTURE_POLICIES = { total: 10, active: 7 };
const FIXTURE_CLAIMS_BY_STATUS = [
  { status: 'PENDING', _count: { status: 3 } },
  { status: 'APPROVED', _count: { status: 4 } },
  { status: 'REJECTED', _count: { status: 2 } },
  { status: 'PAID', _count: { status: 1 } },
];

describe('AdminStatsService', () => {
  let service: AdminStatsService;
  let mockPrisma: Record<string, jest.Mock>;
  let mockRedis: Record<string, jest.Mock>;

  beforeEach(async () => {
    mockPrisma = {
      'policy.count': jest.fn(),
      'claim.count': jest.fn(),
      'claim.groupBy': jest.fn(),
      'ledgerCursor.findFirst': jest.fn(),
    };

    const prismaProxy = {
      policy: {
        count: (args: unknown) => {
          const a = args as { where?: { isActive?: boolean } };
          if (a?.where?.isActive === true) return Promise.resolve(FIXTURE_POLICIES.active);
          return Promise.resolve(FIXTURE_POLICIES.total);
        },
      },
      claim: {
        count: jest.fn().mockResolvedValue(10),
        groupBy: jest.fn().mockResolvedValue(FIXTURE_CLAIMS_BY_STATUS),
      },
      ledgerCursor: {
        findFirst: jest.fn().mockResolvedValue({ lastProcessedLedger: 5000, updatedAt: new Date() }),
      },
    };

    mockRedis = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminStatsService,
        { provide: PrismaService, useValue: prismaProxy },
        { provide: RedisService, useValue: mockRedis },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue(30) } },
      ],
    }).compile();

    service = module.get(AdminStatsService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('getStats — cache miss', () => {
    it('returns correct aggregated values from DB fixtures', async () => {
      const stats = await service.getStats();

      expect(stats.policies.total).toBe(10);
      expect(stats.policies.active).toBe(7);
      expect(stats.claims.total).toBe(10);
      expect(stats.claims.byStatus).toEqual({
        PENDING: 3,
        APPROVED: 4,
        REJECTED: 2,
        PAID: 1,
      });
      expect(stats.indexer.lastProcessedLedger).toBe(5000);
      expect(stats.cachedAt).toBeDefined();
    });

    it('caches the result after first computation', async () => {
      await service.getStats();
      expect(mockRedis.set).toHaveBeenCalledWith(
        'admin:stats:v1',
        expect.objectContaining({ policies: { total: 10, active: 7 } }),
        30,
      );
    });
  });

  describe('getStats — cache hit', () => {
    it('returns cached response without hitting DB', async () => {
      const cachedStats = {
        policies: { total: 99, active: 50 },
        claims: { total: 5, byStatus: {} },
        treasury: { balanceStroops: null },
        indexer: { lagLedgers: null, lastProcessedLedger: 1000 },
        cachedAt: '2026-01-01T00:00:00.000Z',
      };
      mockRedis.get.mockResolvedValue(cachedStats);

      const stats = await service.getStats();
      expect(stats).toEqual(cachedStats);
      expect(mockRedis.set).not.toHaveBeenCalled();
    });
  });

  describe('getStats — tenant scoping', () => {
    it('uses tenant-scoped cache key', async () => {
      await service.getStats('tenant-abc');
      expect(mockRedis.get).toHaveBeenCalledWith('admin:stats:v1:tenant-abc');
      expect(mockRedis.set).toHaveBeenCalledWith(
        'admin:stats:v1:tenant-abc',
        expect.any(Object),
        30,
      );
    });

    it('uses global cache key when no tenant', async () => {
      await service.getStats();
      expect(mockRedis.get).toHaveBeenCalledWith('admin:stats:v1');
    });
  });

  describe('getStats — treasury from Redis solvency snapshot', () => {
    it('includes treasury balance from solvency snapshot', async () => {
      mockRedis.get.mockImplementation((key: string) => {
        if (key === 'solvency:snapshot:v1') return Promise.resolve({ contractBalanceStroops: '1000000' });
        return Promise.resolve(null);
      });

      const stats = await service.getStats();
      expect(stats.treasury.balanceStroops).toBe('1000000');
    });

    it('returns null treasury balance when snapshot missing', async () => {
      mockRedis.get.mockResolvedValue(null);
      const stats = await service.getStats();
      expect(stats.treasury.balanceStroops).toBeNull();
    });
  });
});
