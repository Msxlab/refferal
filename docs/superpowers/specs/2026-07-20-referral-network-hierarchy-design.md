# Referral Network Hierarchy — Tasarım Spesifikasyonu

**Tarih:** 2026-07-20
**Durum:** Yazılı kullanıcı incelemesi bekliyor
**Uygulama:** Başlatılmadı
**Seçilen görsel yön:** Focus Cockpit
**Ana karar:** Admin tam ağı ve herhangi bir üyeyi tam kimlikle inceleyebilir; üye yalnızca tek sponsorunu, isimli Tier 1 direktlerini ve anonim Tier 2–3 alt ağını görür.

## 1. Yönetici özeti

Mevcut `/admin/tree` ekranı finansal değer akışını açıklıyor ancak gerçek kişi hiyerarşisini göstermiyor. Mevcut `/app/team` ekranı ise seviyeleri toplulaştırıyor; kullanıcının kendisini, sponsorunu ve altındaki ilişkileri görünür bir ağaçta sunmuyor. Eski `NetworkExplorer` odaklama ve breadcrumb temellerini taşısa da güncel tasarım sistemi, büyük ağ davranışı, erişilebilirlik ve veri gizliliği açısından üretim seviyesinde değil.

Yeni deneyim iki kardeş yüzeyden oluşacaktır:

1. **Admin Network Hierarchy:** Tam kimlikli genel ağ, kişi arama, seçili kişiyi yerel Tier 1 yapma, ancestor zinciri, alt ağ ve izin kontrollü performans detayları.
2. **Member My Network:** Tek sponsor bağlamı, merkezde kullanıcının kendisi, isimli direkt üyeler ve Tier 2–3 için anonim baş harf + güvenli performans özeti.

Finansal `Value flow` kaldırılmayacaktır. Admin ağ ekranında ikincil bir görünüm/lens olarak korunacak; varsayılan ve ana model kişi hiyerarşisi olacaktır.

## 2. Bağlayıcı ürün kararları

### 2.1 Admin

- Admin varsayılan olarak gerçek kişi hiyerarşisini açar.
- `Full network` genel şirket ağını kökten ve bütün dalları erişilebilir biçimde gösterir.
- Bir üyeye tıklamak yalnızca üyeyi seçer ve inspector'ı açar; ağ kendiliğinden yeniden köklenmez.
- `Focus as Tier 1` seçili üyeyi görünür çalışma alanının en üstüne taşır.
- Seçili kişinin gerçek/absolute tier bilgisi inspector'da korunur; `Local Tier 1` yalnızca görsel çalışma alanı konumudur.
- Seçili kişinin şirket köküne kadar bütün ancestor zinciri breadcrumb/lineage strip olarak görünür.
- Admin yetkisi varsa bütün üyelerin tam adı, referral kodu, durumu, rank'i ve yapısal ilişkileri görünür.
- Finansal alanlar yalnızca ayrı finans yetkisi bulunan admin/staff için görünür.
- Büyük ağ “tek seferde binlerce küçük düğüm” olarak çizilmez; bütün dallar exact sayılarla temsil edilir ve kademeli olarak açılır.

### 2.2 Üye

- Üyenin ağ kökü her zaman kendisidir; başka bir üyeyi yeni kök yapamaz.
- Üyenin üzerinde yalnızca **tek sponsor** görünür. Daha üst ancestor zinciri API'ye veya DOM'a gönderilmez.
- Kullanıcının kendisi `You are here` ve `Your network root` olarak belirgin gösterilir.
- **Tier 1:** Direkt davet edilen üyeler tam isim, baş harf/avatar, referral kodu, durum ve güvenli takım özetiyle görünür.
- **Tier 2 ve Tier 3:** Yalnızca iki harfli baş harf, `Tier N member`, durum kategorisi ve aşağıda tanımlanan bucket'lanmış privacy-safe performans özeti görünür; kesin kişisel satış veya para tutarı gösterilmez.
- **Tier 4 ve sonrası:** Düğüm, kişi sayısı, dal sayısı, `+N more`, tooltip, arama sonucu veya toplam metrik olarak gösterilmez.
- Tier 3 düğümleri terminaldir; chevron, expand aksiyonu veya alt seviye göstergesi taşımaz.
- Aynı görünür tier içindeki henüz açılmamış kardeşler `+N Tier 2 members` veya `+N Tier 3 members` şeklinde gruplanabilir. `Tier 2+` gibi belirsiz bir etiket kullanılmaz.
- Üye KPI'ları yalnızca görünür Tier 1–3 kapsamını hesaplar ve `Visible network · Tiers 1–3` olarak etiketlenir.
- Başka üyelerin e-posta, tam üye kimliği, komisyon, bakiye, izin veya işlem detayları gösterilmez.

Tier 2–3 performans gizliliği:

- Onaylı satışlar `0`, `1–4`, `5–9`, `10+` bantlarından biri olarak gösterilir.
- MTD visible branch volume `No activity`, `< $1k`, `$1k–$5k`, `$5k–$10k`, `$10k+` bantlarından biri olarak gösterilir; tenant currency'si ve locale'i kullanılır.
- Üçten az anonim üyeden oluşan aggregate/cluster için para ve satış bandı bastırılır; yalnız `Not enough data` gösterilir.
- Tier 2–3 node'larında exact kişisel veya branch para tutarı hiçbir response alanında bulunmaz.
- Tier 1 exact branch metriği yalnız kullanıcının görünür Tier 1–3 kapsamından hesaplanır; kişisel commission veya balance içermez.

