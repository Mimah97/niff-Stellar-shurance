import { Injectable } from '@nestjs/common';
import { AppLoggerService } from '../common/logger/app-logger.service';
import { getNetworkConfig } from '../config/network.config';
import { runProbe, ProbeResult } from './probes';

const TIMEOUT_MS = 5_000;

@Injectable()
export class HorizonHealthIndicator {
  private readonly logger = new AppLoggerService();

  async check(): Promise<ProbeResult> {
    return runProbe(async () => {
      const { horizonUrl } = getNetworkConfig();
      const res = await fetch(`${horizonUrl}`, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return { status: 'up' as const };
    }, TIMEOUT_MS);
  }
}
