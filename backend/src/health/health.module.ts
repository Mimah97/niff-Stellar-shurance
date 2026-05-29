import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { RpcModule } from '../rpc/rpc.module';
import { HealthController } from './health.controller';
import { PrismaHealthIndicator } from './prisma.health';
import { RedisHealthIndicator } from './redis.health';
import { SorobanRpcHealthIndicator } from './soroban-rpc.health';

@Module({
  imports: [TerminusModule, RpcModule],
  controllers: [HealthController],
  providers: [PrismaHealthIndicator, RedisHealthIndicator, SorobanRpcHealthIndicator],
})
export class HealthModule {}

