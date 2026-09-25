import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { RampTransaction, RampTransactionStatus } from './ramp-transaction.entity';
import { RampProviderHealth } from './ramp-provider-health.entity';
import { RampProviderService } from './ramp-provider.service';

/**
 * Background jobs for the SEP-24 fiat on/off-ramp integration.
 *
 * All jobs are gated behind the `ramp.enabled` feature flag so the whole
 * feature can be toggled off without redeploying.
 */
@Injectable()
export class RampJobs {
  private readonly logger = new Logger(RampJobs.name);

  constructor(
    @InjectRepository(RampTransaction)
    private readonly rampTransactionRepo: Repository<RampTransaction>,
    @InjectRepository(RampProviderHealth)
    private readonly rampProviderHealthRepo: Repository<RampProviderHealth>,
    private readonly rampProviderService: RampProviderService,
    private readonly configService: ConfigService,
  ) {}

  private isEnabled(): boolean {
    return this.configService.get<boolean>('ramp.enabled', false);
  }

  /**
   * Polls the anchor for the status of in-flight transactions and updates
   * the local `RampTransaction` records accordingly.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async pollTransactionStatus(): Promise<void> {
    if (!this.isEnabled()) {
      return;
    }

    const pending = await this.rampTransactionRepo.find({
      where: [
        { status: RampTransactionStatus.PENDING },
        { status: RampTransactionStatus.INCOMPLETE },
      ],
    });

    for (const transaction of pending) {
      try {
        const remote = await this.rampProviderService.fetchTransactionStatus(
          transaction.provider,
          transaction.providerTransactionId,
        );

        if (remote && remote.status !== transaction.status) {
          transaction.status = remote.status;
          transaction.statusMessage = remote.message ?? null;
          transaction.updatedAt = new Date();
          await this.rampTransactionRepo.save(transaction);
        }
      } catch (error) {
        this.logger.warn(
          `Failed to poll ramp transaction ${transaction.id}: ${error.message}`,
        );
      }
    }
  }

  /**
   * Health-checks each configured anchor and persists the result so unhealthy
   * providers can be hidden from selection.
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async checkProviderHealth(): Promise<void> {
    if (!this.isEnabled()) {
      return;
    }

    const providers = this.rampProviderService.getProviders();

    for (const provider of providers) {
      let healthy = false;
      let message: string | null = null;

      try {
        healthy = await this.rampProviderService.checkHealth(provider.id);
      } catch (error) {
        message = error.message;
      }

      const record =
        (await this.rampProviderHealthRepo.findOne({
          where: { provider: provider.id },
        })) ?? this.rampProviderHealthRepo.create({ provider: provider.id });

      record.healthy = healthy;
      record.message = message;
      record.checkedAt = new Date();
      await this.rampProviderHealthRepo.save(record);
    }
  }

  /**
   * Flags transactions that have been stuck in a non-terminal state longer
   * than the configured threshold so they can be reconciled manually.
   */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async reconcileStuckTransactions(): Promise<void> {
    if (!this.isEnabled()) {
      return;
    }

    const thresholdMinutes = this.configService.get<number>(
      'ramp.stuckThresholdMinutes',
      60,
    );
    const cutoff = new Date(Date.now() - thresholdMinutes * 60 * 1000);

    const stuck = await this.rampTransactionRepo.find({
      where: [
        { status: RampTransactionStatus.PENDING, updatedAt: LessThan(cutoff) },
        { status: RampTransactionStatus.INCOMPLETE, updatedAt: LessThan(cutoff) },
      ],
    });

    for (const transaction of stuck) {
      transaction.status = RampTransactionStatus.STUCK;
      transaction.statusMessage = `No status update for over ${thresholdMinutes} minutes`;
      transaction.updatedAt = new Date();
      await this.rampTransactionRepo.save(transaction);

      this.logger.warn(`Ramp transaction ${transaction.id} flagged as stuck`);
    }
  }
}
