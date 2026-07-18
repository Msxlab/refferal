/**
 * Tek noktadan CSV hucre temizleme (RFC4180 + formul enjeksiyonu korumasi).
 *
 * Admin CSV export'larini (uye/satis/payout/1099/audit) Excel, Google Sheets veya
 * LibreOffice acabilir. Bir hucre = + - @ TAB veya CR ile basliyorsa bu uygulamalar
 * onu FORMUL olarak yorumlar (orn. =HYPERLINK, =cmd|...). Uye kontrollu alanlar
 * (fullName, customerRef, externalRef, legalName, email, referralCode) dogrudan
 * CSV'ye aktigi icin bu bir enjeksiyon yuzeyidir.
 *
 * Strateji: once tehlikeli bir on-karakter varsa basa tek tirnak (') ekleyerek
 * formulu notrlestir; sonra RFC4180 alintilamasi uygula (virgul/tirnak/yeni satir/CR).
 *
 * TUM kullanici turevli alanlar bu fonksiyondan gecmelidir. Statik basliklar ve
 * tamamen makine uretimi degerler (UUID, ISO tarih, sayisal cent, enum status) icin
 * de cagrilmasi zararsizdir (benign deger degismeden doner). Sayisal/negatif tutar
 * metinlerini (orn. "-12.50") gecirmeyin: bastaki '-' on-tirnak ekler.
 */

/** Formul enjeksiyonunu tetikleyen on-karakterler: = + - @ TAB(\t) CR(\r). */
const DANGEROUS_LEAD = /^[=+\-@\t\r]/;

/** RFC4180: virgul, cift tirnak, satir besleme veya satir basi varsa alintilanmali. */
const NEEDS_QUOTING = /[",\r\n]/;

/**
 * Tek bir CSV hucresini guvenli sekilde uretir.
 * 1) Tehlikeli on-karakter varsa basa tek tirnak ekle (formul notrlestirme).
 * 2) Gerekirse cift tirnakla sarip icteki tirnaklari iki tirnakla kacisla (RFC4180).
 */
export function csvCell(value: string): string {
  let v = value;
  if (DANGEROUS_LEAD.test(v)) {
    v = `'${v}`;
  }
  if (NEEDS_QUOTING.test(v)) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}
