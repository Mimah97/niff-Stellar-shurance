import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Worker, Job } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import { getBullMQConnection } from '../redis/client';
import { TX_SUBMIT_QUEUE } from '../queues/names';
import { TxSubmitJobData } from './tx-submit.queue';
import { rpc as SorobanRpc, TransactionBuilder } from '@stellar/stellar-sdk';

@Injectable()
export class TxSubmitWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TxSubmitWorker.name);
  private worker!: Worker<TxSubmitJobData>;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    this.worker = new Worker<TxSubmitJobData>(
      TX_SUBMIT_QUEUE,
      async (job: Job<TxSubmitJobData>) => this.process(job),
      { connection: getBullMQConnection(), concurrency: 5 },
    );
    this.worker.on('failed', (job, err) =>
      this.logger.error(`TX job ${job?.id} failed: ${err.message}`),
    );
  }

  async onModuleDestroy() {
    await this.worker.close();
  }

  private async process(job: Job<TxSubmitJobData>) {
    const { signed_xdr } = job.data;
    const rpcUrl = this.config.get<string>('SOROBAN_RPC_URL', 'https://soroban-testnet.stellar.org');
    const passphrase = this.config.get<string>('STELLAR_NETWORK_PASSPHRASE', 'Test SDF Network ; September 2015');

    const server = new SorobanRpc.Server(rpcUrl, { allowHttp: rpcUrl.startsWith('http://') });

    let parsed: ReturnType<typeof TransactionBuilder.fromXDR>;
    try {
      parsed = TransactionBuilder.fromXDR(signed_xdr, passphrase);
    } catch {
      throw new Error('INVALID_XDR: Could not parse signed_xdr');
    }

    const response = await server.sendTransaction(parsed);

    if (response.status === 'ERROR') {
      throw new Error(`TX_SUBMISSION_FAILED: Transaction submission failed`);
    }

    this.logger.log(`TX submitted hash=${response.hash} status=${response.status}`);
    return {
      hash: response.hash,
      status: response.status,
      ledger: (response as { ledger?: number }).ledger,
    };
  }
}
