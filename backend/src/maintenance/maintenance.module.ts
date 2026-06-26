import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from '../prisma/prisma.module';
import { RpcModule } from '../rpc/rpc.module';
import { IpfsModule } from '../ipfs/ipfs.module';
import { AuditService } from '../admin/audit.service';
import { WasmDriftService } from './wasm-drift.service';
import { WasmDriftJob } from './wasm-drift.job';
import { PrivacyService } from './privacy.service';
import { DataRetentionService } from './data-retention.service';
import { SolvencyMonitoringService } from './solvency-monitoring.service';
import { IpfsPinCheckJob } from './ipfs-pin-check.job';
import { OutboundWebhookService } from '../webhooks/outbound-webhook.service';

@Module({
  imports: [ScheduleModule.forRoot(), PrismaModule, RpcModule, IpfsModule],
  providers: [AuditService, WasmDriftService, WasmDriftJob, PrivacyService, DataRetentionService, SolvencyMonitoringService, IpfsPinCheckJob, OutboundWebhookService],
  exports: [PrivacyService, SolvencyMonitoringService],
})
export class MaintenanceModule {}
