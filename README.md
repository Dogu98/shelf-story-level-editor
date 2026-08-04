# Shelf Story Level Editörü

Unity kurulmadan Shelf Story levellerini oluşturmak, Excel/CSV'den aktarmak, doğrulamak, zorluk raporu üretmek ve private oyun reposuna yeni dal olarak kaydetmek için kullanılan statik web uygulamasıdır.

## Yayın adresi

GitHub Pages etkinleştirildiğinde:

```text
https://dogu98.github.io/shelf-story-level-editor/
```

## Özellikler

- JSON tabanlı level düzenleme
- Excel ve CSV içe aktarma
- Blocker referansı ve döngü doğrulama
- Ürün adetleri ve eşleşme kontrolü
- Tepsi kurallarıyla otomatik çözülebilirlik testi
- Zorluk skoru ve CSV raporu
- Unity uyumlu `levels.json` dışa aktarma
- Private `Dogu98/shelf-story` reposu için ön izleme–onay–yeni dal–commit akışı
- İsteğe bağlı taslak Pull Request oluşturma

## GitHub token güvenliği

Token kaynak kodunda bulunmaz ve tarayıcı depolamasına yazılmaz. Yalnızca GitHub kayıt penceresi açıkken bellekte tutulur ve pencere kapatıldığında temizlenir.

Fine-grained token için yalnızca private `Dogu98/shelf-story` reposunu seçin:

- `Contents: Read and write`
- `Pull requests: Read and write` — yalnızca otomatik taslak PR kullanılacaksa

Editör doğrudan `main` dalına yazmaz. Önce mevcut private JSON ile değişiklikleri karşılaştırır, kullanıcı onayından sonra yeni bir `content/levels-*` dalı oluşturur.

## Yerel çalıştırma

```bash
python -m http.server 8080
```

Ardından:

```text
http://localhost:8080/
```

## Test

```bash
node tests/smoke.mjs
```

Public repo yalnızca web editörü ve örnek level kataloğunu içerir. Unity oyun kaynakları private `Dogu98/shelf-story` reposunda kalır.
