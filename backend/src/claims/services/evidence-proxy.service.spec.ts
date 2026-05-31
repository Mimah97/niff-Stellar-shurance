import { createHash } from 'crypto';
import { EvidenceProxyService } from './evidence-proxy.service';

const CLAIMANT = 'GCLAIMANT000000000000000000000000000000000000000000000000';
const VOTER = 'GVOTER0000000000000000000000000000000000000000000000000000';
const STRANGER = 'GSTRANGER00000000000000000000000000000000000000000000000000';
const CID = 'QmTestCid123456789';

function makeClaim(overrides: Partial<{
  creatorAddress: string;
  imageUrls: string[];
  votes: { voterAddress: string }[];
  txHash: string | null;
  eventIndex: number | null;
}> = {}) {
  return {
    id: 1,
    creatorAddress: CLAIMANT,
    imageUrls: [`ipfs://${CID}`],
    votes: [{ voterAddress: VOTER }],
    txHash: '0xdeadbeef',
    eventIndex: 0,
    ...overrides,
  };
}

function makeService(claimOverride?: ReturnType<typeof makeClaim> | null) {
  const prisma = {
    claim: {
      findUnique: jest.fn().mockResolvedValue(claimOverride !== undefined ? claimOverride : makeClaim()),
    },
    rawEvent: {
      findUnique: jest.fn(),
    },
  };
  const audit = { write: jest.fn().mockResolvedValue(undefined) };
  const config = {
    get: jest.fn((key: string, def?: string) => {
      if (key === 'IPFS_GATEWAY') return 'https://ipfs.io';
      if (key === 'ADMIN_TOKEN') return 'admin-secret';
      return def;
    }),
  };
  const service = new EvidenceProxyService(prisma as never, audit as never, config as never);
  return { service, prisma, audit };
}

function makeRes() {
  const res = {
    headersSent: false,
    headers: {} as Record<string, string>,
    setHeader: jest.fn((k: string, v: string) => { res.headers[k] = v; }),
    write: jest.fn(),
    end: jest.fn(),
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
  return res;
}

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

function mockFetchOk(contentType = 'image/png') {
  const content = Buffer.from([1, 2, 3]);
  mockFetch.mockResolvedValue({
    ok: true,
    headers: { get: () => contentType },
    arrayBuffer: jest.fn().mockResolvedValue(content),
  });
  return content;
}

function mockFetchForContent(content: Buffer, contentType = 'image/png') {
  mockFetch.mockResolvedValue({
    ok: true,
    headers: { get: () => contentType },
    arrayBuffer: jest.fn().mockResolvedValue(content),
  });
}

describe('EvidenceProxyService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('streams evidence to claimant with correct headers', async () => {
    const { service, prisma } = makeService();
    const content = mockFetchOk('image/png');
    prisma.rawEvent.findUnique.mockResolvedValue({
      data: { evidence_hashes: [createHash('sha256').update(content).digest('hex')] },
    });
    const res = makeRes();

    await service.stream(1, 0, CLAIMANT, res as never);

    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'image/png');
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      'attachment; filename="claim-1-evidence-0"',
    );
    expect(res.end).toHaveBeenCalled();
  });

  it('streams evidence to active voter', async () => {
    const { service, prisma } = makeService();
    const content = mockFetchOk();
    prisma.rawEvent.findUnique.mockResolvedValue({
      data: { evidence_hashes: [createHash('sha256').update(content).digest('hex')] },
    });
    const res = makeRes();

    await service.stream(1, 0, VOTER, res as never);

    expect(res.end).toHaveBeenCalled();
  });

  it('returns 403 for unauthorized requester', async () => {
    const { service, audit } = makeService();
    const res = makeRes();

    await expect(service.stream(1, 0, STRANGER, res as never)).rejects.toThrow('Access denied');
    expect(audit.write).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'evidence_download_forbidden' }),
    );
  });

  it('returns 404 when claim does not exist', async () => {
    const { service } = makeService(null);
    const res = makeRes();

    await expect(service.stream(99, 0, CLAIMANT, res as never)).rejects.toThrow('not found');
  });

  it('returns 404 when evidence index is out of range', async () => {
    const { service } = makeService();
    const res = makeRes();

    await expect(service.stream(1, 5, CLAIMANT, res as never)).rejects.toThrow('not found');
  });

  it('writes audit log on successful download', async () => {
    const { service, audit, prisma } = makeService();
    const content = mockFetchOk();
    prisma.rawEvent.findUnique.mockResolvedValue({
      data: { evidence_hashes: [createHash('sha256').update(content).digest('hex')] },
    });
    const res = makeRes();

    await service.stream(1, 0, CLAIMANT, res as never);

    expect(audit.write).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'evidence_download', actor: CLAIMANT }),
    );
  });

  it('returns verified=true when fetched bytes match the on-chain commitment', async () => {
    const { service, prisma } = makeService();
    const content = Buffer.from('match me');
    mockFetchForContent(content);
    prisma.rawEvent.findUnique.mockResolvedValue({
      data: { evidence_hashes: [createHash('sha256').update(content).digest('hex')] },
    });

    const result = await service.fetch(1, 0, CLAIMANT);

    expect(result.verified).toBe(true);
    expect(result.hashMismatch).toBe(false);
  });

  it('flags hashMismatch and logs a security event when the hash differs', async () => {
    const { service, prisma, audit } = makeService();
    const content = Buffer.from('mismatch me');
    mockFetchForContent(content);
    prisma.rawEvent.findUnique.mockResolvedValue({
      data: { evidence_hashes: ['0'.repeat(64)] },
    });

    const result = await service.fetch(1, 0, CLAIMANT);

    expect(result.verified).toBe(false);
    expect(result.hashMismatch).toBe(true);
    expect(audit.write).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'evidence_hash_mismatch',
        actor: CLAIMANT,
      }),
    );
  });

  it('returns verified=false without error when the on-chain hash is missing', async () => {
    const { service, prisma } = makeService();
    mockFetchForContent(Buffer.from('no hash'));
    prisma.rawEvent.findUnique.mockResolvedValue(null);

    const result = await service.fetch(1, 0, CLAIMANT);

    expect(result.verified).toBe(false);
    expect(result.hashMismatch).toBe(false);
  });
});
