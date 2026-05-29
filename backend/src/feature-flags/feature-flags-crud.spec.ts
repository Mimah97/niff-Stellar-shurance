import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FeatureFlagsService, ALLOWED_FLAG_KEYS } from './feature-flags.service';
import { PrismaService } from '../prisma/prisma.service';

describe('FeatureFlagsService — CRUD & allowlist', () => {
  let service: FeatureFlagsService;
  let mockPrisma: { featureFlag: { findMany: jest.Mock } };

  beforeEach(async () => {
    mockPrisma = { featureFlag: { findMany: jest.fn().mockResolvedValue([]) } };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FeatureFlagsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue(undefined) } },
      ],
    }).compile();

    service = module.get(FeatureFlagsService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('assertAllowlisted', () => {
    it('passes for every key in the allowlist', () => {
      for (const key of ALLOWED_FLAG_KEYS) {
        expect(() => service.assertAllowlisted(key)).not.toThrow();
      }
    });

    it('throws BadRequestException for arbitrary keys', () => {
      expect(() => service.assertAllowlisted('arbitrary_flag')).toThrow(BadRequestException);
      expect(() => service.assertAllowlisted('')).toThrow(BadRequestException);
    });
  });

  describe('refreshFlags', () => {
    it('reloads flags from DB and propagates to in-memory cache', async () => {
      mockPrisma.featureFlag.findMany.mockResolvedValueOnce([{ key: 'claims_enabled', enabled: true }]);
      await service.refreshFlags();
      expect(service.isEnabled('claims_enabled')).toBe(true);
    });

    it('propagates within FEATURE_FLAG_PROPAGATION_MS (synchronous in-process)', async () => {
      mockPrisma.featureFlag.findMany.mockResolvedValueOnce([{ key: 'voting_enabled', enabled: false }]);
      const start = Date.now();
      await service.refreshFlags();
      const elapsed = Date.now() - start;
      // In-process propagation is synchronous — should complete well within any reasonable window
      expect(elapsed).toBeLessThan(500);
      expect(service.isEnabled('voting_enabled')).toBe(false);
    });
  });

  describe('getFlags', () => {
    it('returns a copy of the current flag map', async () => {
      mockPrisma.featureFlag.findMany.mockResolvedValue([{ key: 'ramp_enabled', enabled: true }]);
      await service.loadFlagsFromDb();
      const flags = service.getFlags();
      expect(flags['ramp_enabled']).toBe(true);
      // Mutating the copy does not affect the service
      flags['ramp_enabled'] = false;
      expect(service.isEnabled('ramp_enabled')).toBe(true);
    });
  });
});
