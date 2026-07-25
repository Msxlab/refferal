# Project Knowledge Vault — Uygulama Planı

**Tarih:** 2026-07-22
**Durum:** Kullanıcı plan incelemesi bekliyor
**Kaynak tasarım:** `docs/superpowers/specs/2026-07-22-project-knowledge-vault-design.md`
**Aktif branch:** `codex/earnica-referral-value-flow`

## Genel bakış

Bu plan, Referral/Earnica deposunda Git-sürümlü, Obsidian-okunabilir bir proje
hafızası kurar. Yeni vault; kararları ADR'lerde, çalışma günlüğünü journal'da,
release kanıtını verification altında, riskleri ayrı kayıt altında ve görsel
referansları karar/asset/QA durumları ayrışmış biçimde tutar.

Bu plan payout veya tree ürün davranışını değiştirmez. Aktif payout dispatch
checkpoint test/release işi, vault'un kurulmasından sonra `CONTINUE-HERE.md`
tarafından tanımlanan ayrı doğrulama kapılarından devam eder.

## Plan konumu ve koruma kuralı

`tasks/plan.md` ve `tasks/todo.md` Git'te takip edilen eski P0 ledger'lardır ve
başka bir kapsamı taşırlar. Onları ezmemek için bu plan, depo yerleşik
konvansiyonu olan `docs/superpowers/plans/` altında tutulur. Bu planın checklist'i
tek başına takip kaynağıdır.

## Mimari kararlar

- Obsidian vault kökü repo köküdür; `docs/knowledge/` zorunlu yönetim alanıdır.
- `.obsidian/` kişisel çalışma alanı durumudur ve Git'e girmez.
- `AGENTS.md → START-HERE.md → CONTINUE-HERE.md → git status` sırası,
  `CONTINUE-HERE.md` dosyasının tam okunması zorunluluğunu korur.
- Güvenlik/operasyon sınırları, ürün/tasarım kararı ve runtime kanıtı tek bir
  öncelik listesi olarak değil, ayrı authoritative eksenler olarak ele alınır.
- Git dışındaki render dosyaları önce hash/provenance/onay/retention kaydıyla
  indekslenir. Açık kararı olmadan binary asset kopyalanmaz veya “approved”
  işaretlenmez.
- Doküman yapısı küçük, bağımsız bir Node kontrolüyle doğrulanır; kontrol gerçek
  production/test başarısının yerine geçmez.

## Bağımlılık grafiği

```text
Task 1: Güvenli giriş noktası
    │
    └── Task 2: Durum, registry, risk ve verification temeli
          │
          └── Task 3: ADR/journal başlangıç kayıtları
                │
                └── Task 4: Visual reference ve local-render ingestion
                      │
                      └── Task 5: Doküman doğrulama komutu
                            │
                            └── Task 6: Reconciliation ve aktif handoff
                                  │
                                  └── Task 7: Bağımsız inceleme ve teslim
```

Araştırma için kaynak envanteri paralel okunabilir; ancak Task 2-7 yazımı,
karşılıklı link ve declared dependency'ler nedeniyle sıralı yapılacaktır.

## Task listesi

### Task 1: Clone-safe giriş ve yerel Obsidian sınırı

**Açıklama:** Yeni bir çalışan veya Codex, root `AGENTS.md` üzerinden önce vault
oryantasyonuna, sonra değişiklik öncesi zorunlu handoff ve çalışma ağacı kontrolüne
ulaşmalıdır. Obsidian'ın kişisel UI durumunun commit edilmesi engellenmelidir.

**Dosyalar:**

- Modify: `AGENTS.md`
- Modify: `.gitignore`
- Create: `docs/knowledge/START-HERE.md`

**Kabul kriterleri:**

- [x] `AGENTS.md`, ilk oryantasyon adımı olarak `docs/knowledge/START-HERE.md`'yi
      gösterir; `CONTINUE-HERE.md` tam okuma ve `git status --short` kuralını
      zayıflatmaz.
