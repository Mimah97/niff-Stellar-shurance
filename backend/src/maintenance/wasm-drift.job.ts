import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker, Job } from 'bullmq';
import { getBullMQConnection } from '../redis/client';
import { WasmDriftService } from './wasm-drift.service';

const QUEUE_NAME = 'wasm-drift';
const JOB_NAME = 'check-drift';
const REPEATABLE_JOB_KEY = 'wasm-drift-scheduled';

@Injectable()
export class WasmDriftJob implements OnModuleInit {
  private readonly logger = new Logger(WasmDriftJob.name);
  private queue: Queue;
  private worker: Worker;

  constructor(
    private readonly config: ConfigService,
    private readonly wasmDriftService: WasmDriftService,
  ) {
    const connection = getBullMQConnection();
    this.queue = new Queue(QUEUE_NAME, { connection });
    this.worker = new Worker(
      QUEUE_NAME,
      async (_job: Job) => {
        await this.wasmDriftService.checkDrift();
      },
      { connection },
    );
    this.worker.on('failed', (job, err) => {
      this.logger.error(`[wasm-drift-job] failed job ${job?.id}: ${err.message}`);
    });
  }

  async onModuleInit(): Promise<void> {
    const intervalMs = this.config.get<number>('WASM_DRIFT_CHECK_INTERVAL_MS', 6 * 60 * 60 * 1000);
    // Remove stale repeatable job before re-registering (handles interval changes)
    const repeatables = await this.queue.getRepeatableJobs();
    for (const r of repeatables) {
      if (r.key === REPEATABLE_JOB_KEY || r.name === JOB_NAME) {
        await this.queue.removeRepeatableByKey(r.key);
      }
    }
    await this.queue.add(
      JOB_NAME,
      {},
      { repeat: { every: intervalMs }, jobId: REPEATABLE_JOB_KEY },
    );
    this.logger.log(`[wasm-drift-job] scheduled every ${intervalMs}ms`);
  }
}
