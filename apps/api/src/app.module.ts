import { Module } from '@nestjs/common';
import { EngineModule } from './engine/engine.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [PrismaModule, EngineModule],
})
export class AppModule {}