- [x] `START-HERE.md`, sıralı okuma akışını, secret/PII yasağını, maddi karar
      yazım protokolünü ve handoff güncelleme yükümlülüğünü tanımlar.
- [x] `.obsidian/` local-only olarak ignore edilir; mevcut Git-tracked dosyalar
      etkilenmez.

**Doğrulama:**

- [x] `rg` ile `AGENTS.md` ve `START-HERE.md` içindeki okuma sırası doğrulanır.
- [x] `git check-ignore -v .obsidian/workspace.json` local-state kuralını
      gösterir.
- [x] Fresh-clone senaryosu manuel olarak okunur: `AGENTS → START-HERE →
      CONTINUE-HERE → git status`.

**Bağımlılıklar:** Yok

**Tahmini kapsam:** S (3 dosya)

### Task 2: Güncel durum, kaynak registry'si, risk ve release kanıtı

**Açıklama:** Yeni vault'un yönlendirme katmanı, mevcut release durumunu
doğrulanmamış iddia üretmeden gösterir ve eski/yeni belgelerin rolünü açıklar.

**Dosyalar:**

- Create: `docs/knowledge/CURRENT-STATE.md`
- Create: `docs/knowledge/registry.md`
- Create: `docs/knowledge/risks-and-open-items.md`
- Create: `docs/knowledge/verification/current-release.md`

**Kabul kriterleri:**

- [ ] `CURRENT-STATE.md`, branch/PR, çalışma fazı, production doğrulama durumu
      ve sonraki güvenli aksiyona yalnız authoritative bağlantılarla yönlendirir.
- [ ] Registry, `AGENTS.md`, `CONTINUE-HERE.md`, `docs/DECISIONS.md`, önemli
      design/spec/plan/audit kaynaklarını `canonical`, `active`, `historical`,
      `superseded` veya `needs-reconciliation` statüsüyle listeler.
- [ ] Risk ve verification kayıtları payout test matrisi ve SSH blokajını
      `not-run`/`blocked` olarak doğru yazar; geçmiş başarılı testleri güncel
      full-pass gibi göstermez.

**Doğrulama:**

- [ ] Her registry yolu repo içinde çözülür.
- [ ] `CONTINUE-HERE.md` ile status karşılaştırması yapılır; yeni dokümanlar
      production'ın doğrulanmadığını korur.
- [ ] Bir reviewer, registry'deki bilinen hierarchy/payout/KYC/AI-folder drift
      maddelerini ve statülerini okuyabilir.

**Bağımlılıklar:** Task 1

**Tahmini kapsam:** M (4 dosya)

### Task 3: Karar ve journal başlangıç seti

**Açıklama:** Mevcut kalıcı kararları topluca yeniden yazmadan, yeni ADR protokolü
ve kullanıcı tarafından onaylanan yüksek etkili kararların bağlantılı başlangıç
kayıtları oluşturulur.

**Dosyalar:**

- Create: `docs/knowledge/decisions/README.md`
- Create: `docs/knowledge/decisions/ADR-20260722-project-knowledge-vault.md`
- Create: `docs/knowledge/decisions/ADR-20260720-member-network-privacy.md`
- Create: `docs/knowledge/decisions/ADR-20260721-payout-dispatch-checkpoint.md`
- Create: `docs/knowledge/journal/2026-07.md`

**Kabul kriterleri:**

- [ ] README, ADR şablonunu, maddi karar tanımını, supersession kuralını ve
      legacy `docs/DECISIONS.md` ile ilişkiyi açıklar. Referral value-flow ve
      Earnica operations workspace için canonical legacy-decision mapping'lerini;
      karar, implementation ve QA kaynakları ayrılmış biçimde visual index'e bağlar.
- [ ] Vault ADR'si repo-as-vault seçimini, alternatiflerini, local Obsidian
      durumunu, retention kuralını ve doğrulama sınırını kaydeder.