### 2.3 Görsel yön

- Admin için onaylanan yön `Focus Cockpit`tir.
- Üye görünümü aynı ağaç dilini kullanır fakat mevcut açık renkli member shell ve yatay navigasyonu korur.
- Admin: obsidian sol rail + pearl/ivory workspace + cobalt seçim rengi.
- Üye: mevcut açık header/nav + pearl/ivory workspace + cobalt tree state + kontrollü copper navigasyon vurgusu.
- Sora display ve Inter body tipografisi, mevcut semantic tokenlar, ince border ve düşük shadow kullanılır.
- Finans akış şeması ile kişi ağacı aynı canvas üzerinde karıştırılmaz.
- `surface=value-flow` bağımsız finansal akış diyagramıdır. `lens=performance` ise kişi ağacını korur ve yalnız node üzerindeki izinli performans alanlarını değiştirir.

## 3. Hedefler ve başarı tanımı

### 3.1 Hedefler

- Admin, herhangi bir üyeyi arayıp şirket ağındaki gerçek yerini ve bütün alt dalını iki aksiyon içinde görebilir.
- Admin genel ağ ile odaklanmış dal arasında bağlam kaybetmeden geçebilir.
- Üye, sponsorunu, kendisini ve Tier 1–3 ağını ilk bakışta anlayabilir.
- Üye tarafındaki kimlik redaksiyonu yalnız UI'a değil server projection'ına uygulanır.
- Büyük tenant ağlarında doğruluk korunurken canvas okunabilir ve performanslı kalır.
- Tree, list, keyboard ve mobile outline aynı server sözleşmesini kullanır.

### 3.2 Başarı ölçütleri

- Moderasyonlu testte adminlerin en az `%90`ı seçili bir üyenin sponsor zincirini ve alt ağ büyüklüğünü yardım almadan bulur.
- Üyelerin en az `%90`ı sponsor, kendi konumu, direkt ekip ve anonim alt seviye ayrımını doğru açıklar.
- Admin focus değişimi sıcak cache ile p95 `<= 800 ms`; branch expansion p95 `<= 500 ms` hedefler.
- Canvas etkileşimi INP p75 `<= 200 ms`; layout shift CLS `<= 0.1`.
- Cross-tenant veri sızıntısı, Tier 2–3 tam kimlik sızıntısı ve Tier 4+ üye projection'ı: `0`.
- Kritik keyboard veya WCAG 2.2 AA ihlali: `0`.

## 4. Kapsam

### 4.1 Kapsam içinde

- `/admin/tree` için varsayılan kişi hiyerarşisi ve ikincil Value flow görünümü.
- `/hq/c/[id]/tree` yüzeyinin aynı ortak explorer'a taşınması.
- `/app/team` üye web tree görünümü.
- Expo `/(tabs)/team` için Tier 1–3 hiyerarşik outline/drill-down görünümü.
- Admin kişi arama, full network, focus branch, tree/list ve people/performance lensleri.
- Üye sponsor/self/direct/anonymous descendant projection'ı.
- Ancestor, descendant, cursor, exact coverage ve capability-aware API sözleşmeleri.
- Büyük ağ progressive loading, branch clustering ve partial-state açıklaması.
- URL state, Back/Forward, keyboard, responsive, empty/loading/error davranışları.
- Mevcut üye seçimindeki client-side çökme dahil ilgili tree hatalarının giderilmesi.
- API, component, integration, browser ve accessibility testleri.

### 4.2 Kapsam dışında

- Referral sponsor ilişkisini yeniden yazma veya üyeleri drag-and-drop ile başka sponsora taşıma.
- Komisyon oranları, plan derinliği veya payout hesaplama kurallarını değiştirme.
- Public referral/invite akışını yeniden tasarlama.
- Finansal Value flow modülünü kaldırma.
- Kullanıcıya Tier 4+ kişi, branch veya aggregate görünürlüğü verme.
- Admin olmayan kullanıcıya tenant çapında kişi arama veya arbitrary focus yetkisi verme.
- Aynı anda binlerce bireysel node'u canvas'a render etme.

## 5. Bilgi mimarisi ve route state

### 5.1 Admin route

Canonical route:

```text
/admin/tree?surface=hierarchy&scope=full|focused&focus=<membershipId>&view=tree|list&lens=people|performance&selected=<membershipId>
```

- `surface=hierarchy` varsayılandır.
- `surface=value-flow` mevcut finansal ekranı açar.
- `scope=full` şirket kökünden genel ağı; `scope=focused` seçili üyeyi yerel Tier 1 olarak gösterir.
- `selected` yalnız inspector seçimini, `focus` çalışma alanı kökünü ifade eder.
- Kişi seçimi ve scope değişimi `router.push` kullanır.
- Kişi arama metni URL'ye yazılmaz; ephemeral component state'te tutulur ve log-redacted search endpoint'ine gönderilir.
- Back/Forward önceki kişi, scope, view ve lens durumunu geri kurar.

### 5.2 Member route

Canonical route:

```text
/app/team?view=tree|list&lens=people|performance
```

- Üye route'u `focus` veya tenant çapında `q` kabul etmez.
- Arama yalnızca isimli Tier 1 direkt üyeleri kapsar.
- Arama ve seçili node ephemeral state'tir; browser history, analytics payload veya route query'ye yazılmaz.
- Server her isteği access token içindeki aktif membership'e sabitler.
- Tier 2–3 seçimi yalnız anonim branch summary açar.

### 5.3 Native route

