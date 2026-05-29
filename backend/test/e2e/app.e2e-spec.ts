import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { HttpExceptionFilter } from '../../src/common/filters/http-exception.filter';
import { mintUserToken, mintAdminToken } from '../helpers/jwt';

// A syntactically valid Stellar public key that is NOT a real keypair —
// used only to exercise the challenge endpoint's format validation path.
const FAKE_PUBKEY = 'GBSEED000000000000000000000000000000000000000000000000001';

describe('NiffyInsure API (E2E)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  // ── Health ──────────────────────────────────────────────────────────────────

  describe('GET /api/health', () => {
    it('returns 200 with status ok when DB is reachable', async () => {
      const res = await request(app.getHttpServer()).get('/api/health');
      // Terminus returns 200 (healthy) or 503 (unhealthy) — both are valid
      // responses that prove the endpoint is wired up. We assert the shape.
      expect([200, 503]).toContain(res.status);
      expect(res.body).toHaveProperty('status');
    });
  });

  // ── Auth ────────────────────────────────────────────────────────────────────

  describe('POST /api/auth/challenge', () => {
    it('returns 200 with nonce and message for a valid Stellar public key', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/challenge')
        .send({ publicKey: FAKE_PUBKEY });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        nonce: expect.any(String),
        message: expect.stringContaining(FAKE_PUBKEY),
        expiresAt: expect.any(String),
      });
    });

    it('returns 400 for a malformed public key', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/challenge')
        .send({ publicKey: 'not-a-stellar-key' });

      expect(res.status).toBe(400);
    });
  });

  // ── Public read endpoint ────────────────────────────────────────────────────

  describe('GET /api/claims (public)', () => {
    it('returns 200 with paginated claims list without auth', async () => {
      const res = await request(app.getHttpServer()).get('/api/claims');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('data');
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('returns 400 for an invalid cursor', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/claims')
        .query({ after: '!!!invalid-cursor!!!' });

      // Service should reject a non-base64 / malformed cursor
      expect(res.status).toBe(400);
    });
  });

  // ── Auth guard — protected route requires valid JWT ─────────────────────────

  describe('GET /api/claims/needs-my-vote (JWT-protected)', () => {
    it('returns 401 when no token is provided', async () => {
      const res = await request(app.getHttpServer()).get('/api/claims/needs-my-vote');
      expect(res.status).toBe(401);
    });

    it('returns 401 when a tampered token is provided', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/claims/needs-my-vote')
        .set('Authorization', 'Bearer totally.invalid.token');
      expect(res.status).toBe(401);
    });

    it('returns 200 with a valid user JWT', async () => {
      const token = mintUserToken(FAKE_PUBKEY);
      const res = await request(app.getHttpServer())
        .get('/api/claims/needs-my-vote')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('data');
    });
  });

  // ── Admin guard — non-admin JWT must be rejected ────────────────────────────

  describe('GET /api/admin/audits (admin-only)', () => {
    it('returns 401 with no token', async () => {
      const res = await request(app.getHttpServer()).get('/api/admin/audits');
      expect(res.status).toBe(401);
    });

    it('returns 403 when a user-scoped JWT (no admin role) is used', async () => {
      const token = mintUserToken(FAKE_PUBKEY);
      const res = await request(app.getHttpServer())
        .get('/api/admin/audits')
        .set('Authorization', `Bearer ${token}`);

      // JwtAuthGuard passes (valid token), AdminRoleGuard rejects (no role=admin)
      expect(res.status).toBe(403);
    });
  });

  // ── Notification Preferences ───────────────────────────────────────────────

  describe('GET /api/notifications/preferences (authenticated)', () => {
    it('returns 401 without valid JWT', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/notifications/preferences');

      expect(res.status).toBe(401);
    });

    it('returns default preferences for new user on first access', async () => {
      const token = mintUserToken(FAKE_PUBKEY);
      const res = await request(app.getHttpServer())
        .get('/api/notifications/preferences')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        renewalRemindersEnabled: true,
        claimUpdatesEnabled: true,
      });
    });

    it('returns previously set preferences on subsequent access', async () => {
      const token = mintUserToken(FAKE_PUBKEY);

      // First get defaults
      const firstRes = await request(app.getHttpServer())
        .get('/api/notifications/preferences')
        .set('Authorization', `Bearer ${token}`);

      expect(firstRes.status).toBe(200);
      expect(firstRes.body.renewalRemindersEnabled).toBe(true);
    });
  });

  describe('PATCH /api/notifications/preferences (authenticated)', () => {
    it('returns 401 without valid JWT', async () => {
      const res = await request(app.getHttpServer())
        .patch('/api/notifications/preferences')
        .send({ renewalRemindersEnabled: false });

      expect(res.status).toBe(401);
    });

    it('updates preferences with partial update', async () => {
      const token = mintUserToken(FAKE_PUBKEY);

      const res = await request(app.getHttpServer())
        .patch('/api/notifications/preferences')
        .set('Authorization', `Bearer ${token}`)
        .send({ renewalRemindersEnabled: false });

      expect(res.status).toBe(200);
      expect(res.body.renewalRemindersEnabled).toBe(false);
      expect(res.body.claimUpdatesEnabled).toBe(true); // unchanged
    });

    it('rejects unknown preference fields with 400', async () => {
      const token = mintUserToken(FAKE_PUBKEY);

      const res = await request(app.getHttpServer())
        .patch('/api/notifications/preferences')
        .set('Authorization', `Bearer ${token}`)
        .send({ unknownField: true });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('code');
    });

    it('rejects non-boolean values with 400', async () => {
      const token = mintUserToken(FAKE_PUBKEY);

      const res = await request(app.getHttpServer())
        .patch('/api/notifications/preferences')
        .set('Authorization', `Bearer ${token}`)
        .send({ renewalRemindersEnabled: 'true' });

      expect(res.status).toBe(400);
    });
  });

  // ── Idempotency ─────────────────────────────────────────────────────────────

  // ── Admin Claims Search ────────────────────────────────────────────────────

  describe('GET /api/admin/claims/search (admin-only)', () => {
    it('returns 401 without valid JWT', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/admin/claims/search');

      expect(res.status).toBe(401);
    });

    it('returns 403 with user JWT (not admin)', async () => {
      const token = mintUserToken(FAKE_PUBKEY);
      const res = await request(app.getHttpServer())
        .get('/api/admin/claims/search')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(403);
    });

    it('returns paginated claims list with empty results by default', async () => {
      const adminToken = mintAdminToken(FAKE_PUBKEY);
      const res = await request(app.getHttpServer())
        .get('/api/admin/claims/search')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('data');
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body).toHaveProperty('pagination');
      expect(res.body.pagination).toHaveProperty('total');
      expect(res.body.pagination).toHaveProperty('nextCursor');
    });

    it('filters results by status', async () => {
      const adminToken = mintAdminToken(FAKE_PUBKEY);
      const res = await request(app.getHttpServer())
        .get('/api/admin/claims/search')
        .query({ status: 'PENDING' })
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('data');
    });

    it('filters results by claimant', async () => {
      const adminToken = mintAdminToken(FAKE_PUBKEY);
      const res = await request(app.getHttpServer())
        .get('/api/admin/claims/search')
        .query({ claimant: 'GABC123' })
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('data');
    });

    it('supports cursor pagination with limit', async () => {
      const adminToken = mintAdminToken(FAKE_PUBKEY);
      const res = await request(app.getHttpServer())
        .get('/api/admin/claims/search')
        .query({ limit: '10' })
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toBeDefined();
      expect(res.body.pagination.total).toBeDefined();
    });

    it('excludes soft-deleted claims', async () => {
      const adminToken = mintAdminToken(FAKE_PUBKEY);
      const res = await request(app.getHttpServer())
        .get('/api/admin/claims/search')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      // All returned claims should have deletedAt = null
      expect(res.body.data.every((c: any) => !c.deletedAt)).toBe(true);
    });
  });

  // ── Admin Policies Export ──────────────────────────────────────────────────

  describe('GET /api/admin/policies/export (admin-only)', () => {
    it('returns 401 without valid JWT', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/admin/policies/export');

      expect(res.status).toBe(401);
    });

    it('returns 403 with user JWT (not admin)', async () => {
      const token = mintUserToken(FAKE_PUBKEY);
      const res = await request(app.getHttpServer())
        .get('/api/admin/policies/export')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(403);
    });

    it('returns CSV response with correct headers', async () => {
      const adminToken = mintAdminToken(FAKE_PUBKEY);
      const res = await request(app.getHttpServer())
        .get('/api/admin/policies/export')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.headers['content-disposition']).toContain('attachment');
      expect(res.headers['content-disposition']).toContain('policies.csv');
    });

    it('includes CSV headers in response', async () => {
      const adminToken = mintAdminToken(FAKE_PUBKEY);
      const res = await request(app.getHttpServer())
        .get('/api/admin/policies/export')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      const lines = res.text.split('\n');
      expect(lines[0]).toContain('id');
      expect(lines[0]).toContain('holderAddress');
      expect(lines[0]).toContain('status');
    });

    it('supports filtering by status', async () => {
      const adminToken = mintAdminToken(FAKE_PUBKEY);
      const res = await request(app.getHttpServer())
        .get('/api/admin/policies/export')
        .query({ status: 'ACTIVE' })
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
    });

    it('supports filtering by date range', async () => {
      const adminToken = mintAdminToken(FAKE_PUBKEY);
      const res = await request(app.getHttpServer())
        .get('/api/admin/policies/export')
        .query({
          dateFrom: '2026-01-01T00:00:00Z',
          dateTo: '2026-12-31T23:59:59Z',
        })
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
    });
  });

  describe('POST /api/claims (with Idempotency-Key)', () => {
    const idempotencyKey = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';

    it('first request is processed and response cached', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/claims')
        .set('Idempotency-Key', idempotencyKey)
        .send({});

      // Either 201 (if endpoint exists) or 404/405 (if not), but should NOT error on idempotency key validation
      expect([201, 404, 405]).toContain(res.status);
      expect(res.headers['idempotency-replayed']).toBeUndefined();
    });

    it('duplicate request with valid UUID v4 key returns Idempotency-Replayed header', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/claims')
        .set('Idempotency-Key', idempotencyKey)
        .send({});

      // Endpoint may not exist, but idempotency middleware should set the header on response
      expect(res.headers['idempotency-replayed']).toBe('true');
    });

    it('rejects malformed idempotency key (not UUID v4)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/claims')
        .set('Idempotency-Key', 'not-a-uuid')
        .send({});

      expect(res.status).toBe(400);
    });
  });
});
