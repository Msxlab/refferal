# Continue Here — Referral Network Hierarchy

**Son güncelleme:** 2026-07-20

Bu dosya bilgisayar veya Codex task değişiminde çalışmayı kaybetmeden devam ettirmek içindir.

## Repository ve branch

- GitHub: `https://github.com/Msxlab/refferal`
- Çalışma branch'i: `codex/earnica-referral-value-flow`
- Ana tasarım spec'i: [`docs/superpowers/specs/2026-07-20-referral-network-hierarchy-design.md`](docs/superpowers/specs/2026-07-20-referral-network-hierarchy-design.md)
- Seçilen admin görseli: [`docs/superpowers/specs/assets/referral-tree-admin-focus-cockpit.png`](docs/superpowers/specs/assets/referral-tree-admin-focus-cockpit.png)
- Seçilen üye görseli: [`docs/superpowers/specs/assets/referral-tree-member-focus-tree.png`](docs/superpowers/specs/assets/referral-tree-member-focus-tree.png)

Bu handoff yazılırken `origin/main`, PR #7 merge commit'iyle yerel base'in bir merge commit önündeydi. Branch'i silme, hard reset yapma veya başka branch üzerine zorla yazma. Uygulama başlamadan önce `origin/main` güvenli biçimde reconcile edilmeli ve conflict varsa davranış/test kanıtıyla çözülmelidir.

## Tamamlananlar

### Git geçmişi

- `e5d5658` — referral value-flow planı.
- `8f339c2` — Earnica admin shell düzeltmesi.
- `70144b9` — referral value-flow model ve web bileşenleri.
- `1e8411b` — web/native contract test onarımları.
- `5b413b9` — referral value-flow workspace teslimi.
- `671d1cb` — referral network hierarchy tasarım spesifikasyonu.

### İnceleme ve tasarım

- Admin `/admin/tree`, üye `/app/team`, legacy `NetworkExplorer`, API tree snapshot, ltree sorguları, yetkiler, responsive ve erişilebilirlik incelendi.
- Üç admin yönü üretildi; kullanıcı **Focus Cockpit** yönünü seçti.
- Focus Cockpit'in gizlilik kontrollü member karşılığı üretildi ve seçildi.
- Onaylanan görseller repository içine kopyalandı; yeni bilgisayarda da erişilebilir.
- Detaylı tasarım spec'i yazıldı, self-review yapıldı ve commit edildi.

## Kilitlenmiş ürün kararları

### Admin

- Gerçek kişi hierarchy varsayılan yüzeydir; finansal Value flow ikincil surface olarak korunur.
- Admin bütün ağı full identity ile görebilir.
- Admin herhangi bir üyeyi seçebilir ve açık `Focus as Tier 1` aksiyonuyla yerel kök yapabilir.
- Global tier ve şirket köküne kadar ancestor zinciri her zaman korunur.
- Full network büyük tenant'larda cursor, exact branch counts ve cluster/progressive loading kullanır.
- Identity, member detail ve financial capability'leri birbirinden ayrılır.

### Üye

- Üye üzerinde yalnızca tek sponsor görünür.
- Self sabit tree root'tur.
- Tier 1 direkt üyeler tam isimlidir.
- Tier 2–3 yalnız iki harf + anonim label + privacy-safe performans bandı gösterir.
- Tier 3 terminaldir.
- Tier 4+ node, edge, count, cluster, tooltip, search sonucu veya KPI olarak görünmez.
- Aynı görünür tier'daki saklı kardeşler yalnız exact tier etiketiyle (`+N Tier 2 members`) açılabilir; `Tier 2+` kullanılmaz.
- Member KPI'ları ve volume yalnız Tier 1–3 seller/activity kapsamından hesaplanır.

## Henüz yapılmayanlar

1. Kullanıcının yazılı spec'i inceleyip açıkça onaylaması.
2. Onaydan sonra `writing-plans` skill'iyle ayrıntılı uygulama planının yazılması.
3. **Faz A:** permission/DTO sınırı, integrity audit/constraint, API'ler, shared web tree, admin ve member web.
4. Faz A API, security, web, accessibility, responsive, performance ve visual QA.
5. **Faz B:** HQ tree konsolidasyonu ve Expo member team outline.
6. Native VoiceOver/TalkBack, Dynamic Type ve contract testleri.
7. `origin/main` ile güvenli final reconciliation, tam test matrisi, push ve gerekiyorsa PR güncellemesi.

## Bilinen mevcut sorunlar

- Admin ekranı halen kişi ağacı yerine finansal Value flow'u ana canvas olarak gösteriyor.
- Admin hierarchy tablosu flat ve ilk 50 satırla sınırlı.
- Bir üyeye tıklamak mock/detail alanı eksik olduğunda `Cannot read properties of undefined (reading 'trim')` ile bütün sayfayı düşürebiliyor.
- Mevcut admin tree snapshot 500 node ile bounded; cursor yok ve ancestor zinciri response'ta bulunmuyor.
- Loaded window'dan türetilen takım/gelir değerleri eksik sonucu kesinmiş gibi gösterebilir.
- Üye `/app/team` yalnız aggregate/radial görünüm sunuyor; self/sponsor/gerçek ilişkiler görünmüyor.
- Üye API'si mevcut durumda plan depth'iyle aggregate veri döndürüyor; yeni Tier 1–3 redacted tree contract henüz uygulanmadı.
- Legacy `NetworkExplorer` pointer-only node/row, eksik tab semantiği ve mobile overflow sorunları taşıyor.
- Mevcut `network.view`, node finansallarını gereğinden geniş açıyor; yeni capability ayrımı henüz uygulanmadı.

## Yeni bilgisayarda devam

Yeni clone için:

```powershell
git clone https://github.com/Msxlab/refferal.git
Set-Location refferal
git fetch origin
git switch --track origin/codex/earnica-referral-value-flow
git status -sb
```

Repo zaten varsa:

```powershell
git fetch origin --prune
git switch codex/earnica-referral-value-flow
git pull --ff-only
git status -sb
```

Codex'te bu repository klasörünü aç ve şu mesajı gönder:

```text
CONTINUE-HERE.md ile docs/superpowers/specs/2026-07-20-referral-network-hierarchy-design.md dosyalarını tamamen oku. Referral tree tasarım spec'ini onaylıyorum. Önce writing-plans süreciyle ayrıntılı uygulama planını oluştur; sonra plandaki Faz A ve Faz B'yi sırayla uygula. Mevcut kullanıcı değişikliklerini koru, origin/main'i hard reset etme ve her fazı ilgili testlerle doğrula.
```

Spec'te değiştirmek istediğin bir nokta varsa “onaylıyorum” yerine değişikliği yaz; plan oluşturulmadan önce spec güncellenmelidir.

## Güvenlik notu

- `.env`, secret, credential veya token bu handoff dosyasına yazılmadı.
- Eski bilgisayardaki `.env` dosyalarını GitHub'a yükleme. Yeni bilgisayarda güvenli kaynaktan yeniden kur.
- GitHub CLI (`gh`) bu bilgisayarda kurulu değildi; branch push normal `git` ile yapılabilir, PR işlemleri yeni bilgisayarda `gh auth login` sonrasında veya GitHub web arayüzünden sürdürülebilir.
