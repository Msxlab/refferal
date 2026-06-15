import { Body, Controller, Get, Header, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Res } from '@nestjs/common';
import { MembershipStatus, Role } from '@prisma/client';
import { Response } from 'express';
import { z } from 'zod';
import { CurrentUser, RequireMembership, Roles } from '../auth/auth.guard';
import { RequestUser } from '../auth/auth.types';
import { ZodValidationPipe } from '../common/zod.pipe';
import { ActorContext } from '../common/actor';
import { MembersAdminService } from './members.admin.service';

const ADMIN = [Role.tenant_owner, Role.tenant_admin];
const STAFF = [Role.tenant_owner, Role.tenant_admin, Role.tenant_staff];

const listSchema = z.object({
  search: z.string().trim().max(120).optional(),
  status: z.enum(['active', 'inactive']).optional(),
  // varsayilanlar onceki davranisi korur (joinedAt asc)
  sort: z.enum(['joinedAt', 'fullName', 'depth']).default('joinedAt'),
  dir: z.enum(['asc', 'desc']).default('asc'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
const exportSchema = z.object({
  search: z.string().trim().max(120).optional(),
  status: z.enum(['active', 'inactive']).optional(),
});
const bulkSchema = z
  .object({
    action: z.enum(['activate', 'deactivate', 'set_role']),
    ids: z.array(z.string().uuid()).min(1).max(200),
    role: z.enum(['tenant_admin', 'tenant_staff', 'member']).optional(),
    preview: z.boolean().optional(),
  })
  .refine((v) => v.action !== 'set_role' || !!v.role, { message: 'set_role icin rol gerekli', path: ['role'] });
const inviteSchema = z.object({
  sponsorReferralCode: z.string().trim().min(3).max(32).optional(),
  sponsorMembershipId: z.string().uuid().optional(),
  email: z.string().trim().toLowerCase().email().max(254).optional(),
});
const roleSchema = z.object({ role: z.enum(['tenant_admin', 'tenant_staff', 'member']) });
const createManualSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email().max(254),
  sponsorReferralCode: z.string().trim().min(3).max(32).optional(),
  sponsorMembershipId: z.string().uuid().optional(),
  role: z.enum(['tenant_admin', 'tenant_staff', 'member']).optional(),
  tempPassword: z.string().min(10).max(128).optional(),
  // sponsor verilmediginde true ise: yeni KOK takim lideri (agacin tepesinde)
  asLeader: z.boolean().optional(),
});
const treeSchema = z.object({ root: z.string().uuid().optional() });
const leaderSchema = z.object({ isTeamLeader: z.boolean() });
const updateProfileSchema = z.object({
  fullName: z.string().trim().min(2).max(120).optional(),
  email: z.string().trim().toLowerCase().email().max(254).optional(),
}).refine((v) => v.fullName !== undefined || v.email !== undefined, { message: 'en az bir alan gerekli' });

@RequireMembership()
@Controller('admin/members')
export class MembersAdminController {
  constructor(private readonly members: MembersAdminService) {}

  private actor(user: RequestUser): ActorContext {
    return { userId: user.sub, tenantId: user.tid as string };
  }

  @Roles(...STAFF)
  @Get()
  list(@CurrentUser() user: RequestUser, @Query(new ZodValidationPipe(listSchema)) q: z.infer<typeof listSchema>) {
    return this.members.list(user.tid as string, { ...q, status: q.status as MembershipStatus | undefined });
  }

  // DIKKAT: statik GET route'lar (tree, leaders, export.csv) ':id' route'undan ONCE tanimli kalmali.
  @Roles(...STAFF)
  @Get('tree')
  tree(@CurrentUser() user: RequestUser, @Query(new ZodValidationPipe(treeSchema)) q: z.infer<typeof treeSchema>) {
    return this.members.tree(user.tid as string, q.root);
  }

  // takim liderleri landing'i (canli grup ozetleriyle)
  @Roles(...STAFF)
  @Get('leaders')
  leaders(@CurrentUser() user: RequestUser) {
    return this.members.leaders(user.tid as string);
  }

  @Roles(...STAFF)
  @Get('export.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="members.csv"')
  async export(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(exportSchema)) q: z.infer<typeof exportSchema>,
    @Res() res: Response,
  ) {
    const csv = await this.members.exportCsv(user.tid as string, {
      ...q,
      status: q.status as MembershipStatus | undefined,
    });
    res.send(csv);
  }

  // toplu aktive/pasiflestir → admin+ (her uye ayri audit'li, kismi basari)
  @Roles(...ADMIN)
  @HttpCode(200)
  @Post('bulk')
  bulk(@CurrentUser() user: RequestUser, @Body(new ZodValidationPipe(bulkSchema)) body: z.infer<typeof bulkSchema>) {
    return this.members.bulk(this.actor(user), { ...body, role: body.role as Role | undefined });
  }

  // davet/pasiflestir/rol → admin+ (audit'li)
  @Roles(...ADMIN)
  @HttpCode(200)
  @Post('invite')
  invite(@CurrentUser() user: RequestUser, @Body(new ZodValidationPipe(inviteSchema)) body: z.infer<typeof inviteSchema>) {
    return this.members.invite(this.actor(user), user.mid as string, body);
  }

  // manuel uye olustur (davet beklemeden) → admin+ (audit'li). Statik POST, ':id'den ONCE.
  @Roles(...ADMIN)
  @HttpCode(200)
  @Post()
  createManual(@CurrentUser() user: RequestUser, @Body(new ZodValidationPipe(createManualSchema)) body: z.infer<typeof createManualSchema>) {
    return this.members.createManual(this.actor(user), user.mid as string, { ...body, role: body.role as Role | undefined });
  }

  // 360 derece uye detayi (STAFF) — statik GET'lerden SONRA tanimli
  @Roles(...STAFF)
  @Get(':id')
  detail(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.members.detail(user.tid as string, id);
  }

  // GDPR/KVKK DSAR: uyenin tum kisisel verisi (admin)
  @Roles(...ADMIN)
  @Get(':id/export')
  exportData(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.members.exportData(user.tid as string, id);
  }

  // profil duzenle (ad/e-posta) — yerlesime dokunmaz
  @Roles(...ADMIN)
  @Patch(':id')
  updateProfile(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateProfileSchema)) body: z.infer<typeof updateProfileSchema>,
  ) {
    return this.members.updateProfile(this.actor(user), id, body);
  }

  // takim lideri isaretle/kaldir (yerlesimi degistirmez)
  @Roles(...ADMIN)
  @HttpCode(200)
  @Post(':id/leader')
  setLeader(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(leaderSchema)) body: z.infer<typeof leaderSchema>,
  ) {
    return this.members.setLeader(this.actor(user), id, body.isTeamLeader);
  }

  @Roles(...ADMIN)
  @HttpCode(200)
  @Post(':id/deactivate')
  deactivate(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.members.setStatus(this.actor(user), id, MembershipStatus.inactive);
  }

  @Roles(...ADMIN)
  @HttpCode(200)
  @Post(':id/activate')
  activate(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.members.setStatus(this.actor(user), id, MembershipStatus.active);
  }

  @Roles(...ADMIN)
  @HttpCode(200)
  @Post(':id/role')
  setRole(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(roleSchema)) body: z.infer<typeof roleSchema>,
  ) {
    return this.members.setRole(this.actor(user), id, body.role as Role);
  }

  // guvenli impersonation: salt-okunur kisa omurlu token (audit'li)
  @Roles(...ADMIN)
  @HttpCode(200)
  @Post(':id/impersonate')
  impersonate(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.members.impersonate(this.actor(user), id);
  }

  @Roles(...ADMIN)
  @HttpCode(200)
  @Post(':id/impersonate/end')
  impersonateEnd(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.members.impersonateEnd(this.actor(user), id);
  }
}
