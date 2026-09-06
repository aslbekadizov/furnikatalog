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