- Expo `/(tabs)/team` aynı member projection'ını kullanır.
- Canvas yerine semantik, sanallaştırılabilir outline kullanılır.
- Sponsor ve self sabit üst bağlamdır; Tier 1 accordion satırları Tier 2–3 anonim çocukları açar.
- Tier 3 satırlarında disclosure kontrolü bulunmaz.

## 6. Admin deneyimi

### 6.1 Header ve araçlar

Sıralama:

1. `Network hierarchy` başlığı ve scope açıklaması.
2. Server-backed `Search members or codes` kişi bulucu.
3. `Focused view / Full network`.
4. `Tree / List`.
5. `People / Performance`.
6. Permission-aware status/rank filtreleri ve `Fit`.

Search sonucu seçildiğinde kişi önce selected olur. Admin açık `Focus as Tier 1` aksiyonuyla çalışma alanını yeniden kökler.

### 6.2 Focused view

- Lineage strip: `Company root › … › Selected member`.
- Seçili üye canvas'ın en üst node'udur ve `Focused member · Local Tier 1` taşır.
- Çocuklar ve alt dallar yerel Tier 2, Tier 3… olarak görsel yerleşir.
- Inspector gerçek global tier, sponsor, direct count, exact subtree count ve izinli metrikleri gösterir.
- `Back to whole network` full scope'a döner.
- Ancestor path cobalt ile vurgulanır; diğer içerik erişilebilir kontrastın altına düşürülmez.

### 6.3 Full network

- Şirket root ve üst düzey dallar görünür.
- Bütün ağ erişilebilir fakat node budget nedeniyle gerektiğinde exact branch cluster kullanılır.
- Cluster `Marcus Chen branch · 428 members` gibi server-authoritative sayılar taşır.
- Cluster açmak child page yükler; `Focus branch` dalı ayrı workspace'e taşır.
- Full network list view cursor pagination ile bütün üyeleri sıralı olarak erişilebilir kılar.
- `Loaded X of Y` ve `N branches collapsed` her zaman görünürdür.

### 6.4 Inspector

Yapısal bölüm:

- ad, referral code, status, rank;
- global tier ve local tier;
- sponsor;
- direct members ve exact total downline;
- joined date.

Performans bölümü yalnız capability varsa:

- MTD team revenue;
- approved sales;
- member commission;
- company median karşılaştırması.

Ana aksiyon `Open member`, ikincil aksiyon `Focus as Tier 1`dir. E-posta ve hassas üye bilgisi yalnız `members.view` ile ayrı detail yüzeyinde yüklenir.

## 7. Üye deneyimi

### 7.1 Sayfa sırası

1. `My network` başlığı ve tarih.
2. Tek strip içinde `Direct members`, `Visible downline · Tiers 1–3`, `Active members`, `MTD visible team volume`.
3. `Tree/List`, `People/Performance`, `Fit network`, direct-member search.
4. Açık privacy bildirimi.
5. Sponsor → Self → Tier 1 → anonim Tier 2–3 tree.
6. `Your network summary` paneli veya dar ekranda sheet.

### 7.2 Node görünürlüğü

| İlişki | Kimlik | Yapısal veri | Performans | Etkileşim |
| --- | --- | --- | --- | --- |
| Sponsor | Tam ad + referral code | Sponsor etiketi | Yok | Detail açılmaz |
| Self | Tam kimlik | Kök, direct ve visible downline | Kendi/team özeti | Sabit root |
| Tier 1 | Tam ad + referral code | Direct ve Tier 1–3 visible branch count | Exact visible-scope team özeti; kişisel finans yok | Seç, dalı aç/kapat |
| Tier 2 | İki harf + `Tier 2 member` | Visible child/branch count | Bucket'lanmış satış ve volume bandı; küçük kohortta bastırılır | Anonim summary |
| Tier 3 | İki harf + `Tier 3 member` | Terminal node | Bucket'lanmış satış ve volume bandı; küçük kohortta bastırılır | Expand yok |
| Tier 4+ | Response'a girmez | Response'a girmez | Response'a girmez | Yok |

### 7.3 Collapsed sibling kuralı

- Node budget veya kullanıcı kapatması nedeniyle aynı görünür tier'da saklanan kardeşler `+N Tier 2 members` ya da `+N Tier 3 members` olarak gösterilebilir.
- `Tier 2+`, `deeper members`, `remaining downline` veya Tier 4+ varlığını ima eden bir sayaç kullanılmaz.
- Tier 3 altına edge çizilmez.
- Visible-scope KPI'ları Tier 4+ sayı veya hacmini içermez.

Visible-scope formülleri:

```text
visibleDownline = COUNT(descendant WHERE localTier BETWEEN 1 AND 3)
visibleActive = COUNT(descendant WHERE localTier BETWEEN 1 AND 3 AND status = active)
visibleApprovedSales = COUNT(approved sale WHERE seller.localTier BETWEEN 1 AND 3)
visibleTeamVolume = SUM(approved sale amount WHERE seller.localTier BETWEEN 1 AND 3)
```

- Bir Tier 1 node'un visible branch metriği de aynı signed-in member köküne göre `localTier <= 3` sınırını kullanır.
- Tier 4+ üyeler veya onların satışları değiştiğinde member tree KPI'ları ve node performans bantları değişmez.

### 7.4 Summary panel

- Kullanıcının visible network kapsamı ve kendi pozisyonu.
- Tek sponsor.
- Tier 1 direct count.
- Tier 1–3 visible downline ve active/pending dağılımı.
- Estimated visible team volume; başka üyelerin komisyon/bakiyesi yok.
- Ana aksiyon `Invite a new member`.
- `How network privacy works` açıklaması.

