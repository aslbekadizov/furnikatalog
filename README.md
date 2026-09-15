# Furni katalog

React va Vite asosidagi mebel katalogi. Vite mahalliy server va
hosting uchun tayyor fayllarni yaratadi.

## Ishga tushirish

Node.js 24 LTS va npm kerak. nvm ishlatsangiz, `nvm use` buyrug‘i
`.nvmrc` faylidagi versiyani tanlaydi.

```sh
npm install
npm run dev
```

Terminalda ko‘rsatilgan mahalliy manzilni brauzerda oching.
React komponentlari `src/App.jsx`, katalogning mavjud funksiyalari
`src/catalog.js`, Firebase ulanishi `src/firebase.js`, uslublar esa
`src/index.css` faylida joylashgan. Rasmlar `furni-catalog-assets/` papkasida.

Kod tekshiruvi: `npm run lint`.

## Hosting uchun tayyorlash

```sh
npm run build
npm run preview
```

`build` buyrug‘i `dist/` papkasini yaratadi. Hostingga shu papkaning
ichidagi fayllarni yuklang. `preview` tayyorlangan saytni mahalliy tekshirish
uchun ishlatiladi.

## Katalog rasmlari

Kartochkalar uchun alohida 4:3 WebP nusxalar asl rasmdan tayyorlanadi;
1440 pikselgacha, kichik asl rasmlar sun’iy kattalashtirilmaydi.
`furniture_item_covers` faqat kartochkadagi rasmni saqlaydi. To‘liq galereya
`furniture_item_images` dan mahsulot ochilganda olinadi. Kichik `thumb`
ma’muriy ro‘yxat uchun ishlatiladi, katalog kartochkasiga kattalashtirilmaydi.

Yangi yuklamalar avtomatik shu formatda saqlanadi. Eski yozuvlarni admin
panelidagi **Оптимизировать старые изделия** tugmasi bilan bir marta
optimallashtirish mumkin. Asl galereya saqlanadi; har bir mahsulotning
tegishli o‘zgarishlari bitta atomik yozuvda bajariladi.

`imageRevision` yangilanganda brauzerdagi eski rasm keshi bekor bo‘ladi.
Brauzer xotirasi cheklangan bo‘lsa, sayt odatiy tarmoq yuklashida ishlaydi.
