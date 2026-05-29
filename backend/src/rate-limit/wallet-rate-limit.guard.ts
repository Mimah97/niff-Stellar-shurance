/**
 * WalletRateLimitGuard — per-wallet sliding window rate limiter.
 *
 * Applies stricter limits to write endpoints (POST /claims, POST /policies,
 * POST /tx/submit) using Redis sorted sets for true sliding window tracking.
 *
 * Wallet identity is resolved from (in priority order):
 *   1. JWT-authenticated user (request.user.walletAddress)
 *   2. request.body.holder
 *   3. Falls through to global limit only (no per-wallet tracking)
 *
 * On limit exceeded: returns 429 with Retry-After header.
 * On Redis failure: fails open (allows the request) to avoid blocking users.
 *
 * Read endpoints are NOT affected — apply this guard only to write routes.
 */

import { Injectable, CanActivate, ExecutionContext, Logger } from '@nestjs/common';
import { Response } from 'express';
import { RateLimitService } from './rate-limit.service';
import { RateLimitException } from './rate-limit.exception';

@Injectable()
export class WalletRateLimitGuard implements CanActivate {
  private readonly logger = new Logger(WalletRateLimitGuard.name);

  constructor(private readonly rateLimitService: RateLimitService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      user?: { walletAddress?: string };
      body?: { holder?: string };
    }>();
    const response = context.switchToHttp().getResponse<Response>();

    const walletAddress = this.resolveWallet(request);

    try {
      // ── 1. Global circuit breaker ─────────────────────────────────────────
      const globalCheck = await this.rateLimitService.checkGlobalLimit();
      if (!globalCheck.allowed) {
        response.setHeader('Retry-After', String(globalCheck.retryAfterSeconds));
        throw new RateLimitException({
          policyId: 'global',
          currentCount: globalCheck.retryAfterSeconds,
          limit: 0,
          windowResetLedger: 0,
          remainingLedgers: 0,
          retryAfterSeconds: globalCheck.retryAfterSeconds,
          limitType: 'global',
        });
      }

      // ── 2. Per-wallet sliding window ──────────────────────────────────────
      if (walletAddress) {
        const walletCheck = await this.rateLimitService.checkWalletLimit(walletAddress);
        if (!walletCheck.allowed) {
          response.setHeader('Retry-After', String(walletCheck.retryAfterSeconds));
          throw new RateLimitException({
            policyId: walletAddress,
            currentCount: walletCheck.retryAfterSeconds,
            limit: 0,
            windowResetLedger: 0,
            remainingLedgers: 0,
            retryAfterSeconds: walletCheck.retryAfterSeconds,
            limitType: 'wallet',
          });
        }
      }

      return true;
    } catch (error) {
      if (error instanceof RateLimitException) throw error;
      this.logger.error(`WalletRateLimitGuard check failed: ${error}`);
      return true; // fail open
    }
  }

  private resolveWallet(request: {
    user?: { walletAddress?: string };
    body?: { holder?: string };
  }): string | undefined {
    return request.user?.walletAddress ?? request.body?.holder;
  }
}