## 8. Yetki ve gizlilik matrisi

| Aktör | Hiyerarşi | Kimlik | Finans | Focus |
| --- | --- | --- | --- | --- |
| Owner/Admin | Tenant çapında | Tam | `network.financials.view` ile | Her üye |
| Staff + `network.view` | Tenant çapında | Ad/kod/status | Yok | Her üye |
| Staff + `members.view` | Tenant çapında | Detail yüzeyinde ek PII | Yok | Her üye |
| Staff + `network.financials.view` | Tenant çapında | Rolüne göre | Tree performans alanları | Her üye |
| Member | Self tabanlı Tier 1–3 | Sponsor + Tier 1 tam, Tier 2–3 anonim | Yalnız privacy-safe visible team özeti | Self sabit |

Kurallar:

- `network.view` tek başına commission, lifetime earnings veya bakiye açmaz.
- `network.financials.view`, `network.view` olmadan etkisizdir ve tek başına tree okuma yetkisi vermez.
- `openMember=true` yalnız `members.view` ile döner.
- Owner/Admin varsayılan rol seed'i `network.view`, `network.financials.view` ve `members.view` capability'lerini birlikte taşır; staff için her capability ayrı atanır.
- Tree DTO'su ile member-detail DTO'su ayrıdır.
- Yetkisiz alanlar `null` olarak bile taşınmaz; response'tan çıkarılır.
- Cross-tenant admin focus/search `404` döner.
- Member endpoint'leri client'tan membership root kabul etmez.
- Anonymous node'lar raw membership id taşımaz; UI için viewer-bound, kısa ömürlü ve imzalı opaque `nodeRef` kullanır.
- Opaque ref başka member-detail endpoint'lerinde kabul edilmez.
- Search body, opaque ref ve cursor değerleri application/access loglarında redacted edilir; analytics'e gönderilmez.

## 9. API sözleşmeleri

### 9.0 Ortak node ve pagination modeli

```ts
type NetworkStatus = 'active' | 'pending' | 'inactive' | 'suspended';

type AdminMemberNode = {
  kind: 'member';
  membershipId: string;
  parentMembershipId: string | null;
  displayName: string;
  initials: string;
  referralCode: string;
  status: NetworkStatus;
  rank: string | null;
  globalTier: number;
  localTier: number;
  directCount: number;
  subtreeCount: number;
  canExpand: boolean;
  performance?: {
    currency: string;
    period: string;
    approvedSales: number;
    teamVolumeCents: string;
    commissionCents?: string;
  };
};

type AdminClusterNode = {
  kind: 'cluster';
  clusterRef: string;
  parentMembershipId: string | null;
  label: string;
  localTier: number;
  representedNodes: number;
  canExpand: true;
};

type AdminNetworkNode = AdminMemberNode | AdminClusterNode;

type MemberSponsorNode = {
  kind: 'sponsor';
  displayName: string;
  initials: string;
  referralCode: string;
  status: NetworkStatus;
};

type MemberSelfNode = {
  kind: 'self';
  nodeRef: 'self';
  displayName: string;
  initials: string;
  referralCode: string;
  status: NetworkStatus;
  directCount: number;
  visibleDownlineCount: number;
  performance: {
    currency: string;
    period: string;
    visibleApprovedSales: number;
    visibleTeamVolumeCents: string;
  };
};

type MemberDirectNode = {
  kind: 'direct';
  nodeRef: string;
  parentRef: 'self';
  localTier: 1;
  displayName: string;
  initials: string;
  referralCode: string;
  status: NetworkStatus;
  visibleDirectCount: number;
  visibleBranchCount: number;
  canExpand: boolean;
  performance: {
    currency: string;
    period: string;
    approvedSales: number;
    visibleBranchVolumeCents: string;
  };
};

type MemberAnonymousNode = {
  kind: 'anonymous';
  nodeRef: string;
  parentRef: string;
  localTier: 2 | 3;
  initials: string;
  label: 'Tier 2 member' | 'Tier 3 member';
  status: NetworkStatus;
  visibleChildCount?: number;
  canExpand: boolean;
  performanceBand:
    | { suppressed: true; reason: 'smallCohort' | 'noData' }
    | {
        suppressed: false;
        approvedSalesBand: '0' | '1-4' | '5-9' | '10+';
        volumeBand: 'none' | 'under1k' | '1k-5k' | '5k-10k' | '10k+';
      };
};

type MemberVisibleNode = MemberDirectNode | MemberAnonymousNode;

type BranchPage<TNode> = {
  parentRef: string;
  items: TNode[];
  representedNodes: number;
  nextCursor: string | null;
  snapshotAt: string;
};
```

Kurallar:

- Admin synthetic tenant root node'u response'un `root` alanında taşınır; gerçek membership değildir.
- `canExpand=false` olan node için children endpoint'i çağrılmaz.
- `parentRef`, `nextCursor` ve `snapshotAt` her branch page'e aittir; bütün ağ için tek global cursor kullanılmaz.
- Para değerleri decimal cents string, ISO currency ve açık `YYYY-MM` period ile taşınır; frontend finans hesabı yapmaz.
- Opsiyonel admin `performance` alanı yalnız `viewFinancials=true` olduğunda response'a eklenir.
- Anonymous node union'ında tanımlanmayan identity veya exact-finance alanı response'a eklenemez.

### 9.1 Admin context

```http
GET /admin/members/network-context?scope=full|focused&focusId=<uuid>&depth=<n>
```

Response:

