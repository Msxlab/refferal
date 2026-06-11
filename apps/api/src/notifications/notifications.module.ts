import { Module } from '@nestjs/common';
import {
  EMAIL_ADAPTER,
  ExpoPushAdapter,
  PUSH_ADAPTER,
  SmtpEmailAdapter,
} from './adapters';
import { NotificationRelayService } from './notification-relay.service';

@Module({
  providers: [
    NotificationRelayService,
    { provide: EMAIL_ADAPTER, useClass: SmtpEmailAdapter },
    { provide: PUSH_ADAPTER, useClass: ExpoPushAdapter },
  ],
  exports: [NotificationRelayService],
})
export class NotificationsModule {}
