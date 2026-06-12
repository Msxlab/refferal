import { Module } from '@nestjs/common';
import {
  EMAIL_ADAPTER,
  ExpoPushAdapter,
  PUSH_ADAPTER,
  createEmailAdapter,
} from './adapters';
import { NotificationRelayService } from './notification-relay.service';

@Module({
  providers: [
    NotificationRelayService,
    { provide: EMAIL_ADAPTER, useFactory: createEmailAdapter },
    { provide: PUSH_ADAPTER, useClass: ExpoPushAdapter },
  ],
  exports: [NotificationRelayService],
})
export class NotificationsModule {}
