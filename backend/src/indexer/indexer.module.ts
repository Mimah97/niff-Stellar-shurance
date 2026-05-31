import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { IndexerService } from './indexer.service';
import { IndexerWorker } from './indexer.worker';
import { ReindexWorkerService } from './reindex.worker';
import { BackfillWorkerService } from './backfill.worker';
import { ReconciliationService } from './reconciliation.service';
import { PrismaModule } from '../prisma/prisma.module';
import { RpcModule } from '../rpc/rpc.module';
import { EventsModule } from '../events/events.module';
import { ClaimPayoutVerificationService } from '../claims/services/claim-payout-verification.service';

@Module({
  imports: [PrismaModule, RpcModule, ConfigModule, ScheduleModule.forRoot(), EventsModule],
  providers: [IndexerService, ClaimPayoutVerificationService, IndexerWorker, ReindexWorkerService, BackfillWorkerService, ReconciliationService],
  exports: [IndexerService, ReconciliationService],
})
export class IndexerModule {}
