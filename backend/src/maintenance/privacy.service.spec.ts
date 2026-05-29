import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrivacyService } from './privacy.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../admin/audit.service';

describe('PrivacyService', () => {
  let service: PrivacyService;
  let prisma: jest.Mocked<PrismaService>;
  let audit: jest.Mocked<AuditService>;

  const makePrisma = () => ({
    $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
    privacyRequest: {
      create: jest.fn(),
      update: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    claim: {
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    supportTicket: {
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn(),
    },
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PrivacyService,
        { provide: PrismaService, useValue: makePrisma() },
        { provide: AuditService, useValue: { write: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue(undefined) } },
      ],
    }).compile();

    service = module.get(PrivacyService);
    prisma = module.get(PrismaService);
    audit = module.get(AuditService);
  });

  afterEach(() => jest.clearAllMocks());

  // ── handleRequest ─────────────────────────────────────────────────────────

  describe('handleRequest', () => {
    it('anonymizes and audits', async () => {
      (prisma.privacyRequest.create as jest.Mock).mockResolvedValue({ id: 'req1' });
      (prisma.claim.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
      (prisma.privacyRequest.update as jest.Mock).mockResolvedValue({});

      const result = await service.handleRequest({
        subjectWalletAddress: 'GABC',
        requestType: 'ANONYMIZE',
        requestedBy: 'admin@test.com',
      });

      expect(result.requestId).toBe('req1');
      expect(result.rowsAffected).toBe(1);
      expect(audit.write).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'privacy_anonymize', actor: 'admin@test.com' }),
      );
    });

    it('deletes and audits', async () => {
      (prisma.privacyRequest.create as jest.Mock).mockResolvedValue({ id: 'req2' });
      (prisma.claim.deleteMany as jest.Mock).mockResolvedValue({ count: 2 });
      (prisma.privacyRequest.update as jest.Mock).mockResolvedValue({});

      const result = await service.handleRequest({
        subjectWalletAddress: 'GXYZ',
        requestType: 'DELETE',
        requestedBy: 'admin@test.com',
      });

      expect(result.rowsAffected).toBe(2);
    });
  });

  // ── processRequest ────────────────────────────────────────────────────────

  describe('processRequest', () => {
    it('throws NotFoundException for unknown requestId', async () => {
      (prisma.privacyRequest.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(service.processRequest('missing')).rejects.toThrow(NotFoundException);
    });

    it('is idempotent — returns existing result for COMPLETED request', async () => {
      (prisma.privacyRequest.findUnique as jest.Mock).mockResolvedValue({
        id: 'req1',
        status: 'COMPLETED',
        rowsAffected: 3,
        requestType: 'ANONYMIZE',
        subjectWalletAddress: 'GABC',
        requestedBy: 'admin@test.com',
      });

      const result = await service.processRequest('req1');

      expect(result).toEqual({ requestId: 'req1', rowsAffected: 3 });
      // Should NOT re-run anonymization
      expect(prisma.claim.updateMany).not.toHaveBeenCalled();
      expect(prisma.privacyRequest.update).not.toHaveBeenCalled();
    });

    it('processes IN_PROGRESS request and transitions to COMPLETED', async () => {
      (prisma.privacyRequest.findUnique as jest.Mock).mockResolvedValue({
        id: 'req2',
        status: 'IN_PROGRESS',
        rowsAffected: 0,
        requestType: 'ANONYMIZE',
        subjectWalletAddress: 'GABC',
        requestedBy: 'admin@test.com',
      });
      (prisma.claim.updateMany as jest.Mock).mockResolvedValue({ count: 2 });
      (prisma.privacyRequest.update as jest.Mock).mockResolvedValue({});

      const result = await service.processRequest('req2');

      expect(result.rowsAffected).toBe(2);
      expect(prisma.privacyRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'req2' },
          data: expect.objectContaining({ status: 'COMPLETED', rowsAffected: 2 }),
        }),
      );
    });
  });

  // ── anonymize ─────────────────────────────────────────────────────────────

  describe('anonymize', () => {
    it('redacts claim description and imageUrls', async () => {
      (prisma.claim.updateMany as jest.Mock).mockResolvedValue({ count: 3 });

      const result = await (service as any).anonymize('GABC');

      expect(result).toBe(3);
      expect(prisma.claim.updateMany).toHaveBeenCalledWith({
        where: { creatorAddress: 'GABC', deletedAt: null, description: { not: null } },
        data: { description: '[redacted]', imageUrls: [] },
      });
    });

    it('hashes SupportTicket email for matching wallet', async () => {
      (prisma.supportTicket.findMany as jest.Mock).mockResolvedValue([
        { id: 'ticket1', email: 'GABC' },
      ]);
      (prisma.supportTicket.update as jest.Mock).mockResolvedValue({ id: 'ticket1' });
      (prisma.claim.updateMany as jest.Mock).mockResolvedValue({ count: 0 });

      await (service as any).anonymize('GABC');

      expect(prisma.supportTicket.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'ticket1' },
          data: { email: expect.stringMatching(/^[a-f0-9]{64}$/) }, // SHA-256 hex
        }),
      );
    });

    it('does not re-hash already-redacted tickets (idempotent)', async () => {
      (prisma.supportTicket.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.claim.updateMany as jest.Mock).mockResolvedValue({ count: 0 });

      await (service as any).anonymize('GABC');

      expect(prisma.supportTicket.update).not.toHaveBeenCalled();
    });
  });

  // ── delete ────────────────────────────────────────────────────────────────

  describe('delete', () => {
    it('deletes non-finalized claims', async () => {
      (prisma.claim.deleteMany as jest.Mock).mockResolvedValue({ count: 1 });

      const result = await (service as any).delete('GXYZ');

      expect(result).toBe(1);
      expect(prisma.claim.deleteMany).toHaveBeenCalledWith({
        where: { creatorAddress: 'GXYZ', isFinalized: false, deletedAt: null },
      });
    });
  });
});
