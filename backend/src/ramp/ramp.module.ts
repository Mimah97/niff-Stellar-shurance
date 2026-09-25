import { Module } from '@nestjs/common';
import { RampController } from './ramp.controller';
import { RampService } from './ramp.service';
import { RampStatusPoller } from './ramp-status.poller';
import { RampProviderHealthJob } from './ramp-provider-health.job';
import { RampReconciliationJob } from './ramp-reconciliation.job';
import { FeatureFlagsModule } from '../feature-flags/feature-flags.module';

@Module({
  imports: [FeatureFlagsModule],
  controllers: [RampController],
  providers: [RampService, RampStatusPoller, RampProviderHealthJob, RampReconciliationJob],
  exports: [RampService],
})
export class RampModule {}
