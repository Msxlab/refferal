import { Module } from '@nestjs/common';
import {
  EMAIL_ADAPTER,
  ExpoPushAdapter,
  PUSH_ADAPTER,
  createEmailAdapter,
} from './adapters';
import { NotificationRelayService } from './notification-relay.service';
import { WebPushService } from './web-push.service';
import { PushController } from './push.controller';

@Module({
  controllers: [PushController],
  providers: [
    NotificationRelayService,
    WebPushService,
    { provide: EMAIL_ADAPTER, useFactory: createEmailAdapter },
    { provide: PUSH_ADAPTER, useClass: ExpoPushAdapter },
  ],
  exports: [NotificationRelayService, WebPushService],
})
export class NotificationsModule {}
