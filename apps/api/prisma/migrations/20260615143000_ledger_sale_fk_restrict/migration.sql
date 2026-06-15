-- Ledger sale_id FK: ON DELETE SET NULL -> RESTRICT.
-- SET NULL, silme aninda sale_id'yi NULL'a cekerek bir UPDATE tetikler; ancak
-- guard_ledger_update trigger'i (bkz. 20260610214900_guards) sale_id degisimini
-- yasaklar — bu yuzden ledger satiri olan bir satisin silinmesi trigger hatasiyla
-- patlardi. Gercek: ledger satiri olan satis silinmez (duzeltme = void/ters kayit),
-- dolayisiyla RESTRICT dogru semantik. saleId NULL satirlar (kampanya bonusu vb.)
-- bu kisittan etkilenmez. (FINDING ledger-fk-immutability; init migration zaten RESTRICT'ti,
-- campaigns migration SET NULL'a regrese etmisti — bu onu geri alir.)

-- DropForeignKey
ALTER TABLE "ledger_entries" DROP CONSTRAINT "ledger_entries_sale_id_fkey";

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_sale_id_fkey"
  FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
