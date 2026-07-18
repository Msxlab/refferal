import { BadRequestException } from '@nestjs/common';
import { promises as dns } from 'node:dns';
import { isIP } from 'node:net';

/**
 * SSRF korumasi: giden webhook URL'lerini guvenli mi diye dogrular.
 * Hem create() aninda (kayit oncesi) hem de dispatch aninda (fetch oncesi) kullanilir;
 * dispatch'te tekrar cagrildigi icin DNS-rebinding / TOCTOU saldirilari da engellenir.
 *
 * Yeni bagimlilik YOK: yalnizca node 'dns' + 'net'.
 */

/** http'ye yalniz self-hosted/dev'de izin (REFEARN_WEBHOOK_ALLOW_HTTP=1). Varsayilan: sadece https. */
function httpAllowed(): boolean {
  return process.env.REFEARN_WEBHOOK_ALLOW_HTTP === '1';
}

/** IPv4 metnini 32-bit sayiya cevir (gecersizse null). */
function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const o = Number(p);
    if (o > 255) return null;
    n = (n << 8) | o;
  }
  return n >>> 0;
}

function inV4Range(ipInt: number, netStr: string, bits: number): boolean {
  const net = ipv4ToInt(netStr);
  if (net === null) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ipInt & mask) === (net & mask);
}

function isPrivateOrReservedV4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  if (n === null) return true; // ayristirilamayan IPv4 = guvensiz say
  return (
    inV4Range(n, '0.0.0.0', 8) || // bu-ag / gecersiz kaynak
    inV4Range(n, '10.0.0.0', 8) || // ozel
    inV4Range(n, '100.64.0.0', 10) || // CGNAT
    inV4Range(n, '127.0.0.0', 8) || // loopback
    inV4Range(n, '169.254.0.0', 16) || // link-local (cloud metadata 169.254.169.254 dahil)
    inV4Range(n, '172.16.0.0', 12) || // ozel
    inV4Range(n, '192.0.0.0', 24) || // IETF protokol tahsisi
    inV4Range(n, '192.0.2.0', 24) || // TEST-NET-1
    inV4Range(n, '192.168.0.0', 16) || // ozel
    inV4Range(n, '198.18.0.0', 15) || // benchmark
    inV4Range(n, '198.51.100.0', 24) || // TEST-NET-2
    inV4Range(n, '203.0.113.0', 24) || // TEST-NET-3
    inV4Range(n, '224.0.0.0', 4) || // multicast
    inV4Range(n, '240.0.0.0', 4) // rezerve / broadcast
  );
}

function isPrivateOrReservedV6(ipRaw: string): boolean {
  const ip = ipRaw.toLowerCase();
  // IPv4-mapped (::ffff:a.b.c.d) ya da IPv4-compatible: gomulu IPv4'u kontrol et.
  const mapped = ip.match(/^(?:::ffff:|::)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mapped) return isPrivateOrReservedV4(mapped[1]);
  if (ip === '::1' || ip === '::') return true; // loopback / belirsiz
  if (ip.startsWith('fe80') || ip.startsWith('fe9') || ip.startsWith('fea') || ip.startsWith('feb')) return true; // fe80::/10 link-local
  if (ip.startsWith('fc') || ip.startsWith('fd')) return true; // fc00::/7 unique-local
  if (ip.startsWith('ff')) return true; // ff00::/8 multicast
  return false;
}

/** Bir IP metni (v4 veya v6) ic/rezerve aralikta mi? */
export function isPrivateOrReservedIp(ip: string): boolean {
  const fam = isIP(ip);
  if (fam === 4) return isPrivateOrReservedV4(ip);
  if (fam === 6) return isPrivateOrReservedV6(ip);
  return true; // IP degil = bu fonksiyon icin guvensiz
}

/**
 * Webhook URL'ini dogrular; guvensizse BadRequestException firlatir.
 * - Sema: https (veya REFEARN_WEBHOOK_ALLOW_HTTP=1 ile http)
 * - Gomulu kimlik bilgisi (user:pass@) yasak
 * - Literal IP host: dogrudan kontrol
 * - Ad host: tum A/AAAA kayitlari cozulur; herhangi biri ic/rezerve ise reddedilir
 */
export async function assertSafeWebhookUrl(rawUrl: string): Promise<void> {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new BadRequestException('Gecersiz webhook URL');
  }

  const scheme = u.protocol;
  if (scheme !== 'https:' && !(scheme === 'http:' && httpAllowed())) {
    throw new BadRequestException('Webhook URL https olmali');
  }
  if (u.username || u.password) {
    throw new BadRequestException('Webhook URL kimlik bilgisi icermemeli');
  }

  // URL host'undaki kose parantezleri (IPv6) ayikla.
  const host = u.hostname.replace(/^\[/, '').replace(/\]$/, '');
  if (!host) throw new BadRequestException('Gecersiz webhook URL');

  // Literal IP ise dogrudan kontrol et (DNS yok).
  if (isIP(host) !== 0) {
    if (isPrivateOrReservedIp(host)) {
      throw new BadRequestException('Webhook URL dahili/rezerve adrese isaret edemez');
    }
    return;
  }

  // Ad host: tum cozumlenen adresleri kontrol et.
  let resolved: { address: string }[];
  try {
    resolved = await dns.lookup(host, { all: true });
  } catch {
    throw new BadRequestException('Webhook URL ana bilgisayar adi cozumlenemedi');
  }
  if (resolved.length === 0) {
    throw new BadRequestException('Webhook URL ana bilgisayar adi cozumlenemedi');
  }
  for (const r of resolved) {
    if (isPrivateOrReservedIp(r.address)) {
      throw new BadRequestException('Webhook URL dahili/rezerve adrese isaret edemez');
    }
  }
}
