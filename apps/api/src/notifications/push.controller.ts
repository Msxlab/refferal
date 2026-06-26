import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser } from '../auth/auth.guard';
import { RequestUser } from '../auth/auth.types';
import { ZodValidationPipe } from '../common/zod.pipe';
import { WebPushService } from './web-push.service';

const subscribeSchema = z.object({
  endpoint: z.string().url().max(2048),
  keys: z.object({
    p256dh: z.string().min(8).max(256),
    auth: z.string().min(8).max(256),
  }),
});
type SubscribeInput = z.infer<typeof subscribeSchema>;

const unsubscribeSchema = z.object({ endpoint: z.string().url().max(2048) });
type UnsubscribeInput = z.infer<typeof unsubscribeSchema>;

/** Tarayici Web Push abonelik yonetimi (oturum acmis kullanici). */
@Controller('me/push')
export class PushController {
  constructor(private readonly webPush: WebPushService) {}

  /** Istemcinin abone olmak icin ihtiyac duydugu VAPID public anahtari (sir degil). */
  @Get('key')
  key() {
    return { publicKey: this.webPush.publicKey };
  }

  @HttpCode(200)
  @Post('subscribe')
  async subscribe(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(subscribeSchema)) body: SubscribeInput,
  ) {
    await this.webPush.subscribe(user.sub, body);
    return { ok: true };
  }

  @HttpCode(200)
  @Post('unsubscribe')
  async unsubscribe(@Body(new ZodValidationPipe(unsubscribeSchema)) body: UnsubscribeInput) {
    await this.webPush.unsubscribe(body.endpoint);
    return { ok: true };
  }
}
