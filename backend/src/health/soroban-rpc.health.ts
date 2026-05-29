import { Injectable, Logger } from '@nestjs/common';
import { HealthIndicator, HealthIndicatorResult, HealthCheckError } from '@nestjs/terminus';
import { SorobanService } from '../rpc/soroban.service';

/**
 * Soroban RPC health indicator for /health endpoint.
 *
 * Returns:
 *   - "up" if Soroban RPC responds to getLatestLedger within timeout
 *   - "down" if Soroban RPC is unreachable or times out
 *
 * Health check reflects RPC unavailability within one check interval.
 */
@Injectable()
export class SorobanRpcHealthIndicator extends HealthIndicator {
  private readonly logger = new Logger(SorobanRpcHealthIndicator.name);
  private lastHealthyTime = Date.now();
  private isCurrentlyUp = true;

  constructor(private readonly sorobanService: SorobanService) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      await this.sorobanService.getLatestLedger();
      this.lastHealthyTime = Date.now();
      this.isCurrentlyUp = true;
      return this.getStatus(key, true);
    } catch (err: unknown) {
      this.isCurrentlyUp = false;
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Soroban RPC health check failed: ${msg}`);

      const result = this.getStatus(key, false);
      throw new HealthCheckError('Soroban RPC health check failed', result);
    }
  }

  isUp(): boolean {
    return this.isCurrentlyUp;
  }

  getLastHealthyTime(): number {
    return this.lastHealthyTime;
  }
}
