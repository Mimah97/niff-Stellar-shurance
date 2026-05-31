import { ClaimPayoutVerificationService } from '../services/claim-payout-verification.service';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';

const mockTransactions = () => ({ hash: jest.fn() });
const mockOperations = () => ({ forTransaction: jest.fn() });

function makeHorizon(txOk: boolean, ops: unknown[]) {
  return {
    transactions: () => ({
      hash: () => ({
        call: jest.fn().mockResolvedValue(txOk ? { id: 'tx123' } : { id: 'wrong' }),
      }),
    }),
    operations: () => ({
      forTransaction: () => ({
        call: jest.fn().mockResolvedValue({ records: ops }),
      }),
    }),
  };
}

function makePrisma() {
  return {
    adminAuditLog: { create: jest.fn().mockResolvedValue({}) },
  } as unknown as PrismaService;
}

function makeConfig(url = 'https://horizon-testnet.stellar.org') {
  return { get: jest.fn().mockReturnValue(url) } as unknown as ConfigService;
}

describe('ClaimPayoutVerificationService', () => {
  it('returns verified=true for matching payment operation', async () => {
    const ops = [
      {
        type: 'payment',
        to: 'GRECIPIENT',
        amount: '100.0000000',
        successful: true,
      },
    ];
    const svc = new ClaimPayoutVerificationService(makeConfig(), makePrisma());
    (svc as any).horizonClient = makeHorizon(true, ops);

    const result = await svc.verifyTokenTransfer(1, 'tx123', '100.0000000', 'GRECIPIENT', '');
    expect(result.verified).toBe(true);
    expect(result.txHash).toBe('tx123');
  });

  it('returns verified=false when no matching operation found', async () => {
    const ops = [
      {
        type: 'payment',
        to: 'GWRONG',
        amount: '50.0000000',
        successful: true,
      },
    ];
    const svc = new ClaimPayoutVerificationService(makeConfig(), makePrisma());
    (svc as any).horizonClient = makeHorizon(true, ops);

    const result = await svc.verifyTokenTransfer(1, 'tx123', '100.0000000', 'GRECIPIENT', '');
    expect(result.verified).toBe(false);
    expect(result.errorReason).toBeTruthy();
  });

  it('returns verified=false and logs alert on Horizon error', async () => {
    const prisma = makePrisma();
    const svc = new ClaimPayoutVerificationService(makeConfig(), prisma);
    (svc as any).horizonClient = {
      transactions: () => ({
        hash: () => ({ call: jest.fn().mockRejectedValue(new Error('network error')) }),
      }),
    };

    const result = await svc.verifyTokenTransfer(1, 'tx123', '100', 'GRECIPIENT', '');
    expect(result.verified).toBe(false);
    expect(result.errorReason).toContain('network error');
    expect(prisma.adminAuditLog.create).toHaveBeenCalled();
  });

  it('returns verified=true for matching invoke_host_function operation', async () => {
    const ops = [
      {
        type: 'invoke_host_function',
        successful: true,
        function: {
          contract_id: 'CTOKEN',
          function_args: ['GRECIPIENT', '500'],
        },
      },
    ];
    const svc = new ClaimPayoutVerificationService(makeConfig(), makePrisma());
    (svc as any).horizonClient = makeHorizon(true, ops);

    const result = await svc.verifyTokenTransfer(1, 'tx123', '500', 'GRECIPIENT', 'CTOKEN');
    expect(result.verified).toBe(true);
  });
});
