import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SorobanService } from '../rpc/soroban.service';
import { AppLoggerService } from '../common/logger/app-logger.service';
import { getNetworkConfig } from '../config/network.config';
import { runProbe, ProbeResult } from './probes';

const TIMEOUT_MS = 5_000;

export interface IndexerProbeResult extends ProbeResult {
  lagLedgers?: number;
}

@Injectable()
export class IndexerHealthIndicator {
  private readonly logger = new AppLoggerService();

  constructor(
    private readonly prisma: PrismaService,
    private readonly soroban: SorobanService,
  ) {}

  async check(): Promise<IndexerProbeResult> {
    return runProbe(async () => {
      const { network } = getNetworkConfig();

      const [cursor, latestLedger] = await Promise.all([
        this.prisma.ledgerCursor.findUnique({ where: { network } }),
        this.soroban.getLatestLedger(),
      ]);

      if (!cursor) {
        return { status: 'degraded' as const, lagLedgers: undefined };
      }

      const lagLedgers = Math.max(0, latestLedger - cursor.lastProcessedLedger);
      return { status: 'up' as const, lagLedgers };
    }, TIMEOUT_MS);
  }
}
