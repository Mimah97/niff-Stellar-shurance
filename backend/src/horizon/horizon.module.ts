import { Module } from "@nestjs/common";
import { HorizonController } from "./horizon.controller";
import { HorizonService } from "./horizon.service";
import { CacheModule } from "../cache/cache.module";
import { PrismaModule } from "../prisma/prisma.module";

@Module({
  imports: [CacheModule, PrismaModule],
  controllers: [HorizonController],
  providers: [HorizonService],
})
export class HorizonModule {}