```ts
type AdminNetworkContext = {
  root: { kind: 'tenantRoot'; label: string };
  focus: AdminNetworkNode | null;
  ancestors: AdminNetworkNode[];
  initialPage: BranchPage<AdminNetworkNode>;
  scope: {
    kind: 'full' | 'focused';
    loadedNodes: number;
    representedNodes: number;
    totalNodes: number;
    complete: boolean;
    collapsedBranches: number;
    snapshotAt: string;
    structuralCountsCoverage: 'exact';
    metricsCoverage: 'fullSubtree' | 'loadedWindow';
  };
  capabilities: {
    viewIdentity: boolean;
    viewFinancials: boolean;
    openMember: boolean;
    focusBranch: boolean;
  };
};
```

- `depth` ilk canvas materialization derinliğidir; default `3`, minimum `1`, maksimum `5`tir. Daha derin ağ children/cluster expansion veya focus ile erişilir.
- `complete=true`, scope içindeki her üyenin ya bireysel node ya da exact-count cluster ile temsil edildiğini belirtir; `loadedNodes === totalNodes` anlamına gelmez.
- `structuralCountsCoverage='exact'` direct/subtree count'larının loaded page'den bağımsız olduğunu garanti eder.

### 9.2 Admin search ve expansion

```http
POST /admin/members/network-search
GET /admin/members/network-children?parentRef=<membershipId|tenantRootRef>&cursor=<cursor>&snapshotAt=<timestamp>
GET /admin/members/network-cluster-children?clusterRef=<signedRef>&cursor=<cursor>&snapshotAt=<timestamp>
```

- Search body `{ query, cursor }` taşır ve query loglanmaz.
- Search server-side, tenant-scoped ve keyset paginated'dır.
- Child page default `50` kayıt döndürür.
- Children ve cluster response'u `BranchPage<AdminNetworkNode>` döndürür; cursor yalnız döndüğü `parentRef/clusterRef` için geçerlidir.
- Exact direct/subtree counts ayrı aggregate sorgusundan gelir; loaded window'dan türetilmez.

### 9.3 Member context

```http
GET /app/team/tree
GET /app/team/tree/children?parentRef=<opaqueRef>&cursor=<cursor>&snapshotAt=<timestamp>
POST /app/team/tree/direct-search
```

Response:

```ts
type MemberNetworkContext = {
  sponsor: MemberSponsorNode | null;
  self: MemberSelfNode;
  initialPage: BranchPage<MemberVisibleNode>;
  scope: {
    maxVisibleTier: 3;
    loadedNodes: number;
    representedNodes: number;
    completeWithinVisibleDepth: boolean;
    snapshotAt: string;
    structuralCountsCoverage: 'visibleTiersExact';
    metricsCoverage: 'visibleTiersExact' | 'loadedWindow';
  };
};
```

Member projection invariant'ları:

- `tier <= 3`.
- Tier 2–3'te `displayName`, `email`, `referralCode`, raw `membershipId`, commission ve balance yoktur.
- Tier 3'te `canExpand=false` ve child count yoktur.
- Tier 4+ kayıtları önce query'de dışlanır; sonradan frontend'de maskelenmez.
- `representedNodes` yalnız Tier 1–3'ü sayar.
- Direct-member search `POST /app/team/tree/direct-search` body `{ query, cursor }` kullanır, token'daki self'e sabittir ve yalnız Tier 1 `MemberDirectNode` döndürür.
- Member children response'u `BranchPage<MemberVisibleNode>` döndürür; `nodeRef` signed-in viewer'a, `snapshotAt` değerine ve parent'a bağlıdır.

## 10. Backend sorgu ve bütünlük tasarımı

### 10.1 Query modeli

- Ancestor: tenant filtreli `path @> selected.path`, depth ascending.
- Descendant: tenant filtreli `path <@ focus.path`, focus'a göre local tier hesaplanarak.
- Member: `localTier BETWEEN 1 AND 3`; sponsor ayrı tek satır sorgusudur.
- Admin full/focused child expansion sponsor foreign key ve keyset cursor kullanır.
- Tree count ve performans aggregate'leri node window'dan değil aynı server snapshot'ındaki authoritative sorgulardan gelir.
- İlk context okuması repeatable-read içinde yapılır ve `snapshotAt` üretir.
- Sonraki children/cluster cursor'ları `tenant`, `viewer`, `parent/cluster`, sort tuple ve `snapshotAt` değerlerine imzalıdır.
- Sponsor değişikliği bu scope'ta olmadığı ve yeni üyeler için `joinedAt <= snapshotAt` filtresi kullanıldığı için bütün branch page'leri aynı yapısal snapshot'ı temsil eder.
- Cursor süresi dolmuş, signature geçersiz veya snapshot artık desteklenmiyorsa API `409 NETWORK_SNAPSHOT_EXPIRED` döndürür; UI focus/scope'u koruyarak context'i yeniden yükler.

### 10.2 Büyük ağ bütçesi

- Canvas visible node budget: `250`.
- Child page: `50`.
- Budget aşılırsa server exact count taşıyan branch cluster döndürür.
- Full list view cursor ile bütün üyeleri erişilebilir kılar.
- Canvas'a görünmeyen üye “yüklenmiş” sayılmaz; scope etiketi bunu açıklar.
- Admin full network “complete” ifadesi bütün dalların ulaşılabilir olduğunu belirtir; bütün node'ların aynı frame'de render edildiğini iddia etmez.
- Member node budget aşımında yalnız yetkili Tier 1–3 kardeşler exact-tier cluster'a alınır; Tier 4+ cluster oluşturulmaz.

