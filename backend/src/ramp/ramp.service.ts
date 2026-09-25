import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { Cron, CronExpression } from '@nestjs/schedule';
import { firstValueFrom } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service';
import { RampTransaction, RampProviderHealth, RampDirection, RampStatus } from '@prisma/client';

const STUCK_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes

@Injectable()
export class RampService {
  private readonly logger = new Logger(RampService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly http: HttpService,
  ) {}

  private isEnabled(): boolean {
    return this.config.get<string>('FEATURE_FIAT_RAMP') === 'true';
  }

  private assertEnabled(): void {
    if (!this.isEnabled()) {
      throw new BadRequestException('Fiat on/off-ramp is not enabled');
    }
  }

  private getAnchorUrl(): string {
    return this.config.get<string>('SEP24_ANCHOR_URL') ?? '';
  }

  /**
   * Start an interactive SEP-24 deposit flow and return the anchor's interactive URL.
   */
  async deposit(userId: string, assetCode: string, amount?: string): Promise<{ interactiveUrl: string; transaction: RampTransaction }> {
    return this.startFlow(userId, RampDirection.DEPOSIT, assetCode, amount);
  }

  /**
   * Start an interactive SEP-24 withdraw flow and return the anchor's interactive URL.
   */
  async withdraw(userId: string, assetCode: string, amount?: string): Promise<{ interactiveUrl: string; transaction: RampTransaction }> {
    return this.startFlow(userId, RampDirection.WITHDRAW, assetCode, amount);
  }

  private async startFlow(
    userId: string,
    direction: RampDirection,
    assetCode: string,
    amount?: string,
  ): Promise<{ interactiveUrl: string; transaction: RampTransaction }> {
    this.assertEnabled();

    const provider = await this.getHealthyProvider();
    if (!provider) {
      throw new NotFoundException('No healthy ramp provider available');
    }

    const transaction = await this.prisma.rampTransaction.create({
      data: {
        userId,
        providerId: provider.id,
        direction,
        assetCode,
        amount: amount ?? null,
        status: RampStatus.PENDING,
      },
    });

    const interactiveUrl = await this.requestInteractiveUrl(provider, transaction, direction);

    const updated = await this.prisma.rampTransaction.update({
      where: { id: transaction.id },
      data: { interactiveUrl, status: RampStatus.PENDING_ANCHOR },
    });

    return { interactiveUrl, transaction: updated };
  }

  private async requestInteractiveUrl(
    provider: RampProviderHealth,
    transaction: RampTransaction,
    direction: RampDirection,
  ): Promise<string> {
    const baseUrl = provider.baseUrl || this.getAnchorUrl();
    const endpoint = direction === RampDirection.DEPOSIT ? '/sep24/transactions/deposit/interactive' : '/sep24/transactions/withdraw/interactive';

    try {
      const { data } = await firstValueFrom(
        this.http.post(`${baseUrl}${endpoint}`, {
          asset_code: transaction.assetCode,
          amount: transaction.amount,
          account: transaction.userId,
        }),
      );
      return data.url;
    } catch (err) {
      this.logger.error(`Failed to start ${direction} flow: ${(err as Error).message}`);
      await this.prisma.rampTransaction.update({
        where: { id: transaction.id },
        data: { status: RampStatus.FAILED },
      });
      throw new BadRequestException('Failed to start ramp flow with anchor');
    }
  }

  /**
   * Callback handler invoked by the anchor (or poller) to update a RampTransaction status.
   */
  async handleStatusUpdate(transactionId: string, status: RampStatus, externalId?: string): Promise<RampTransaction> {
    const transaction = await this.prisma.rampTransaction.findUnique({ where: { id: transactionId } });
    if (!transaction) {
      throw new NotFoundException('Ramp transaction not found');
    }

    return this.prisma.rampTransaction.update({
      where: { id: transactionId },
      data: {
        status,
        externalId: externalId ?? transaction.externalId,
        completedAt: status === RampStatus.COMPLETED ? new Date() : transaction.completedAt,
      },
    });
  }

  /**
   * Poller that reconciles pending transactions against the anchor's status endpoint.
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async pollTransactionStatuses(): Promise<void> {
    if (!this.isEnabled()) {
      return;
    }

    const pending = await this.prisma.rampTransaction.findMany({
      where: { status: { in: [RampStatus.PENDING, RampStatus.PENDING_ANCHOR] } },
    });

    for (const transaction of pending) {
      try {
        const provider = await this.prisma.rampProviderHealth.findUnique({ where: { id: transaction.providerId } });
        if (!provider) {
          continue;
        }
        const baseUrl = provider.baseUrl || this.getAnchorUrl();
        const { data } = await firstValueFrom(
          this.http.get(`${baseUrl}/sep24/transaction?id=${transaction.externalId ?? transaction.id}`),
        );
        const mapped = this.mapAnchorStatus(data.status);
        if (mapped && mapped !== transaction.status) {
          await this.handleStatusUpdate(transaction.id, mapped, data.id);
        }
      } catch (err) {
        this.logger.warn(`Status poll failed for ${transaction.id}: ${(err as Error).message}`);
      }
    }
  }

  private mapAnchorStatus(anchorStatus: string): RampStatus | null {
    switch (anchorStatus) {
      case 'pending_user_transfer_start':
      case 'pending_anchor':
        return RampStatus.PENDING_ANCHOR;
      case 'completed':
        return RampStatus.COMPLETED;
      case 'error':
      case 'failed':
        return RampStatus.FAILED;
      case 'refunded':
        return RampStatus.REFUNDED;
      default:
        return null;
    }
  }

  /**
   * Health-check job that probes each provider and toggles its healthy flag.
   */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async checkProviderHealth(): Promise<void> {
    if (!this.isEnabled()) {
      return;
    }

    const providers = await this.prisma.rampProviderHealth.findMany();
    for (const provider of providers) {
      const baseUrl = provider.baseUrl || this.getAnchorUrl();
      let healthy = false;
      try {
        const { data } = await firstValueFrom(this.http.get(`${baseUrl}/sep24/info`));
        healthy = !!data;
      } catch (err) {
        this.logger.warn(`Provider ${provider.id} health check failed: ${(err as Error).message}`);
      }

      await this.prisma.rampProviderHealth.update({
        where: { id: provider.id },
        data: { healthy, lastCheckedAt: new Date() },
      });
    }
  }

  /**
   * Returns a healthy provider, hiding unhealthy ones from selection.
   */
  async getHealthyProvider(): Promise<RampProviderHealth | null> {
    return this.prisma.rampProviderHealth.findFirst({
      where: { healthy: true },
      orderBy: { lastCheckedAt: 'desc' },
    });
  }

  /**
   * Reconciliation job that flags transactions stuck longer than the threshold.
   */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async reconcileStuckTransactions(): Promise<void> {
    if (!this.isEnabled()) {
      return;
    }

    const cutoff = new Date(Date.now() - STUCK_THRESHOLD_MS);
    const stuck = await this.prisma.rampTransaction.findMany({
      where: {
        status: { in: [RampStatus.PENDING, RampStatus.PENDING_ANCHOR] },
        createdAt: { lt: cutoff },
        stuck: false,
      },
    });

    for (const transaction of stuck) {
      await this.prisma.rampTransaction.update({
        where: { id: transaction.id },
        data: { stuck: true, stuckFlaggedAt: new Date() },
      });
      this.logger.warn(`Ramp transaction ${transaction.id} flagged as stuck`);
    }
  }
}
