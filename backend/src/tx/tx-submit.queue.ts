import { Injectable } from '@nestjs/common';
import { Queue, Job } from 'bullmq';
import { getBullMQConnection } from '../redis/client';
import { TX_SUBMIT_QUEUE } from '../queues/names';

export interface TxSubmitJobData {
  signed_xdr: string;
  idempotency_key?: string;
}

export interface TxJobStatus {
  jobId: string;
  status: 'queued' | 'active' | 'completed' | 'failed' | 'delayed' | 'unknown';
  result?: {
    hash?: string;
    status?: string;
    ledger?: number;
    errorCode?: string;
    errorMessage?: string;
  };
  failedReason?: string;
}

@Injectable()
export class TxSubmitQueue {
  private readonly queue: Queue<TxSubmitJobData>;

  constructor() {
    this.queue = new Queue<TxSubmitJobData>(TX_SUBMIT_QUEUE, {
      connection: getBullMQConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2_000 },
        removeOnComplete: { count: 200 },
        removeOnFail: { count: 500 },
      },
    });
  }

  async enqueue(data: TxSubmitJobData): Promise<string> {
    const job = await this.queue.add('submit', data, {
      ...(data.idempotency_key && { jobId: `idem:${data.idempotency_key}` }),
    });
    return job.id!;
  }

  async getStatus(jobId: string): Promise<TxJobStatus> {
    const job: Job<TxSubmitJobData> | undefined = await this.queue.getJob(jobId);
    if (!job) {
      return { jobId, status: 'unknown' };
    }
    const state = await job.getState();
    const mapped = this.mapState(state);
    return {
      jobId,
      status: mapped,
      result: job.returnvalue ?? undefined,
      failedReason: job.failedReason ?? undefined,
    };
  }

  private mapState(state: string): TxJobStatus['status'] {
    const map: Record<string, TxJobStatus['status']> = {
      waiting: 'queued',
      active: 'active',
      completed: 'completed',
      failed: 'failed',
      delayed: 'delayed',
    };
    return map[state] ?? 'unknown';
  }
}