### 10.3 İndeks ve tree integrity

- Child pagination için `(tenant_id, sponsor_membership_id, joined_at, id)` indeksi.
- Mevcut ltree GiST ancestor/descendant sorgularında korunur ve `EXPLAIN ANALYZE` ile doğrulanır.
- Admin full view, gerçek membership olmayan sanal bir tenant root kullanır. `sponsorMembershipId=null` olan bütün geçerli root membership'ler bu node altında gösterilir.
- Migration öncesi audit cross-tenant sponsor, orphan parent, path/depth mismatch ve cycle sayılarını raporlar. Sonuç sıfır değilse constraint migration fail eder; veri sessizce silinmez veya otomatik yeniden bağlanmaz.
- Bozuk legacy kayıt migration öncesi remediation listesinden çözülmeden yeni hierarchy surface production'a açılmaz.
- Sponsor aynı tenant'ta olmalıdır.
- Root dışında `depth = sponsor.depth + 1` ve `path = sponsor.path || self` invariant'ı DB trigger veya eşdeğer transactional constraint ile korunur.
- Sponsor/path değişikliği ayrı güvenli mutation olmadan yapılamaz.

## 11. Frontend mimarisi

Ortak presentational çekirdek:

- `ReferralTreeWorkspace`: route state ve workspace composition.
- `NetworkToolbar`: scope, view, lens, search ve filtreler.
- `LineageStrip`: admin ancestors; member'da yalnız sponsor context.
- `ReferralTreeCanvas`: React Flow viewport, layout ve visible node budget.
- `ReferralTreeNode`: self, focused, direct, anonymous ve cluster varyantları.
- `NetworkScopeStatus`: loaded/represented/coverage açıklaması.
- `NetworkInspector`: admin/member projection'a göre ayrı section registry.
- `NetworkListView`: keyboard ve screen-reader eşdeğer görünüm.
- `MemberPrivacyNotice`: Tier 1–3 kimlik politikasını açıklar.
- `NetworkErrorBoundary`: canvas/inspector hatasını route shell'den izole eder.

Adapter'lar:

- `AdminNetworkAdapter` yalnız admin DTO ve capability'lerini işler.
- `MemberNetworkAdapter` yalnız redacted member DTO'yu işler.
- Presentational component permission veya redaction kararı üretmez.
- Money formatter `undefined/null` değerlerde çökmez; unavailable state döndürür.

State sınırları:

- Admin URL: scope, focus, selected, view, lens ve filters; search metni URL'ye yazılmaz.
- Member URL: view ve lens; selection ve search client-local kalır.
- Client-local: pan/zoom, açık inspector tabı, search, member selection ve geçici expanded-node seti.
- Server state: nodes, ancestors, counts, metrics ve capabilities.
- Discrete seçim URL history'ye eklenir; debounced text search history'yi doldurmaz.

## 12. Loading, empty, partial ve hata davranışları

- İlk yükleme tree geometrisini koruyan skeleton gösterir.
- Child branch yüklenirken yalnız ilgili branch busy olur.
- Branch hatası mevcut canvas'ı silmez; node yanında local retry gösterir.
- Inspector detail hatası tree'yi düşürmez; inspector içinde retry gösterir.
- Geçersiz/stale selection URL'den temizlenir ve scope korunur.
- Cross-tenant veya görünmez node `404` olarak işlenir; veri varlığı açıklanmaz.
- Empty member network sponsor + self'i korur ve invite aksiyonu gösterir.
- Partial admin data `Loaded X of Y` ve `metricsCoverage` ile açıkça etiketlenir.
- API alanı eksik olduğunda `.trim()` gibi unsafe erişim yapılmaz; runtime schema/adaptor güvenli fallback üretir.
- Fatal component exception tüm sayfayı beyaz error ekranına çeviremez.

## 13. Responsive ve erişilebilirlik

### 13.1 Desktop

- Canvas ana yüzeydir; inspector sağ dock'tur.
- Lineage strip canvas üstündedir.
- Node minimum text boyutu `14 px`; kritik target minimum `44×44 px`.

### 13.2 Tablet

- Inspector dismissible side sheet olur.
- Toolbar iki satıra kırılır; canvas minimum genişlik zorlamaz.

### 13.3 Mobile web ve native

- Default görünüm hiyerarşik outline/card list'tir.
- Canvas kullanımı zorunlu değildir.
- Admin mobile'da full network branch listesi + focused drill-down kullanılır.
- Üye mobile/native sponsor → self → Tier 1 accordion → anonim Tier 2–3 akışını kullanır.
- Sayfa düzeyinde horizontal scroll yoktur.

### 13.4 Semantik ve keyboard

- Tree/list node'ları native button veya doğru `tree/treeitem` semantiğine sahiptir.
- Arrow keys sibling/parent/child navigation sağlar; Enter seçer, Space expand/collapse yapar.
- `Tree/List` ve `People/Performance` gerçek tabs veya segmented control semantiği taşır.
- Selection sonrası inspector değişimi live region ile duyurulur; focus beklenmedik biçimde taşınmaz.
- Inspector kapandığında focus seçili node'a döner.
- Selected path yalnız renkle değil border, label ve icon ile de ayrışır.
- Reduced-motion'da zoom/focus geçişi anlık olur; bilgi kaybı olmaz.
- List view canvas'ın keyboard ve screen-reader açısından tam görev eşdeğeridir.

## 14. Telemetry ve gözlemlenebilirlik

Event'ler PII içermez:

