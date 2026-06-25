-- Audit hash-zinciri determinizmi: monoton sira sutunu. Co-transaction kayitlar ayni
-- now() createdAt'i paylasir + id rastgele UUID oldugu icin esit-zaman satirlari Postgres
-- rastgele sirada doner -> sahte "zincir bozuldu". BIGSERIAL kesin, satir-bazinda artan
-- deger verir; seal/verify artik seq'e gore siralar. seq hash icerigine GIRMEZ (mevcut zincir gecerli).

-- AlterTable: monoton sira (mevcut satirlara ekleme sirasinda artan deger atanir)
ALTER TABLE "audit_logs" ADD COLUMN "seq" BIGSERIAL NOT NULL;

-- CreateIndex: tenant-scoped seq sirasi (seal/verify sorgulari)
CREATE INDEX "audit_logs_tenant_id_seq_idx" ON "audit_logs"("tenant_id", "seq");
