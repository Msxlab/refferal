import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { PlatformAdmin } from '../auth/auth.guard';
import { PlatformService } from './platform.service';

/** /platform — kiracci-ustu yuzey. @RequireMembership YOK (platform admin uyelik tasimaz). */
@PlatformAdmin()
@Controller('platform')
export class PlatformController {
  constructor(private readonly platform: PlatformService) {}

  @Get('companies')
  companies() {
    return this.platform.companies();
  }

  @Get('companies/:id')
  company(@Param('id', ParseUUIDPipe) id: string) {
    return this.platform.company(id);
  }

  @Get('companies/:id/network')
  network(@Param('id', ParseUUIDPipe) id: string) {
    return this.platform.network(id);
  }
}