- `network_view_opened` — actor role, scope, view, lens.
- `network_member_selected` — role ve local/global tier; membership id gönderilmez.
- `network_focus_changed` — previous/new local scope size bucket.
- `network_branch_expanded` — tier, returned count, latency, coverage.
- `network_privacy_notice_opened`.
- `network_partial_data_shown` — reason ve loaded/total bucket.
- `network_error` — endpoint class, error class, recoverable flag.

Dashboard metric'leri:

- context/children/search p50-p95 latency;
- branch query rows scanned/returned;
- canvas visible node count;
- client exception rate;
- unauthorized/cross-tenant attempt count;
- member redaction contract failure count.

## 15. Test ve doğrulama stratejisi

### 15.1 API contract/integration

- Admin full network, focused subtree ve ordered ancestor path.
- Admin arbitrary focus tenant-safe çalışır.
- Cross-tenant focus/search/child `404` döner.
- `network.view` finansal alan döndürmez.
- Finans capability açıldığında yalnız allowlist alanları döner.
- `network.financials.view` tek başına tree erişimi vermez; `openMember` yalnız `members.view` ile true olur.
- Member root token'dan gelir; query ile başka root seçilemez.
- Member sponsor sayısı en fazla birdir.
- Tier 1 tam kimliklidir; Tier 2–3 anonymous DTO'dur.
- Tier 4+ response serialization'a hiç girmez.
- Tier 3 `canExpand=false`; child endpoint Tier 3 için sonuç döndürmez.
- Visible metrics yalnız Tier 1–3'ü kapsar.
- Tier 4+ üye veya satış fixture'ı eklemek member visible KPI ve performans bantlarını değiştirmez.
- Tier 2–3 exact satış/para alanı döndürmez; bant ve küçük-kohort suppression kuralları pozitif/negatif test edilir.
- Cursor duplicate/skip üretmez.
- Cursor başka parent/viewer/tenant/snapshot ile kullanılamaz; expired snapshot açık `409` döndürür.
- Direct-member search yalnız token sahibinin Tier 1 üyelerini döndürür ve query log-redaction testini geçer.
- Counts loaded window'dan bağımsız exact kalır.
- Sanal tenant root birden fazla geçerli root'u kapsar; orphan/cycle/cross-tenant/path-depth audit migration'ı fail eder.
- Sponsor tenant/path/depth invariant testleri.

### 15.2 Web component/browser

- Admin search → select → inspector → focus → back to full network.
- Browser Back/Forward focus ve selection'ı geri kurar.
- Member sponsor/self/Tier 1/Tier 2/Tier 3 görünürlüğü.
- Member DOM ve network response'ta Tier 2–3 adı/e-postası ve Tier 4+ veri yoktur.
- Aynı görünür tier sibling cluster etiketi exact tier kullanır.
- Tier 3'te expand kontrolü yoktur.
- Inspector hatası canvas'ı düşürmez.
- Missing/undefined display alanı client exception üretmez.
- 390×844, 1024×768 ve 1440×1024 responsive doğrulama.
- Keyboard-only node selection, expansion, tabs, inspector close/return.
- Axe/WCAG 2.2 AA, contrast ve reduced-motion.
- Onaylanan Focus Cockpit admin ve Member Focus Tree yönleriyle görsel karşılaştırma.

### 15.3 Native

- Sponsor/self ve Tier 1–3 outline sırası.
- Tier 2–3 redacted içerik ve Tier 3 terminal state.
- VoiceOver/TalkBack label ve expand/collapse durumu.
- Dynamic Type `%200`, 320/390 px reflow ve safe area.
- Pull-to-refresh mevcut içerik üzerinde hata durumunu korur.

### 15.4 Performans

- 50, 500, 5.000 ve 50.000 üyeli sentetik tenant fixture'ları.
- Wide ve deep tree şekilleri ayrı test edilir.
- `EXPLAIN ANALYZE` ancestor, descendant, child page ve aggregate sorguları.
- Canvas `250` node budget üstüne çıkmaz.
- Search p95 ve branch expansion p95 hedefleri regression gate'tir.

## 16. Uygulama sırası

Bu sıra teknik task listesi değildir; bağımlılık sırasını sabitler:

- **Faz A — Core hierarchy:** Permission/DTO boundary, integrity audit/constraint, API'ler, ortak web workspace, admin ve member web. Ana kullanıcı değeri ve production gate bu fazdadır.
- **Faz B — Parity ve konsolidasyon:** HQ route ve Expo member team. Faz A doğrulanmadan başlamaz; Faz A'nın web teslimini gereksiz yere bloklamaz.
- Her faz ayrı scoped commit/test kanıtı üretir; nihai “komple tamamlandı” sonucu iki faz da geçmeden verilmez.

1. Permission ve DTO boundary: hierarchy, identity ve financial capability ayrımı.
2. DB tree integrity ve gerekli indeksler.
3. Admin/member network context, search ve children API'leri.
4. Shared DTO/adaptor ve null-safe formatter katmanı.
5. Ortak tree workspace, node, lineage, scope ve inspector bileşenleri.
6. Admin `/admin/tree` full/focused hierarchy entegrasyonu.
7. Mevcut Value flow'un ikincil surface olarak korunması.
8. Member `/app/team` privacy-safe Tier 1–3 entegrasyonu.
9. HQ tree konsolidasyonu.
10. Expo member team outline.
11. Accessibility, responsive, performance ve visual QA.
12. Eski `NetworkExplorer`, `RadialNetwork` ve duplicate adapter'ların güvenli kaldırılması.

## 17. Rollout ve geri dönüş