- [ ] Tree privacy ve payout dispatch ADR'leri yalnız taze kaynakla doğrulanan
      kararları taşır; implementation/test durumlarını ayrı gösterir. Temmuz
      journal'ı bu tasarım/plan onaylarını, kaynak incelemesini ve aktif release
      blocker'larını kronolojik, güvenli ve bağlantılı biçimde kaydeder.

**Doğrulama:**

- [ ] Her ADR zorunlu metadata, bağlam, karar, alternatif, sonuç ve kaynak
      bağlantılarını içerir.
- [ ] Bir ADR'deki “accepted design” ile “verified implementation” alanları
      birbirine karıştırılmaz.
- [ ] Markdown linkleri ve kaynak yolları manuel kontrol edilir.

**Bağımlılıklar:** Task 1, Task 2

**Tahmini kapsam:** M (5 dosya)

### Checkpoint: Vault semantic foundation

- [ ] Clone-safe okuma sırası bozulmadan çalışır.
- [ ] Karar, risk, kanıt ve günlük sorumlulukları farklı dosyalardadır.
- [ ] Aktif release durumu hiçbir yerde doğrulanmamış biçimde “live” veya
      “complete” diye yazılmaz.
- [ ] İnsan incelemesi, eski `tasks/` ledger'ının değiştirilmediğini doğrular.

### Task 4: Onaylı tasarım ve render envanteri

**Açıklama:** Mevcut Git-tracked visual asset'ler ile yerel geçmiş render
candidate'leri tek bir görsel karar indeksinde ayrıştırılır. Amaç her görselin
onayının, kökeninin ve gerçek uygulama/QA durumunun görünür olmasıdır.

**Dosyalar:**

- Create: `docs/knowledge/visual-references.md`
- Create: `docs/knowledge/visual-ingestion-manifest.md`
- Modify: `docs/knowledge/registry.md`
- Modify: `docs/knowledge/journal/2026-07.md`

**Kabul kriterleri:**

- [ ] Git-tracked operations workspace, admin Focus Cockpit ve member Focus Tree
      asset'leri spec/plan kaynaklarıyla birlikte listelenir; her görsel kaydında
      karar/onay, asset provenance, implementation, QA ve supersede/retention
      alanları ayrı bulunur.
- [ ] Visual ingestion manifest tam 16 candidate içerir: 2026-07-18'den 8,
      2026-07-20'den 6 Americana render ve 2026-07-21'den 2 screenshot. Her
      kayıt SHA-256, session, yüzey, approval-evidence, availability ve Git'e
      alma/reddetme kararı taşır; bulunamayan dosya `unavailable` olur ve hash
      uydurulmaz.
- [ ] Visual index manifest count, discovered count ve hash'leri reconcile eder.
      Onay kanıtı olmayan local render “approved” işaretlenmez; bu task binary
      asset'i repo içine kopyalamaz.

**Doğrulama:**

- [ ] Git-tracked asset'lerin yolları ve local candidate SHA-256 değerleri
      yeniden hesaplanır.
- [ ] Referans kaynağı olan design/spec/plan dosyaları okunabilir bağlantı verir.
- [ ] Visual index, kullanıcı kararını implementation veya visual QA sonucu gibi
      göstermediği için bağımsız olarak gözden geçirilir.

**Bağımlılıklar:** Task 2, Task 3

**Tahmini kapsam:** S (3 dosya)

### Task 5: Hafif dokümantasyon doğrulama komutu

**Açıklama:** Yeni Markdown yapısının bozulmasını erken yakalayan, Node yerleşik
modülleriyle çalışan ve secret değerlerini ekrana dökmeyen bir kontrol eklenir.

**Dosyalar:**

- Create: `scripts/check-knowledge-docs.mjs`
- Create: `scripts/check-knowledge-docs.test.mjs`
- Modify: `package.json`

**Kabul kriterleri:**

- [ ] `docs:check` zorunlu vault dosyalarının varlığını, START-HERE linklerini,
      ADR metadata'sını ve registry durum etiketlerini doğrular.
