import { EvidenceProxyService } from './evidence-proxy.service';

const CLAIMANT = 'GCLAIMANT000000000000000000000000000000000000000000000000';
const VOTER = 'GVOTER0000000000000000000000000000000000000000000000000000';
const STRANGER = 'GSTRANGER00000000000000000000000000000000000000000000000000';
const CID = 'QmTestCid123456789';

function makeClaim(overrides: Partial<{ creatorAddress: string; imageUrls: string[]; votes: { voterAddress: string }[] }> = {}) {
  return {
    id: 1,
    creatorAddress: CLAIMANT,
    imageUrls: [`ipfs://${CID}`],
    votes: [{ voterAddress: VOTER }],
    ...overrides,
  };
}

function makeService(claimOverride?: ReturnType<typeof makeClaim> | null) {
  const prisma = {
    claim: {
      findUnique: jest.fn().mockResolvedValue(claimOverride !== undefined ? claimOverride : makeClaim()),
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
  const chunks = [new Uint8Array([1, 2, 3])];
  let i = 0;
  mockFetch.mockResolvedValue({
    ok: true,
    headers: { get: () => contentType },
    body: {
      getReader: () => ({
        read: jest.fn().mockImplementation(async () => {
          if (i < chunks.length) return { done: false, value: chunks[i++] };
          return { done: true, value: undefined };
        }),
      }),
    },
  });
}

describe('EvidenceProxyService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('streams evidence to claimant with correct headers', async () => {
    const { service } = makeService();
    mockFetchOk('image/png');
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
    const { service } = makeService();
    mockFetchOk();
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
    const { service, audit } = makeService();
    mockFetchOk();
    const res = makeRes();

    await service.stream(1, 0, CLAIMANT, res as never);

    expect(audit.write).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'evidence_download', actor: CLAIMANT }),
    );
  });
});
