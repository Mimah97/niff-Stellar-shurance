import { Test, TestingModule } from '@nestjs/testing';
import { HorizonService } from '../horizon.service';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../../cache/redis.service';
import { PrismaService } from '../../prisma/prisma.service';

const mockRedis = { get: jest.fn().mockResolvedValue(null), set: jest.fn(), getClient: jest.fn() };
const mockPrisma = { rawEvent: { findMany: jest.fn() } };
const mockConfig = { get: jest.fn((key: string, def: unknown) => def) };

const horizonRecord = {
  id: 'op1',
  paging_token: 'tok1',
  type: 'payment',
  type_int: 1,
  created_at: '2026-01-01T00:00:00Z',
  transaction_hash: 'hash1',
  transaction_successful: true,
  source_account: 'GABC',
  amount: '10',
  from: 'GABC',
  to: 'GDEF',
};

jest.mock('../../config/network.config', () => ({
  getNetworkConfig: () => ({ horizonUrl: 'https://horizon-testnet.stellar.org' }),
}));
jest.mock('../filters/horizon-field.filter', () => ({
  filterHorizonOperations: (r: unknown[]) => r,
}));

describe('HorizonService — enrichment', () => {
  let service: HorizonService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HorizonService,
        { provide: ConfigService, useValue: mockConfig },
        { provide: RedisService, useValue: mockRedis },
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get(HorizonService);

    // Mock Horizon fetch
    jest.spyOn(service as never, 'fetchFromHorizon').mockResolvedValue({
      _embedded: { records: [horizonRecord] },
      _links: {},
    });
  });

  afterEach(() => jest.clearAllMocks());

  it('attaches contractEvents to matching transactions', async () => {
    mockPrisma.rawEvent.findMany.mockResolvedValue([
      {
        txHash: 'hash1',
        eventIndex: 0,
        contractId: 'CCONTRACT',
        ledger: 100,
        ledgerClosedAt: new Date('2026-01-01'),
        topic1: 'claim_filed',
        topic2: null,
        topic3: null,
        topic4: null,
        data: { amount: '100' },
      },
    ]);

    const result = await service.getTransactions('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF', undefined, 1);
    expect(result.eventsEnriched).toBe(true);
    expect(result.records[0].contractEvents).toHaveLength(1);
    expect(result.records[0].contractEvents![0].contractId).toBe('CCONTRACT');
  });

  it('returns empty contractEvents when no matching raw_events', async () => {
    mockPrisma.rawEvent.findMany.mockResolvedValue([]);
    const result = await service.getTransactions('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF', undefined, 1);
    expect(result.eventsEnriched).toBe(true);
    expect(result.records[0].contractEvents).toEqual([]);
  });

  it('returns eventsEnriched: false and unenriched records on DB failure', async () => {
    mockPrisma.rawEvent.findMany.mockRejectedValue(new Error('DB down'));
    const result = await service.getTransactions('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF', undefined, 1);
    expect(result.eventsEnriched).toBe(false);
    expect(result.records).toHaveLength(1);
    expect(result.records[0].contractEvents).toBeUndefined();
  });
});
