# Haftalık Planlayıcı

Electron tabanlı masaüstü haftalık planlayıcı.

## Geliştirme
```
npm install
npm start
```

## Veri depolama

Plan verisi yerel bir **SQLite** veritabanında tutulur: `Belgeler\Haftalik-Plan\Haftalik-Plan.db`
(`sql.js` ile; derleme sırasında yerel modül gerekmez). Eski sürümün JSON dosyası ilk açılışta otomatik
içeri alınır ve `*.eski.json` adıyla saklanır. **Yedek Al / Aç** düğmeleri JSON yedeği ile çalışır.
Tamamen sıfırlamak için uygulamayı kapatıp `.db` dosyasını silmek yeterlidir.

## Microsoft Store'a yükleme

1. [Partner Center](https://partner.microsoft.com/dashboard) → **Apps and games → New product → MSIX or PWA app** ile uygulama adını rezerve et.
2. **Product management → Product identity** sayfasından şu 3 değeri al ve `package.json` → `build.appx` içine yaz:
   - `Package/Identity/Name` → `identityName`
   - `Package/Identity/Publisher` → `publisher` (`CN=...` ile birlikte, birebir aynı)
   - `Package/Properties/PublisherDisplayName` → `publisherDisplayName`
3. `displayName` değeri Partner Center'da rezerve ettiğin adla aynı olmalı.
4. GitHub → **Actions → Windows paketleri olustur → Run workflow**. Bitince `Haftalik-Plan-Store-Paketi` artifact'ini indir (`.appx`).
5. Partner Center → **Submission → Packages** bölümüne `.appx` dosyasını yükle (Store paketi kendi imzasıyla imzalar, sertifika gerekmez).
6. Mağaza sayfasını doldur: açıklama, ekran görüntüleri, yaş derecelendirmesi ve gizlilik politikası URL'si (`PRIVACY.md` dosyasının GitHub bağlantısı).

Her yeni gönderimde `package.json` içindeki `version` değerini artır.