- [ ] Kontrol, sınırlı secret/connection-string biçimlerini redakte edilmiş
      hata mesajıyla reddeder. Tarama yalnız `docs/knowledge/**/*.md`, `AGENTS.md`
      ve `CONTINUE-HERE.md` ile sınırlıdır; `.env` okumaz. Minimum kurallar
      `password`, `secret`, `token`, `privateKey`, `hmackey`, `encryptionkey`,
      `dsn`, `databaseurl`, `redisurl` ve `auditHmacKeyBase64` gibi açık
      assignment alanlarını; ayrıca tam `postgres://`, `postgresql://`,
      `redis://`, `rediss://` URL'lerini kapsar. Genel `key` eşleşmesi kullanılmaz
      ve hiçbir matched değer yazdırılmaz.
- [ ] Fixture tabanlı Node testleri geçerli vault'u kabul eder; eksik dosya,
      yanlış ADR başlığı, geçersiz registry statüsü ve unsafe string örneğini
      reddeder. Testler hata çıktısında yalnız path/rule label bulunduğunu,
      eşleşen secret değerinin bulunmadığını doğrular; komut gerçek
      test/build/deploy sonucunu kanıtladığını iddia etmez.

**Doğrulama:**

- [ ] Bundled Node ile `node --test scripts/check-knowledge-docs.test.mjs`.
- [ ] `pnpm docs:check` veya aynı komutun bundled Node eşdeğeri.
- [ ] Negatif fixture'lar hata verirken değer sızdırmadığı gözden geçirilir.

**Bağımlılıklar:** Task 1, Task 2, Task 3, Task 4

**Tahmini kapsam:** S (3 dosya)

### Task 6: Reconciliation, handoff ve çalışma protokolü entegrasyonu

**Açıklama:** Bilinen eski doküman çelişkileri registry'de action sahibi olur;
aktif handoff yeni vault'un varlığını ve gerçek release durumunu yalın şekilde
gösterir. Eski kaynaklar topluca yeniden yazılmaz.

**Dosyalar:**

- Modify: `docs/knowledge/registry.md`
- Modify: `docs/knowledge/risks-and-open-items.md`
- Modify: `docs/knowledge/verification/current-release.md`
- Modify: `docs/knowledge/journal/2026-07.md`
- Modify: `CONTINUE-HERE.md`

**Kabul kriterleri:**

- [ ] Hierarchy-spec drift, payout authority matrix drift, KYC/OFAC scope drift
      ve kayıp `AI/` referansı ayrı reconciliation maddeleri olur.
- [ ] Her maddede authoritative kaynak, sahip/sonraki aksiyon ve `not verified`
      veya uygun güncellik statüsü bulunur.
- [ ] `CONTINUE-HERE.md`, vault okuma yolunu kaydeder ancak payout test/deploy
      gerçeklerini veya güvenlik sınırlarını zayıflatmaz.
      Journal, bu migration'ın tamamlandığı anı ve açık release işine güvenli
      dönüş noktasını kaydeder.

**Doğrulama:**

- [ ] Registry ve handoff birbirine ters branch/deployment/test durumu söylemez.
- [ ] `rg` ile eski `AI/` referanslarının durumu registry'de görünür olur.
- [ ] Bir devam oturumu yalnız `AGENTS`, `START-HERE`, `CONTINUE-HERE` ve
      `CURRENT-STATE` okuyarak doğru sonraki adımı belirleyebilir.

**Bağımlılıklar:** Task 2, Task 3, Task 4, Task 5

**Tahmini kapsam:** M (5 dosya)

### Checkpoint: Operationally usable vault

- [ ] `docs:check` ve Node fixture testleri geçer.
- [ ] Visual index ile registry arasında kırık kaynak yoktur.
- [ ] Her release iddiası ilgili verification satırına bağlıdır.
- [ ] Handoff yeni başlangıç noktasını tanır fakat mevcut güvenlik sınırlarını
      aynen korur.

