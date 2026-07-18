-- Acik payout dedup'unu DB seviyesinde zorla (TOCTOU yarisina karsi).
-- requestPayout app-level findFirst+create yapiyor; iki eszamanli talep ikisi de
-- "acik talep yok" gorup cift kayit acabiliyor. Bu kismi unique index uye basina
-- en fazla bir ACIK (requested|processing) payout'a izin verir. Prisma kismi unique'i
-- ifade edemedigi icin ham SQL; schema.prisma'da sadece yorumla belgelendi.
-- NOT: Iki+ acik payout zaten varsa bu index olusmaz; once mevcut cift kayitlari
-- temizleyin (en eskisini birakip digerlerini iptal/birlestirin).
CREATE UNIQUE INDEX "payouts_one_open_per_member"
  ON "payouts" ("tenant_id", "membership_id")
  WHERE "status" IN ('requested', 'processing');
