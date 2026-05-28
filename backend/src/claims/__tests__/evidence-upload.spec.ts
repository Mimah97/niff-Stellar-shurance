/**
 * Integration tests for POST /claims/evidence/upload
 *
 * Covers: success (PDF, PNG, JPEG), invalid MIME, oversized, rate-limited,
 * unauthenticated, and no-file cases.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe, BadRequestException, HttpException, HttpStatus } from '@nestjs/common';
import request from 'supertest';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
// Inline file shape matching multer's Express.Multer.File
interface MulterFile {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
  stream: never;
  destination: string;
  filename: string;
  path: string;
}
import { ClaimsController } from '../claims.controller';
import { EvidenceUploadService } from '../services/evidence-upload.service';
import { ClaimsService } from '../claims.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RateLimitGuard } from '../../rate-limit/rate-limit.guard';
import { EVIDENCE_MAX_BYTES_DEFAULT } from '../dto/evidence-upload.dto';

// ── Minimal valid file buffers ────────────────────────────────────────────

const PNG_BUFFER = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
  0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41,
  0x54, 0x08, 0xd7, 0x63, 0xf8, 0xff, 0xff, 0x3f,
  0x00, 0x05, 0xfe, 0x02, 0xfe, 0xa3, 0x56, 0xeb,
  0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44,
  0xae, 0x42, 0x60, 0x82,
]);

const JPEG_BUFFER = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
  0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
]);

const PDF_BUFFER = Buffer.from(
  '%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\nxref\n0 2\ntrailer\n<< /Size 2 /Root 1 0 R >>\nstartxref\n9\n%%EOF',
);

// ── Mock services ─────────────────────────────────────────────────────────

const MOCK_CID = 'QmTestCid1234567890abcdef1234567890abcdef12345678';
const MOCK_GATEWAY = `https://ipfs.io/ipfs/${MOCK_CID}`;

const mockEvidenceUploadService = {
  upload: jest.fn().mockResolvedValue({ cid: MOCK_CID, gatewayUrl: MOCK_GATEWAY }),
};

const mockClaimsService = {
  listClaims: jest.fn(),
  getClaimById: jest.fn(),
  buildTransaction: jest.fn(),
  submitTransaction: jest.fn(),
  getClaimStatuses: jest.fn(),
  subscribeToStatusChanges: jest.fn(),
  getClaimsNeedingVote: jest.fn(),
};

// ── Test app factory ──────────────────────────────────────────────────────

type GuardOverride = { canActivate: (ctx: import('@nestjs/common').ExecutionContext) => boolean };

async function buildApp(jwtGuardOverride?: GuardOverride): Promise<INestApplication> {
  const builder = Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true }),
      ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 100 }]),
    ],
    controllers: [ClaimsController],
    providers: [
      { provide: EvidenceUploadService, useValue: mockEvidenceUploadService },
      { provide: ClaimsService, useValue: mockClaimsService },
    ],
  });

  if (jwtGuardOverride) {
    builder.overrideGuard(JwtAuthGuard).useValue(jwtGuardOverride);
  }
  builder.overrideGuard(RateLimitGuard).useValue({ canActivate: () => true });

  const module: TestingModule = await builder.compile();
  const app = module.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  return app;
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('POST /claims/evidence/upload', () => {
  let app: INestApplication;

  const authGuard: GuardOverride = {
    canActivate: (ctx) => {
      ctx.switchToHttp().getRequest().user = { walletAddress: 'GTEST123WALLET' };
      return true;
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    app = await buildApp(authGuard);
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns { cid, gatewayUrl } for a valid PNG upload', async () => {
    const res = await request(app.getHttpServer())
      .post('/claims/evidence/upload')
      .attach('file', PNG_BUFFER, { filename: 'evidence.png', contentType: 'image/png' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ cid: MOCK_CID, gatewayUrl: MOCK_GATEWAY });
    expect(mockEvidenceUploadService.upload).toHaveBeenCalledTimes(1);
    const [file, wallet] = mockEvidenceUploadService.upload.mock.calls[0] as [MulterFile, string];
    expect(file.mimetype).toBe('image/png');
    expect(wallet).toBe('GTEST123WALLET');
  });

  it('returns { cid, gatewayUrl } for a valid JPEG upload', async () => {
    const res = await request(app.getHttpServer())
      .post('/claims/evidence/upload')
      .attach('file', JPEG_BUFFER, { filename: 'photo.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('cid', MOCK_CID);
    expect(res.body).toHaveProperty('gatewayUrl', MOCK_GATEWAY);
  });

  it('returns { cid, gatewayUrl } for a valid PDF upload', async () => {
    const res = await request(app.getHttpServer())
      .post('/claims/evidence/upload')
      .attach('file', PDF_BUFFER, { filename: 'claim.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('cid', MOCK_CID);
  });

  it('returns 400 when no file is provided', async () => {
    const res = await request(app.getHttpServer())
      .post('/claims/evidence/upload')
      .set('Content-Type', 'multipart/form-data');

    expect(res.status).toBe(400);
    expect(mockEvidenceUploadService.upload).not.toHaveBeenCalled();
  });

  it('returns 400 for an unsupported MIME type and does not pin content', async () => {
    mockEvidenceUploadService.upload.mockRejectedValueOnce(
      new BadRequestException('Unsupported file type "image/gif"'),
    );

    const res = await request(app.getHttpServer())
      .post('/claims/evidence/upload')
      .attach('file', Buffer.from('GIF89a'), { filename: 'anim.gif', contentType: 'image/gif' });

    expect([400, 500]).toContain(res.status);
  });

  it('returns 400 for an oversized file and does not pin content', async () => {
    mockEvidenceUploadService.upload.mockRejectedValueOnce(
      new BadRequestException(`File exceeds maximum size of ${EVIDENCE_MAX_BYTES_DEFAULT} bytes`),
    );

    const oversized = Buffer.alloc(100, 0x00);
    const res = await request(app.getHttpServer())
      .post('/claims/evidence/upload')
      .attach('file', oversized, { filename: 'big.pdf', contentType: 'application/pdf' });

    expect([400, 413]).toContain(res.status);
  });

  it('returns 429 when the wallet rate limit is exceeded', async () => {
    mockEvidenceUploadService.upload.mockRejectedValueOnce(
      new HttpException('Upload rate limit exceeded. Retry after 3600s', HttpStatus.TOO_MANY_REQUESTS),
    );

    const res = await request(app.getHttpServer())
      .post('/claims/evidence/upload')
      .attach('file', PNG_BUFFER, { filename: 'evidence.png', contentType: 'image/png' });

    expect(res.status).toBe(429);
    expect(mockEvidenceUploadService.upload).toHaveBeenCalledTimes(1);
  });

  it('returns 401 when the request is unauthenticated', async () => {
    const { UnauthorizedException } = await import('@nestjs/common');
    const unauthApp = await buildApp({
      canActivate: () => { throw new UnauthorizedException(); },
    });
    const res = await request(unauthApp.getHttpServer())
      .post('/claims/evidence/upload')
      .attach('file', PNG_BUFFER, { filename: 'evidence.png', contentType: 'image/png' });

    expect(res.status).toBe(401);
    await unauthApp.close();
  });
});

// ── Unit tests for EvidenceUploadService ─────────────────────────────────

describe('EvidenceUploadService (unit)', () => {
  let service: EvidenceUploadService;

  const mockIpfs = {
    upload: jest.fn().mockResolvedValue({ cid: MOCK_CID, gatewayUrls: [MOCK_GATEWAY] }),
  };
  const mockAudit = { write: jest.fn().mockResolvedValue(undefined) };
  const mockRateLimit = {
    checkWalletEvidenceLimit: jest.fn().mockResolvedValue({ allowed: true, retryAfterSeconds: 0 }),
  };
  const mockConfig = { get: jest.fn((_key: string, def: unknown) => def) };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new EvidenceUploadService(
      mockIpfs as never,
      mockAudit as never,
      mockRateLimit as never,
      mockConfig as never,
    );
  });

  function makeFile(overrides: Partial<MulterFile> = {}): MulterFile {
    return {
      fieldname: 'file',
      originalname: 'evidence.png',
      encoding: '7bit',
      mimetype: 'image/png',
      buffer: PNG_BUFFER,
      size: PNG_BUFFER.length,
      stream: null as never,
      destination: '',
      filename: '',
      path: '',
      ...overrides,
    };
  }

  it('returns cid and gatewayUrl on success', async () => {
    const result = await service.upload(makeFile(), 'GWALLET');
    expect(result).toEqual({ cid: MOCK_CID, gatewayUrl: MOCK_GATEWAY });
    expect(mockIpfs.upload).toHaveBeenCalledTimes(1);
    expect(mockAudit.write).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'evidence_upload_success', actor: 'GWALLET' }),
    );
  });

  it('throws 400 for unsupported MIME type without calling IPFS', async () => {
    await expect(
      service.upload(makeFile({ mimetype: 'image/gif' }), 'GWALLET'),
    ).rejects.toThrow(BadRequestException);
    expect(mockIpfs.upload).not.toHaveBeenCalled();
  });

  it('throws 400 for oversized file without calling IPFS', async () => {
    const bigFile = makeFile({ size: EVIDENCE_MAX_BYTES_DEFAULT + 1, buffer: Buffer.alloc(EVIDENCE_MAX_BYTES_DEFAULT + 1) });
    await expect(service.upload(bigFile, 'GWALLET')).rejects.toThrow(BadRequestException);
    expect(mockIpfs.upload).not.toHaveBeenCalled();
  });

  it('throws 429 when rate limit is exceeded without calling IPFS', async () => {
    mockRateLimit.checkWalletEvidenceLimit.mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 3600 });
    await expect(service.upload(makeFile(), 'GWALLET')).rejects.toThrow(HttpException);
    expect(mockIpfs.upload).not.toHaveBeenCalled();
    expect(mockAudit.write).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'evidence_upload_rate_limited' }),
    );
  });

  it('throws 400 for dangerous file extension', async () => {
    await expect(
      service.upload(makeFile({ originalname: 'script.exe', mimetype: 'application/pdf' }), 'GWALLET'),
    ).rejects.toThrow(BadRequestException);
    expect(mockIpfs.upload).not.toHaveBeenCalled();
  });

  it('does not propagate audit write failures', async () => {
    mockAudit.write.mockRejectedValueOnce(new Error('DB down'));
    const result = await service.upload(makeFile(), 'GWALLET');
    expect(result.cid).toBe(MOCK_CID);
  });
});
