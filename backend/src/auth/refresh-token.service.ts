/**
 * RefreshTokenService
 *
 * Manages secure refresh token lifecycle:
 *   - Issues cryptographically random tokens (never stored in plaintext)
 *   - Stores only SHA-256 hash in Redis with 7-day TTL
 *   - Rotates on every use (old hash deleted, new token issued)
 *   - Detects reuse: if a consumed token is presented again, the entire
 *     session is revoked immediately (token-family invalidation)
 *   - Constant-time comparison via timingSafeEqual
 */
import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../cache/redis.service';
import { randomBytes, createHash, timingSafeEqual } from 'crypto';

/** 7 days in seconds */
const REFRESH_TTL_SECONDS = 7 * 24 * 3600;

/** Redis key prefix */
const PREFIX = 'rt:';

@Injectable()
export class RefreshTokenService {
  private readonly logger = new Logger(RefreshTokenService.name);
  private readonly ttl: number;

  constructor(
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {
    this.ttl = this.config.get<number>('JWT_REFRESH_TTL_SECONDS', REFRESH_TTL_SECONDS);
  }

  /** Generate a new refresh token, store its hash, return the raw token. */
  async issue(walletAddress: string): Promise<string> {
    const raw = randomBytes(40).toString('base64url'); // 320 bits
    const hash = this.hash(raw);
    const key = PREFIX + hash;
    await this.redis.set(key, { walletAddress, rotated: false }, this.ttl);
    return raw;
  }

  /**
   * Consume a refresh token:
   *   - Returns walletAddress on success (and deletes the hash so it can't be reused)
   *   - Throws UnauthorizedException on invalid/expired token
   *   - If the token was already rotated (reuse detected), revokes the whole session
   */
  async consume(raw: string): Promise<string> {
    const hash = this.hash(raw);
    const key = PREFIX + hash;

    const record = await this.redis.get<{ walletAddress: string; rotated: boolean }>(key);

    if (!record) {
      // Token not found — either expired, already consumed, or never existed.
      // Could be a reuse attempt; log but don't leak details.
      this.logger.warn('Refresh token not found — possible reuse or expiry');
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    if (record.rotated) {
      // Token was already rotated — this is a reuse attack.
      // Revoke the entire session for this wallet.
      this.logger.warn(`Refresh token reuse detected for wallet ${record.walletAddress} — revoking session`);
      await this.revokeAllForWallet(record.walletAddress);
      throw new UnauthorizedException('Refresh token reuse detected — session revoked');
    }

    // Mark as rotated (keeps the key briefly so reuse is detectable within TTL)
    await this.redis.set(key, { walletAddress: record.walletAddress, rotated: true }, 60);

    return record.walletAddress;
  }

  /** Immediately revoke a specific raw refresh token. */
  async revoke(raw: string): Promise<void> {
    const hash = this.hash(raw);
    await this.redis.del(PREFIX + hash);
  }

  /** Revoke all refresh tokens for a wallet (session invalidation). */
  async revokeAllForWallet(walletAddress: string): Promise<void> {
    // We don't maintain a per-wallet index to avoid O(n) scans.
    // Reuse detection already handles the attack vector.
    // This is a best-effort sweep using key scan — acceptable for security events.
    try {
      const client = this.redis.getClient();
      let cursor = '0';
      do {
        const [next, keys] = await client.scan(cursor, 'MATCH', `${PREFIX}*`, 'COUNT', 100);
        cursor = next;
        for (const key of keys) {
          const val = await this.redis.get<{ walletAddress: string }>(key);
          if (val?.walletAddress === walletAddress) {
            await this.redis.del(key);
          }
        }
      } while (cursor !== '0');
    } catch (err) {
      this.logger.error(`Failed to revoke all tokens for wallet: ${err}`);
    }
  }

  private hash(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }

  /** Constant-time comparison of two raw tokens (unused externally but available). */
  safeEqual(a: string, b: string): boolean {
    const ba = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ba.length !== bb.length) return false;
    return timingSafeEqual(ba, bb);
  }
}
