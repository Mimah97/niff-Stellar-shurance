import { Module } from '@nestjs/common';
import { ClaimsController } from './claims.controller';
import { ClaimsService } from './claims.service';
import { SanitizationService } from './sanitization.service';
import { ClaimViewMapper } from './claim-view.mapper';
import { ClaimAggregationService } from './services/claim-aggregation.service';
import { EvidenceUploadService } from './services/evidence-upload.service';
import { ClaimDeadlineProcessorService } from './claim-deadline.processor.service';
import { ClaimDeadlineBootstrap } from './claim-deadline.bootstrap';
import { RpcModule } from '../rpc/rpc.module';
import { RateLimitModule } from '../rate-limit/rate-limit.module';
import { TenantModule } from '../tenant/tenant.module';
import { IndexerModule } from '../indexer/indexer.module';
import { CacheModule } from '../cache/cache.module';
import { PrismaModule } from '../prisma/prisma.module';
import { IpfsModule } from '../ipfs/ipfs.module';
import { AdminModule } from '../admin/admin.module';

@Module({
  imports: [PrismaModule, RpcModule, RateLimitModule, TenantModule, IndexerModule, CacheModule, IpfsModule, AdminModule],
  controllers: [ClaimsController],
  providers: [
    ClaimsService,
    SanitizationService,
    ClaimViewMapper,
    ClaimAggregationService,
    EvidenceUploadService,
    ClaimDeadlineProcessorService,
    ClaimDeadlineBootstrap,
  ],
  exports: [ClaimsService, ClaimViewMapper, ClaimAggregationService, ClaimDeadlineProcessorService],
})
export class ClaimsModule {}
