import { Module } from '@nestjs/common';
import { AdminAnnouncementsController, AppAnnouncementsController } from './announcements.controller';
import { AnnouncementsService } from './announcements.service';

@Module({
  controllers: [AdminAnnouncementsController, AppAnnouncementsController],
  providers: [AnnouncementsService],
})
export class AnnouncementsModule {}