### Task 7: Bağımsız kalite incelemesi, teslim ve release'e dönüş

**Açıklama:** Vault değişiklikleri bağımsız gözle gözden geçirilir, doğrulama
kanıtları kaydedilir ve yalnız kapsam içi dosyalar commit/push edilir. Bundan
sonra aktif payout dispatch test matrisi ayrı bir uygulama döngüsünde ele alınır.

**Dosyalar:**

- Modify: yalnız inceleme/doğrulama bulgusu gerçekten gerektirirse ilgili vault
  dosyaları
- Update: `docs/knowledge/verification/current-release.md`,
  `docs/knowledge/journal/2026-07.md`, `CONTINUE-HERE.md`

**Kabul kriterleri:**

- [ ] Bağımsız inceleme source authority, secret redaction, link bütünlüğü,
      render status ayrımı ve handoff güvenliği açısından yüksek/orta bulgu
      bırakmaz.
- [ ] `docs:check`, Node testleri, `git diff --check`, staging öncesi
      `git diff --exit-code -- tasks/plan.md tasks/todo.md` ve scope incelemesi
      taze kanıtla kayıtlıdır; çalışma ağacında yalnız planlanan docs/script
      değişiklikleri bulunur ve legacy ledger'ın değişmediği mekanik olarak
      kanıtlanır.
- [ ] `CONTINUE-HERE.md`, sıradaki işi payout dispatch checkpoint test matrisi
      olarak açıkça bırakır; production deploy'un valid SSH erişimi olmadan
      doğrulanmadığını korur.

**Doğrulama:**

- [ ] `pnpm docs:check` veya bundled Node eşdeğeri.
- [ ] `node --test scripts/check-knowledge-docs.test.mjs`.
- [ ] `git diff --check`, `git status --short`, `git log -1 --oneline`.
- [ ] İnsan/Codex bağımsız review özeti journal ve verification kaydına bağlanır.

**Bağımlılıklar:** Task 6

**Tahmini kapsam:** S-M (bulguya bağlı)

## Riskler ve azaltımlar

| Risk | Etki | Azaltım |
| --- | --- | --- |
| Eski belgeler farklı durum iddia ediyor | Yüksek | Sessiz rewrite yerine registry/reconciliation ve evidence bağlantıları |
| Render dosyaları kişisel local path'te kalıyor | Orta | Tek tek hash/provenance/retention kaydı; Git'e alma için açık karar |
| Journal büyüyüp ikinci `DECISIONS.md` olur | Orta | Maddi karar ADR'ye, rutin ilerleme journal'a; START-HERE kuralı |
| Doküman checker gerçek güvenlik/deploy garantisi sanılır | Yüksek | Komut açıklaması ve verification kaydında sınırları açıkça yazmak |
| Yeni başlangıç belgesi active handoff'u atlatır | Yüksek | AGENTS ve START-HERE'da tam CONTINUE + status zorunluluğu |
| Payout release çalışması docs işi yüzünden gölgelenir | Yüksek | Vault tesliminden sonra CONTINUE'daki test matrisi ayrı faz olarak kalır |

## Açık sorular

- Local-session candidate render'larından hangileri kullanıcı tarafından Git'e
  alınacak kalıcı reference asset'lerdir? İlk implementation yalnız metadata
  kaydeder; binary import için açık seçim gerekir.
- Obsidian'da kişisel eklenti/tema tercihleri local kalacaktır. Takım çapında
  paylaşılacak bir vault ayarı gerekirse bu ayrı, açık bir ADR ile ele alınır.

## Uygulamaya başlama kapısı

Uygulama ancak kullanıcı bu planı yazılı olarak onayladıktan sonra başlar.
Her task sonunda ilgili acceptance/verification satırları güncellenir; test veya
inceleme başarısız olursa `systematic-debugging` ile kök neden bulunmadan sonraki
task'a geçilmez.
