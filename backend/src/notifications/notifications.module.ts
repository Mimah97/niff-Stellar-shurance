import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { NotificationsConsumer } from './notifications.consumer';
import {
  InMemoryNotificationPreferencesRepository,
  NOTIFICATION_PREFERENCES_REPOSITORY,
} from './notification-preferences.repository';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    NotificationsConsumer,
    {
      provide: NOTIFICATION_PREFERENCES_REPOSITORY,
      useClass: InMemoryNotificationPreferencesRepository,
    },
  ],
  exports: [NotificationsService, NotificationsConsumer],
})
export class NotificationsModule {}
