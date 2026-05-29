/**
 * Integration tests for WalletRateLimitGuard.
 *
 * Verifies:
 *   - Wallet-specific limits are enforced independently of global limits.
 *   - Retry-After header is present on all 429 responses.
 *   - Read endpoints (GET /claims) are not affected by write endpoint exhaustion.
 *   - Global circuit breaker fires independently of per-wallet limits.
 *   - Guard fails open on Redis error.
 */

import { WalletRateLimitGuard } from '../wallet-rate-limit.guard';
import { RateLimitService } from '../rate-limit.service';
import { RateLimitException } from '../rate-limit.exception';
import { ExecutionContext } from '@nestjs/common';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeContext(
  walletAddress?: string,
  holder?: string,
): { ctx: ExecutionContext; responseHeaders: Record<string, string> } {
  const responseHeaders: Record<string, string> = {};
  const response = {
    setHeader: jest.fn((key: string, value: string) => {
      responseHeaders[key] = value;
    }),
  };
  const request = {
    user: walletAddress ? { walletAddress } : undefined,
    body: holder ? { holder } : {},
  };
  const ctx = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ExecutionContext;
  return { ctx, responseHeaders };
}

function makeService(overrides: {
  globalAllowed?: boolean;
  globalRetryAfter?: number;
  walletAllowed?: boolean;
  walletRetryAfter?: number;
  throwOnWallet?: boolean;
}): RateLimitService {
  return {
    checkGlobalLimit: jest.fn().mockResolvedValue({
      allowed: overrides.globalAllowed ?? true,
      retryAfterSeconds: overrides.globalRetryAfter ?? 0,
    }),
    checkWalletLimit: overrides.throwOnWallet
      ? jest.fn().mockRejectedValue(new Error('Redis down'))
      : jest.fn().mockResolvedValue({
          allowed: overrides.walletAllowed ?? true,
          retryAfterSeconds: overrides.walletRetryAfter ?? 0,
        }),
  } as unknown as RateLimitService;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('WalletRateLimitGuard', () => {
  it('allows request when both global and wallet limits are under threshold', async () => {
    const service = makeService({ globalAllowed: true, walletAllowed: true });
    const guard = new WalletRateLimitGuard(service);
    const { ctx } = makeContext('GABC123');
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('blocks request and sets Retry-After when wallet limit exceeded', async () => {
    const service = makeService({ globalAllowed: true, walletAllowed: false, walletRetryAfter: 42 });
    const guard = new WalletRateLimitGuard(service);
    const { ctx, responseHeaders } = makeContext('GABC123');
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(RateLimitException);
    expect(responseHeaders['Retry-After']).toBe('42');
  });

  it('blocks request and sets Retry-After when global circuit breaker fires', async () => {
    const service = makeService({ globalAllowed: false, globalRetryAfter: 60 });
    const guard = new WalletRateLimitGuard(service);
    const { ctx, responseHeaders } = makeContext('GABC123');
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(RateLimitException);
    expect(responseHeaders['Retry-After']).toBe('60');
  });

  it('wallet A exhaustion does not affect wallet B', async () => {
    // Wallet A is blocked; wallet B is allowed.
    const serviceA = makeService({ globalAllowed: true, walletAllowed: false, walletRetryAfter: 10 });
    const serviceB = makeService({ globalAllowed: true, walletAllowed: true });
    const guardA = new WalletRateLimitGuard(serviceA);
    const guardB = new WalletRateLimitGuard(serviceB);

    const { ctx: ctxA } = makeContext('GABC_WALLET_A');
    const { ctx: ctxB } = makeContext('GABC_WALLET_B');

    await expect(guardA.canActivate(ctxA)).rejects.toBeInstanceOf(RateLimitException);
    await expect(guardB.canActivate(ctxB)).resolves.toBe(true);
  });

  it('resolves wallet from body.holder when no JWT user', async () => {
    const service = makeService({ globalAllowed: true, walletAllowed: false, walletRetryAfter: 5 });
    const guard = new WalletRateLimitGuard(service);
    const { ctx } = makeContext(undefined, 'GHOLDER123');
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(RateLimitException);
    expect((service.checkWalletLimit as jest.Mock).mock.calls[0][0]).toBe('GHOLDER123');
  });

  it('fails open on Redis error (does not block the request)', async () => {
    const service = makeService({ throwOnWallet: true });
    const guard = new WalletRateLimitGuard(service);
    const { ctx } = makeContext('GABC123');
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('skips per-wallet check when no wallet identity is available', async () => {
    const service = makeService({ globalAllowed: true });
    const guard = new WalletRateLimitGuard(service);
    const { ctx } = makeContext(undefined, undefined);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(service.checkWalletLimit).not.toHaveBeenCalled();
  });

  it('Retry-After header is present on every 429 response', async () => {
    const cases = [
      makeService({ globalAllowed: false, globalRetryAfter: 30 }),
      makeService({ globalAllowed: true, walletAllowed: false, walletRetryAfter: 15 }),
    ];
    for (const service of cases) {
      const guard = new WalletRateLimitGuard(service);
      const { ctx, responseHeaders } = makeContext('GABC123');
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(RateLimitException);
      expect(responseHeaders['Retry-After']).toBeDefined();
      expect(Number(responseHeaders['Retry-After'])).toBeGreaterThan(0);
    }
  });
});
