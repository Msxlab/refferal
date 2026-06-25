# Row-Level Security (RLS) — Şirketler-arası İkinci Veri Kilidi (Faz D7)

> **Durum: TASARIM + güvenli rollout planı (henüz AÇIK DEĞİL).** Uygulama katmanı tenant izolasyonu
> zaten her sorguda `tenant_id` ile zorlanıyor ve 50-ajan denetiminden geçti. RLS bunun **üstüne**
> ikinci, DB-zorlamalı savunma katmanıdır (bir uygulama bug'ı ya da sızmış kimlik bilgisi tek bir
> tenant'ın verisini diğerine sızdıramasın). **Körlemesine açılMAZ** — yanlış kurulursa tüm
> tenant-kapsamlı sorgular 0 satır döner ve ürün kırılır. Aşağıdaki sıra bunu güvenli kılar.

## Tasarım
1. **GUC (oturum değişkeni):** her DB bağlantısı/işlemi başında aktörün tenant'ı set edilir:
   `SET LOCAL app.current_tenant_id = '<uuid>'`.
2. **Politika:** tenant-kapsamlı her tabloda
   `CREATE POLICY tenant_isolation ON <table> USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);`
   + `ALTER TABLE <table> ENABLE ROW LEVEL SECURITY; ALTER TABLE <table> FORCE ROW LEVEL SECURITY;`
   (FORCE → tablo sahibi bile politikaya tabi; aksi halde owner bypass eder.)
3. **Prisma context-setter:** bir `$extends` (query extension) ya da interaktif transaction sarmalayıcısı,
   her sorgudan ÖNCE GUC'u aktörün `tid`'inden set eder. (Express middleware + AsyncLocalStorage ile
   aktör tid'i taşınır.)
4. **Çapraz-tenant istisnalar:** platform-admin (kiracı-üstü) + engine/scheduler gece işleri TÜM
   tenant'lara dokunur. Bunlar için: ya `BYPASSRLS` yetkili ayrı bir DB rolü, ya da GUC'u boş bırakıp
   politikayı `current_setting(...,true) IS NULL OR tenant_id = ...` şeklinde "context yoksa kısıtlama yok"
   yapmak (DİKKAT: ikincisi, context set etmeyi unutan normal istek için sızıntı riskidir — BYPASSRLS rolü daha güvenli).

## Güvenli rollout (sırayla)
1. **Migration (inert):** politikaları + ENABLE ekle ama **FORCE ETME**, app **owner** rolüyle bağlanmaya
   devam etsin → RLS pratikte inert (owner bypass). Üretim etkilenmez.
2. **Context-setter'ı ekle + staging'de doğrula:** Prisma extension GUC'u set etsin. Staging DB'de
   app'i **owner-olmayan** role çek + **FORCE RLS** aç.
3. **Tam test:** staging'de **bütün int-spec suite'i RLS-açık koştur.** 0 satır dönen/kırılan her sorgu
   yolu = context set edilmeyen bir yer → düzelt. (En kritik kapı budur; her yol GUC görmeli.)
4. **Çapraz-tenant yolları:** platform + scheduler + engine'i BYPASSRLS rolüne/yoluna bağla; bunları da test et.
5. **Prod:** app'i owner-olmayan role çek, FORCE RLS aç, izle (boş-sonuç anomalisi = context kaybı).

## Neden şimdi açmadım
RLS, her sorgu yolunun doğru GUC'u görmesine bağlıdır; tek bir kaçırılan yol sessizce 0 satır döndürür.
Bunu marathon sonunda açmak yerine, yukarıdaki staging-doğrulamalı sırayla, tam test koşarak yapmak gerekir.
Uygulama-katmanı izolasyonu zaten denetlendiği için bu **ikinci katman** acil değil — ama doğru yapılmalı.
