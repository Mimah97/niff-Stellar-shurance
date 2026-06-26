/**
 * Outbound webhook delivery queue — issues #891, #892, #893.
 *
 * Subscribers (comma-separated URLs from env) receive POST requests with event
 * payloads. Jobs are retried with exponential backoff up to MAX_OUTBOUND_ATTEMPTS.
 */

import { Queue, Worker, Job } from 'bullmq';
import { getBullMQConnection } from '../redis/client';

export interface OutboundWebhookJob {
  targetUrl: string;
  eventType: string;
  idempotencyKey: string;
  payload: Record<string, unknown>;
}

const QUEUE_NAME = 'outbound-webhooks';

export const MAX_OUTBOUND_ATTEMPTS = parseInt(
  process.env.MAX_OUTBOUND_WEBHOOK_ATTEMPTS ?? '5',
  10,
);

export const outboundWebhookQueue = new Queue<OutboundWebhookJob>(QUEUE_NAME, {
  connection: getBullMQConnection(),
  defaultJobOptions: {
    attempts: MAX_OUTBOUND_ATTEMPTS,
    backoff: { type: 'exponential', delay: 1_000 },
    removeOnComplete: { count: 200 },
    removeOnFail: false,
  },
});

export const outboundWebhookWorker = new Worker<OutboundWebhookJob>(
  QUEUE_NAME,
  async (job: Job<OutboundWebhookJob>) => {
    const { targetUrl, eventType, payload, idempotencyKey } = job.data;
    const { default: axios } = await import('axios');
    await axios.post(targetUrl, payload, {
      headers: {
        'Content-Type': 'application/json',
        'X-Event-Type': eventType,
        'X-Idempotency-Key': idempotencyKey,
      },
      timeout: 10_000,
    });
    console.log(
      `[outbound-webhook] delivered event=${eventType} to=${targetUrl} key=${idempotencyKey}`,
    );
  },
  {
    connection: getBullMQConnection(),
    concurrency: 5,
  },
);

outboundWebhookWorker.on('failed', (job, err) => {
  if (job) {
    console.error(
      `[outbound-webhook] failed event=${job.data.eventType} to=${job.data.targetUrl} attempt=${job.attemptsMade}/${MAX_OUTBOUND_ATTEMPTS}: ${err.message}`,
    );
  }
});
