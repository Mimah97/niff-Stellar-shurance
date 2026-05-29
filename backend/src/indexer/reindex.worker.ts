import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Worker, Job } from 'bullmq';
import { getBullMQConnection } from '../redis/client';
import { IndexerService } from './indexer.service';
import { getRuntimeEnv } from '../config/runtime-env';

/**
 * ReindexWorkerService — BullMQ consumer for `reindex` queue jobs.
 *
 * Jobs are enqueued by the admin reindex endpoint after resetting the ledger
 * cursor. The worker calls `IndexerService.processUntilCaughtUp()` which
 * drains the backlog in batches until the indexer is caught up to the chain head.
 *
 * Concurrency: 1 per network (serialised via BullMQ job IDs).
 * Retry: BullMQ handles retries with exponential backoff (configured in the
 * queue producer). The worker itself does not retry — it lets BullMQ manage
 * the retry lifecycle so the job history is visible in Bull Board.
 */
@Injectable()
export class ReindexWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReindexWorkerService.name);
  private worker?: Worker;

  constructor(private readonly indexer: IndexerService) {}

  onModuleInit(): void {
    const env = getRuntimeEnv();
    if (env.NODE_ENV === 'test' || env.DISABLE_REINDEX_WORKER === '1') {
      this.logger.log('Reindex BullMQ worker disabled (test or DISABLE_REINDEX_WORKER)');
      return;
    }
    try {
      this.worker = new Worker(
        'reindex',
        async (job: Job) => {
          await this.processReindexJob(job);
        },
        {
          connection: getBullMQConnection(),
          concurrency: 1,
        },
      );

      this.worker.on('failed', (job, err) => {
        this.logger.error(`Reindex job ${job?.id} failed: ${err?.message}`, err?.stack);
      });

      this.worker.on('completed', (job) => {
        this.logger.log(`Reindex job ${job.id} completed successfully`);
      });
    } catch (err) {
      this.logger.warn(`Reindex worker not started: ${String(err)}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
  }

  private async processReindexJob(job: Job): Promise<void> {
    const { network } = job.data as { network?: string };
    const net = network ?? 'testnet';

    this.logger.log(`Starting reindex job ${job.id} for network ${net}`);

    const result = await this.indexer.processUntilCaughtUp(net, job.id);

    this.logger.log(
      `Reindex job ${job.id} complete: ${result.events} events in ${result.batches} batches`,
    );
  }
}
