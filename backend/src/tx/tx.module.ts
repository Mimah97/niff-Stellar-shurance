import { Module } from '@nestjs/common';
import { TxController } from './tx.controller';
import { TxService } from './tx.service';
import { TxSubmitQueue } from './tx-submit.queue';
import { TxSubmitWorker } from './tx-submit.worker';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [TxController],
  providers: [TxService, TxSubmitQueue, TxSubmitWorker],
  exports: [TxSubmitQueue],
})
export class TxModule {}