- Önce API additive olarak çıkar; mevcut `/app/team` aggregate response'u geçiş boyunca korunur.
- Admin hierarchy yeni surface olarak açılır, Value flow aynı route ailesinde erişilebilir kalır.
- Member web yeni endpoint'e geçtikten sonra eski radial görünüm kaldırılır.
- Native yeni endpoint'e geçtikten sonra legacy aggregate-only contract deprecate edilir.
- Her route ailesi kendi test ve visual QA kapısını geçmeden sonraki aile açılmaz.
- Kritik hata durumunda yalnız ilgili route adapter'ı eski yüzeye döndürülebilir; DB tree integrity değişiklikleri rollback yerine forward-fix politikasına uyar.
- Production deploy bu tasarım belgesinin doğrudan parçası değildir; ayrı release onayı gerekir.

## 18. Kabul kriterleri

### Admin

- [ ] `/admin/tree` varsayılan olarak gerçek kişi hierarchy açar.
- [ ] Admin tam ağı şirket root bağlamında gezebilir.
- [ ] Admin herhangi bir üyeyi arar, seçer ve `Focus as Tier 1` ile yerel kök yapar.
- [ ] Seçili üyenin full ancestor zinciri ve gerçek global tier'i görünür.
- [ ] Exact subtree sayıları loaded window'dan türetilmez.
- [ ] Finans alanları capability olmadan response veya DOM'a girmez.
- [ ] Full network'ün her üyesi list view/cursor veya branch expansion ile erişilebilirdir.
- [ ] Value flow ikincil surface olarak çalışmaya devam eder.

### Üye

- [ ] Kullanıcı üzerinde yalnızca tek sponsor görünür.
- [ ] Kullanıcının kendisi sabit root ve `You are here` olarak görünür.
- [ ] Tier 1 tam kimlikli; Tier 2–3 iki harf ve anonim label ile görünür.
- [ ] Tier 2–3'te raw membership id, ad, e-posta, referral code, commission veya balance bulunmaz.
- [ ] Tier 2–3 performansı yalnız tanımlı bantlarla görünür; exact satış/para alanı yoktur ve üçten küçük aggregate kohort bastırılır.
- [ ] Tier 4+ node, count, cluster, metric, tooltip, search veya API response olarak görünmez.
- [ ] Tier 3 terminaldir ve expand edilemez.
- [ ] Collapsed sibling etiketi yalnız exact görünür tier'i söyler; `Tier 2+` kullanmaz.
- [ ] Üye KPI ve performans özeti yalnız Tier 1–3 kapsamındadır.
- [ ] Tier 4+ üye veya satış değişikliği member tree KPI ve bantlarını değiştirmez.
- [ ] Üye başka kişiyi root yapamaz veya tenant çapında arayamaz.

### Kalite

- [ ] Node/inspector alanı eksik olduğunda sayfa client exception ile çökmez.
- [ ] Branch/inspector hatası mevcut tree'yi korur ve local retry sunar.
- [ ] Back/Forward URL state'i geri kurar.
- [ ] Tree ve list aynı görevleri keyboard ile tamamlar.
- [ ] 390, 1024 ve 1440 genişliklerinde kritik yatay overflow yoktur.
- [ ] Web WCAG 2.2 AA; native VoiceOver/TalkBack temel görevleri geçer.
- [ ] 50.000 üyeli fixture'da canvas node budget ve API p95 hedefleri korunur.
- [ ] İlgili API, web, native, typecheck, test ve build komutları temizdir.

## 19. Riskler ve azaltma

| Risk | Etki | Azaltma |
| --- | --- | --- |
| Binlerce node'u aynı anda çizmek | Donma ve okunamazlık | 250 node budget, branch clusters, cursor ve list fallback |
| Redaksiyonu yalnız frontend'de yapmak | Kimlik sızıntısı | Ayrı server DTO, serializer allowlist ve negatif contract testleri |
| Loaded window'dan total üretmek | Yanlış takım/gelir sayısı | Exact server aggregate ve açık `metricsCoverage` |
| Local Tier 1 ile global tier'i karıştırmak | Operasyon hatası | Her ikisini ayrı label ve inspector alanı olarak göstermek |
| Node seçiminin otomatik re-root yapması | Bağlam kaybı | Select ve focus aksiyonlarını ayırmak |
| React Flow keyboard açığı | Erişilebilirlik engeli | Native-button node, tree semantics ve görev eşdeğeri list view |
| Inspector detail hatası | Tüm sayfanın çökmesi | Adapter doğrulaması ve isolated error boundary |
| Member Tier 4+ bilgisinin aggregate'de sızması | Politika ihlali/kafa karışıklığı | Query-level depth cap ve visible-scope metrics |

## 20. Açık kararlar

Bloklayıcı açık ürün kararı yoktur. Bu spec onayıyla aşağıdakiler sabitlenir:

- Admin görsel yönü: Focus Cockpit.
- Admin full network + explicit focused branch birlikte bulunur.
- Admin seçili üyeyi yerel Tier 1 yapabilir; global tier korunur.
- Üye tek sponsor görür.
- Üye Tier 1'i tam kimlikle, Tier 2–3'ü anonim baş harf + performans özetiyle görür.
- Üye Tier 4+ hakkında node, count veya metric görmez.
- Member mobile/native canvas yerine anlaşılır outline kullanır.
- Finansal Value flow kaldırılmaz; hierarchy'nin ikincil surface/lens'i olur.

Bu kararlardan biri değişirse önce bu belge, ardından uygulama planı güncellenir.
