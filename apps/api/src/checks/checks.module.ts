import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AdminChecksController } from './checks.controller';
import { ChecksService } from './checks.service';

@Module({
  imports: [PrismaModule],
  controllers: [AdminChecksController],
  providers: [ChecksService],
  exports: [ChecksService],
})
export class ChecksModule {}
