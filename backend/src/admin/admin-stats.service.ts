import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../cache/redis.service';

export interface AdminStats {
  policies: {
    total: number;
    active: number;
  };
  claims: {
    total: number;
    byStatus: Record<string, number>;
  };
  treasury: {
    balanceStroops: string | null;
  };
  indexer: {
    lagLedgers: number | null;
    lastProcessedLedger: number | null;
  };
  cachedAt: string;
}

const STATS_CACHE_KEY = 'admin:stats:v1';

@Injectable()
export class AdminStatsService {
  private readonly logger = new Logger(AdminStatsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  async getStats(tenantId?: string): Promise<AdminStats> {
    const cacheKey = tenantId ? `${STATS_CACHE_KEY}:${tenantId}` : STATS_CACHE_KEY;
    const ttl = this.config.get<number>('ADMIN_STATS_CACHE_TTL_SECONDS', 30);

    const cached = await this.redis.get<AdminStats>(cacheKey);
    if (cached) return cached;

    const stats = await this.computeStats(tenantId);
    await this.redis.set(cacheKey, stats, ttl);
    return stats;
  }

  private async computeStats(tenantId?: string): Promise<AdminStats> {
    const tenantFilter = tenantId ? { tenantId } : {};

    const [totalPolicies, activePolicies, totalClaims, claimsByStatus, cursor, solvency] =
      await Promise.all([
        this.prisma.policy.count({ where: { ...tenantFilter, deletedAt: null } }),
        this.prisma.policy.count({ where: { ...tenantFilter, isActive: true, deletedAt: null } }),
        this.prisma.claim.count({ where: { ...tenantFilter, deletedAt: null } }),
        this.prisma.claim.groupBy({
          by: ['status'],
          where: { ...tenantFilter, deletedAt: null },
          _count: { status: true },
        }),
        this.prisma.ledgerCursor
          .findFirst({ orderBy: { updatedAt: 'desc' } })
          .catch(() => null),
        this.redis
          .get<{ contractBalanceStroops?: string }>('solvency:snapshot:v1')
          .catch(() => null),
      ]);

    // Compute indexer lag: we'd need the latest ledger from RPC, but we only
    // have the cursor. Expose lastProcessedLedger; lag requires a live RPC call
    // which is out of scope for a cached stats endpoint.
    const lastProcessedLedger = cursor?.lastProcessedLedger ?? null;

    const byStatus: Record<string, number> = {};
    for (const row of claimsByStatus) {
      byStatus[row.status] = row._count.status;
    }

    return {
      policies: { total: totalPolicies, active: activePolicies },
      claims: { total: totalClaims, byStatus },
      treasury: { balanceStroops: solvency?.contractBalanceStroops ?? null },
      indexer: { lagLedgers: null, lastProcessedLedger },
      cachedAt: new Date().toISOString(),
    };
  }
}
