import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../../cache/redis.service';
import { MetricsService } from '../../metrics/metrics.service';
import type { ClaimsListResponseDto } from '../dto/claim.dto';

const DEFAULT_TTL_SECONDS = 30;
const KEY_PREFIX = 'claims:summary';

@Injectable()
export class ClaimSummaryCacheService {
  private readonly logger = new Logger(ClaimSummaryCacheService.name);
  private readonly ttlSeconds: number;

  constructor(
    private readonly redis: RedisService,
    private readonly config: ConfigService,
    @Optional() private readonly metrics?: MetricsService,
  ) {
    this.ttlSeconds = this.config.get<number>(
      'CLAIM_SUMMARY_CACHE_TTL_SECONDS',
      DEFAULT_TTL_SECONDS,
    );
  }

  key(parts: {
    tenantId?: string | null;
    after?: string;
    limit: number;
    status?: string;
  }): string {
    return [
      KEY_PREFIX,
      parts.tenantId ?? 'global',
      parts.after ?? 'start',
      String(parts.limit),
      parts.status ?? 'all',
    ].join(':');
  }

  async getOrCompute(
    key: string,
    compute: () => Promise<ClaimsListResponseDto>,
  ): Promise<ClaimsListResponseDto> {
    const cached = await this.redis.get<ClaimsListResponseDto>(key);
    if (cached) {
      this.metrics?.recordClaimSummaryCache('hit');
      return cached;
    }

    this.metrics?.recordClaimSummaryCache('miss');
    const response = await compute();
    await this.redis.set(key, response, this.ttlSeconds);
    return response;
  }

  async invalidateClaim(claimId: number | string): Promise<void> {
    await this.invalidateAll();
    this.logger.debug(`Claim summary cache invalidated after claim ${claimId} changed`);
  }

  async invalidateAll(): Promise<void> {
    await this.redis.delPattern(`${KEY_PREFIX}:*`);
  }
}
