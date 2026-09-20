# Furni katalog

React + Vite katalogi mavjud NestJS API bilan ishlaydi. Mahsulotlar PostgreSQL’da,
rasmlar Cloudflare R2’da saqlanadi. Brauzer bazaga bevosita ulanmaydi.
Firebase’dan o‘qish, unga yozish va avtomatik migratsiya olib tashlangan.
Katalog serverning `/api/items` javobidagi mahsulotlarni ko‘rsatadi.

## Mahalliy ishga tushirish

Node.js 24 va npm:

```sh
npm ci
npm run dev
```

Vite `/api` so‘rovlarini `https://furnikatalog.uz/api` ga uzatadi.
Bu haqiqiy server: admin panelidagi o‘zgarishlar haqiqiy katalogga yoziladi.
`npm run preview` ham shu proksidan foydalanadi.

```sh
npm run test
npm run lint
npm run build
```

API klienti `src/catalog-api.js`, katalog controlleri `src/catalog.js`,
React ko‘rinishlari `src/App.jsx` ichida. `tests/catalog-api.test.js`
soxta tarmoq javoblari bilan ishlaydi, haqiqiy bazaga yozmaydi.

## Mavjud API shartnomasi

| Amal      | Manzil                      | Format                                                                              |
| --------- | --------------------------- | ----------------------------------------------------------------------------------- |
| Ro‘yxat   | `GET /api/items`            | `id` (son), `tag`, `category`, `specs`, `thumb`, `imageCount`, `createdAt` massivda |
| Galereya  | `GET /api/items/:id/images` | Rasm URL’lari massivi                                                               |
| Kirish    | `POST /api/admin/login`     | JSON `{ "password": "…" }` → `{ "token": "…" }`                                     |
| Qo‘shish  | `POST /api/items`           | Multipart: `category`, JSON satrli `specs`, takrorlanuvchi `images` fayllari        |
| O‘chirish | `DELETE /api/items/:id`     | Muvaffaqiyatda bo‘sh javob ham qabul qilinadi                                       |

Qo‘shish/o‘chirishda `Authorization: Bearer <token>` yuboriladi.
Admin paroli serverdagi `ADMIN_PASSWORD_HASH` bilan tekshiriladi;
oldingi frontend paroli endi ishlatilmaydi. Token faqat joriy sahifa xotirasida,
chiqishda o‘chiriladi; sahifani yangilaganda qayta kirish kerak.
Baza, JWT va R2 maxfiy ma’lumotlari faqat backendda qoladi.

## Rasmlar va yangilanishlar

- Kartochka yaqinlashganda birinchi katta rasm yuklanadi; kichik 500px `thumb`
  admin ro‘yxati uchungina ishlatiladi. Parallel rasm yuklash soni 5 bilan cheklangan.
- Berilgan backend `items/<uuid>/thumb.jpg` va `items/<uuid>/0.jpg` yaratadi.
  Klient shu shartnomadan foydalanadi. Agar API `cover` URL qaytarsa, u ustun;
  katta rasm manzili ishlamasa, galereya endpointidan birinchi rasm olinadi.
- To‘liq galereya mahsulot ochilganda olinadi. Rasm URL’lari brauzerning odatiy
  HTTP keshi bilan ishlaydi; keshlash muddati R2 javob sarlavhalariga bog‘liq.
- Yangi rasmlar klientda qayta siqilmasdan asl fayl sifatida yuboriladi.
  Mavjud backend ularni o‘z sozlamalari bilan kodlaydi (1600px gacha JPEG, quality 85).
  Limit: 20 ta rasm, har biri 15 MiB gacha; server/proksi jami hajmni ham cheklashi mumkin.
- Ro‘yxat sahifa ochilganda, tabga qaytilganda, internet tiklanganda yangilanadi.
  Shu sahifadagi muvaffaqiyatli qo‘shish/o‘chirish darhol aks etadi.

## HOSTKEY’dagi mavjud saytni yangilash

Serverdagi `/home/scsylla/projects/furnikatalog` loyiha papkasida:

```sh
git pull --ff-only origin main && npm ci && npm run build
```

Bu `dist/` frontendini qayta yaratadi. Amaldagi statik server shu papkani xizmat
qilishi kerak. Mavjud `/api` reverse proxy NestJS backendiga yo‘naltirilgan holda qoladi.
Backend papkasi, `.env`, PostgreSQL va R2 ma’lumotlarini o‘chirmang;
frontend yangilanishi uchun backend migratsiyasi yoki bazani qayta yaratish kerak emas.
`git pull` mahalliy o‘zgarishlar sababli to‘xtasa, ularni saqlab, farqni ko‘rib chiqing.

## Vercel

`vercel.json` `/api/:path*` so‘rovlarini mavjud HOSTKEY manziliga
`https://furnikatalog.uz/api/:path*` uzatadi. API javoblari CDN’da keshlanmaydi.
Vercel’da alohida baza paroli yoki R2 kaliti kiritilmaydi. Backend domeni
HOSTKEY’ga qarashi kerak; shu domenni Vercel’ga ko‘chirsangiz, proksi manzilini
backendning alohida domeniga almashtiring, aks holda so‘rov o‘ziga qaytadi.

Standart API manzili `/api`. Zarur bo‘lsa build vaqtida `VITE_API_BASE_URL`
bilan almashtirish mumkin. Boshqa originga bevosita ulanish uchun backend CORS
sozlamasi ham kerak; odatiy o‘rnatishda proksi yetarli.
