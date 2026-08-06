# Smoke test kapsamı

- `smoke.mjs`: hızlı temel regresyon paketi
- `deep-smoke.mjs`: katalog, çözücü, CSV/Excel, GitHub API, güvenlik, responsive kaynak ve workflow izin denetimleri
- `live-smoke.mjs`: GitHub Pages üzerinde yayınlanan gerçek statik dosyaların HTTP denetimi

Yerel çalıştırma:

```bash
node tests/smoke.mjs
node tests/deep-smoke.mjs
```

`live-smoke.mjs`, Pages deploy workflow'u başarılı tamamlandıktan sonra otomatik çalışır.
