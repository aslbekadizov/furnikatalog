import { db, firebase } from "./firebase.js";

export function initializeCatalog(root) {
  let disposed = false;
  let unsubscribeItems;
  let resetLightboxZoom;
  let updateIntroAnimation;
  const events = new AbortController();
  const frames = new Set();
  const timers = new Set();
  const find = (id) => root.querySelector(`#${id}`);
  const initialHtmlOverflow = document.documentElement.style.overflow;
  const initialBodyOverflow = document.body.style.overflow;

  function listen(target, event, handler, options = {}) {
    target.addEventListener(event, handler, {
      ...options,
      signal: events.signal,
    });
  }

  function scheduleFrame(callback) {
    const id = requestAnimationFrame(() => {
      frames.delete(id);
      if (!disposed) callback();
    });
    frames.add(id);
    return id;
  }

  function scheduleTimeout(callback, delay) {
    const id = setTimeout(() => {
      timers.delete(id);
      if (!disposed) callback();
    }, delay);
    timers.add(id);
    return id;
  }
  /* =========================================================
     НАСТРОЙКИ — заполните перед использованием
  ========================================================= */
  const ADMIN_PASSWORD = "admin2026"; // пароль для админ-панели (сайт открыт без пароля)

  const CATEGORIES = [
    { id: "kitchen", label: "Кухонная мебель" },
    { id: "tv", label: "Под ТВ" },
    { id: "bedroom", label: "Спальня" },
    { id: "kids", label: "Детская спальня" },
    { id: "wardrobe", label: "Гардероб" },
    { id: "cabinet", label: "Шкаф" },
    { id: "hallway", label: "Прихожая" },
    { id: "sofa", label: "Диван" },
    { id: "apartment", label: "Готовая квартира" },
  ];

  /* ========================================================= */

  const itemsCol = db.collection("furniture_items");
  const itemImagesCol = db.collection("furniture_item_images");
  const counterRef = db.collection("meta").doc("counter");

  let ALL_ITEMS = [];
  let activeCategory = "all";
  const fullImagesCache = {};
  const fullImagesRequests = new Map();

  /* ---------- BOOT ---------- */
  const app = find("app");
  app.style.display = "block";
  find("adminPanel").style.display = "none";
  find("lightbox").style.display = "none";
  find("lightbox").classList.remove("open");
  find("grid").innerHTML =
    '<div class="empty"><div class="loader"></div></div>';

  let booted = false;
  function boot() {
    if (booted) return;
    booted = true;
    renderCategoryRail();
    populateUploadSelect();
    updateFileInputMode();
    loadItems();
  }

  /* ---------- IMAGE HELPERS ---------- */
  // Legacy items keep their full-size images inline on the doc; newer items
  // only carry a small "thumb" here. Visible cards and the lightbox share
  // full-image requests so sharp photos load without downloading the whole catalog.
  function itemImages(i) {
    return i.images && i.images.length ? i.images : i.image ? [i.image] : [];
  }

  function itemThumbSrc(i) {
    return i.thumb || itemImages(i)[0] || "";
  }

  function itemImageCount(i) {
    return i.imageCount || itemImages(i).length;
  }

  async function getFullImages(item) {
    const inline = itemImages(item);
    if (inline.length) return inline;
    if (fullImagesCache[item.id]) return fullImagesCache[item.id];
    if (!fullImagesRequests.has(item.id)) {
      const request = itemImagesCol
        .doc(item.id)
        .get()
        .then((doc) => {
          const imgs = doc.exists && doc.data().images ? doc.data().images : [];
          if (imgs.length) fullImagesCache[item.id] = imgs;
          return imgs;
        })
        .finally(() => fullImagesRequests.delete(item.id));
      fullImagesRequests.set(item.id, request);
    }
    return fullImagesRequests.get(item.id);
  }

  /* ---------- CATEGORY RAIL ---------- */
  function renderCategoryRail() {
    const rail = find("catRail");
    const all = [{ id: "all", label: "Все" }, ...CATEGORIES];
    rail.innerHTML = all
      .map(
        (c) =>
          `<div class="cat-chip ${c.id === activeCategory ? "active" : ""}" data-cat="${c.id}">${c.label}</div>`,
      )
      .join("");
    rail.querySelectorAll(".cat-chip").forEach((chip) => {
      listen(chip, "click", () => {
        activeCategory = chip.dataset.cat;
        renderCategoryRail();
        renderGrid();
      });
    });
  }

  function populateUploadSelect() {
    const sel = find("uploadCat");
    sel.innerHTML = CATEGORIES.map(
      (c) => `<option value="${c.id}">${c.label}</option>`,
    ).join("");
  }

  function catLabel(id) {
    const c = CATEGORIES.find((x) => x.id === id);
    return c ? c.label : id;
  }

  /* ---------- LOAD & RENDER ---------- */
  function loadItems() {
    unsubscribeItems = itemsCol.orderBy("createdAt", "desc").onSnapshot(
      (snap) => {
        if (disposed) return;
        ALL_ITEMS = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        renderGrid();
        renderAdminList();
      },
      (err) => {
        if (disposed) return;
        find("grid").innerHTML =
          `<div class="empty"><b>Ошибка загрузки</b>Проверьте настройки Firebase (firebaseConfig) в коде файла.</div>`;
        console.error(err);
      },
    );
  }

  /* Каталог сразу отображается (теги, категории и т.д.), а сами фото
     подгружаются отдельной очередью: не больше IMG_CONCURRENCY штук
     одновременно, и только когда карточка появляется в зоне видимости —
     поэтому страница не виснет, даже если товаров много. */
  const IMG_CONCURRENCY = 5;
  let imgActive = 0;
  const imgQueue = [];

  function queueImageLoad(img) {
    imgQueue.push(img);
    pumpImageQueue();
  }

  function pumpImageQueue() {
    while (!disposed && imgActive < IMG_CONCURRENCY && imgQueue.length) {
      const img = imgQueue.shift();
      if (disposed || !img.isConnected) continue;
      imgActive++;
      loadGridImage(img).finally(() => {
        imgActive--;
        pumpImageQueue();
      });
    }
  }

  async function loadGridImage(img) {
    // Keep the fast preview visible until the full-size photo has been decoded.
    const preview = img.dataset.src;
    if (preview) img.src = preview;
    delete img.dataset.src;
    const item = ALL_ITEMS.find((i) => i.id === img.dataset.itemId);
    if (!item) return;
    try {
      const images = await getFullImages(item);
      const src = images[0];
      if (!src || src === preview || disposed || !img.isConnected) return;
      const fullImage = new Image();
      fullImage.decoding = "async";
      fullImage.src = src;
      await fullImage.decode();
      if (!disposed && img.isConnected) img.src = src;
    } catch (err) {
      // A failed full-image request leaves the preview usable and can be retried.
      console.warn("Could not load full-size catalog photo:", item.id, err);
    }
  }

  const gridImgObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          gridImgObserver.unobserve(entry.target);
          queueImageLoad(entry.target);
        }
      });
    },
    { rootMargin: "300px 0px" },
  );

  function renderGrid(filtered) {
    const grid = find("grid");
    gridImgObserver.disconnect();
    imgQueue.length = 0;
    let items = filtered || ALL_ITEMS;
    if (!filtered) {
      items =
        activeCategory === "all"
          ? ALL_ITEMS
          : ALL_ITEMS.filter((i) => i.category === activeCategory);
    }
    if (items.length === 0) {
      grid.innerHTML = `<div class="empty"><b>Ничего не найдено</b>Попробуйте другую категорию или ID.</div>`;
      return;
    }
    grid.innerHTML = items
      .map((i) => {
        const count = itemImageCount(i);
        return `
      <div class="card" data-id="${i.id}">
        <div class="card-img-wrap">
          <img class="card-img" data-item-id="${i.id}" data-src="${itemThumbSrc(i)}" alt="${i.tag}" loading="lazy" decoding="async">
          ${count > 1 ? `<span class="card-img-count">1/${count}</span>` : ""}
        </div>
        <div class="card-body">
          <span class="card-tag">${i.tag}</span>
          <span class="card-cat">${catLabel(i.category)}</span>
        </div>
      </div>
    `;
      })
      .join("");
    grid.querySelectorAll(".card").forEach((card) => {
      listen(card, "click", () => openLightbox(card.dataset.id));
    });
    grid
      .querySelectorAll(".card-img")
      .forEach((img) => gridImgObserver.observe(img));
  }

  /* ---------- ID SEARCH ---------- */
  function doSearch() {
    const raw = find("idSearch").value.trim().toUpperCase().replace("#", "");
    if (!raw) {
      renderGrid();
      return;
    }
    const found = ALL_ITEMS.filter((i) => i.tag.toUpperCase().includes(raw));
    renderGrid(found);
  }
  listen(find("idSearchBtn"), "click", doSearch);
  listen(find("idSearch"), "keydown", (e) => {
    if (e.key === "Enter") doSearch();
  });

  /* ---------- LIGHTBOX ---------- */
  let lbImages = [];
  let lbIndex = 0;
  let lbRequestId = 0;

  async function openLightbox(id) {
    const item = ALL_ITEMS.find((i) => i.id === id);
    if (!item) return;
    const requestId = ++lbRequestId;
    find("lbTag").textContent = item.tag;
    find("lbCat").textContent = catLabel(item.category);
    const specs = item.specs || [];
    find("lbSpecsTitle").style.display = specs.length ? "block" : "none";
    find("lbSpecs").innerHTML = specs
      .map(
        (s) =>
          `<div class="spec-line"><span class="spec-k">${s.name}:</span><span class="spec-v">${s.value}</span></div>`,
      )
      .join("");

    // Reuse full-quality photos already loaded by a visible catalog card.
    lbImages = fullImagesCache[id] || itemImages(item);
    if (!lbImages.length) lbImages = item.thumb ? [item.thumb] : [];
    lbIndex = 0;
    renderLbImage();

    const lb = find("lightbox");
    lb.style.display = "flex";
    scheduleFrame(() => lb.classList.add("open"));
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";

    try {
      const fullImages = await getFullImages(item);
      if (!disposed && fullImages.length && requestId === lbRequestId) {
        lbImages = fullImages;
        lbIndex = 0;
        renderLbImage();
      }
    } catch (err) {
      console.warn("Could not load full-size product photos:", id, err);
    }
  }

  function closeLightbox() {
    const requestId = ++lbRequestId;
    const lb = find("lightbox");
    lb.classList.remove("open");
    document.documentElement.style.overflow = "";
    document.body.style.overflow = "";
    if (resetLightboxZoom) resetLightboxZoom();
    scheduleTimeout(() => {
      if (requestId === lbRequestId) lb.style.display = "none";
    }, 200);
  }

  function renderLbImage() {
    if (resetLightboxZoom) resetLightboxZoom();
    const imgEl = find("lbImg");
    const loader = find("lbLoader");
    const counter = find("lbCounter");
    if (!lbImages.length) {
      imgEl.style.display = "none";
      counter.style.display = "none";
      loader.style.display = "block";
      return;
    }
    loader.style.display = "none";
    imgEl.style.display = "";
    imgEl.src = lbImages[lbIndex] || "";
    const multi = lbImages.length > 1;
    counter.style.display = multi ? "block" : "none";
    counter.textContent = multi ? `${lbIndex + 1} / ${lbImages.length}` : "";
  }

  function lbGoto(dir) {
    if (lbImages.length < 2) return;
    lbIndex = (lbIndex + dir + lbImages.length) % lbImages.length;
    renderLbImage();
  }

  listen(find("lbClose"), "click", closeLightbox);

  /* swipe / drag left-right to move between photos; pinch with 2 fingers to zoom in on the image */
  (function () {
    const wrap = find("lbImgWrap");
    const img = find("lbImg");
    let startX = 0,
      startY = 0,
      dragging = false,
      moved = false;
    const threshold = 40;

    const MIN_SCALE = 1,
      MAX_SCALE = 4;
    let scale = 1,
      panX = 0,
      panY = 0;
    let pinching = false,
      panning = false;
    let pinchStartDist = 0,
      pinchStartScale = 1;
    let panStartX = 0,
      panStartY = 0,
      panOriginX = 0,
      panOriginY = 0;

    function clampPan() {
      const maxX = Math.max(0, ((scale - 1) * wrap.clientWidth) / 2);
      const maxY = Math.max(0, ((scale - 1) * wrap.clientHeight) / 2);
      panX = Math.min(maxX, Math.max(-maxX, panX));
      panY = Math.min(maxY, Math.max(-maxY, panY));
    }

    function applyTransform() {
      clampPan();
      img.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
    }

    function resetZoom() {
      scale = 1;
      panX = 0;
      panY = 0;
      pinching = false;
      panning = false;
      img.style.transform = "";
    }
    resetLightboxZoom = resetZoom;

    function touchDist(t0, t1) {
      return Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
    }

    function start(x, y) {
      startX = x;
      startY = y;
      dragging = true;
      moved = false;
    }
    function move(x) {
      if (dragging && Math.abs(x - startX) > 10) moved = true;
    }
    function end(x, y) {
      if (!dragging) return;
      dragging = false;
      const dx = x - startX,
        dy = y - startY;
      if (moved && Math.abs(dx) > threshold && Math.abs(dx) > Math.abs(dy)) {
        lbGoto(dx < 0 ? 1 : -1);
      }
    }

    listen(
      wrap,
      "touchstart",
      (e) => {
        if (e.touches.length === 2) {
          dragging = false;
          pinching = true;
          pinchStartDist = touchDist(e.touches[0], e.touches[1]);
          pinchStartScale = scale;
        } else if (e.touches.length === 1) {
          if (scale > 1) {
            panning = true;
            panStartX = e.touches[0].clientX;
            panStartY = e.touches[0].clientY;
            panOriginX = panX;
            panOriginY = panY;
          } else {
            const t = e.touches[0];
            start(t.clientX, t.clientY);
          }
        }
      },
      { passive: true },
    );

    listen(
      wrap,
      "touchmove",
      (e) => {
        if (pinching && e.touches.length === 2) {
          const d = touchDist(e.touches[0], e.touches[1]);
          scale = Math.min(
            MAX_SCALE,
            Math.max(MIN_SCALE, pinchStartScale * (d / pinchStartDist)),
          );
          applyTransform();
        } else if (panning && e.touches.length === 1) {
          const t = e.touches[0];
          panX = panOriginX + (t.clientX - panStartX);
          panY = panOriginY + (t.clientY - panStartY);
          applyTransform();
        } else if (dragging && e.touches.length === 1) {
          const t = e.touches[0];
          move(t.clientX);
        }
      },
      { passive: true },
    );

    listen(wrap, "touchend", (e) => {
      if (e.touches.length >= 2) return;
      if (e.touches.length === 1) {
        // one finger lifted out of a pinch — keep zoom, switch to panning
        pinching = false;
        if (scale > 1) {
          panning = true;
          panStartX = e.touches[0].clientX;
          panStartY = e.touches[0].clientY;
          panOriginX = panX;
          panOriginY = panY;
        }
        return;
      }
      // no fingers left
      if (pinching) {
        pinching = false;
        if (scale <= 1.02) resetZoom();
      }
      panning = false;
      if (dragging) {
        const t = e.changedTouches[0];
        end(t.clientX, t.clientY);
      }
    });

    listen(wrap, "mousedown", (e) => {
      start(e.clientX, e.clientY);
    });
    listen(window, "mousemove", (e) => {
      if (dragging) move(e.clientX);
    });
    listen(window, "mouseup", (e) => {
      if (dragging) end(e.clientX, e.clientY);
    });

    listen(wrap, "click", (e) => {
      if (moved) {
        moved = false;
        return;
      }
      if (e.target === e.currentTarget) closeLightbox();
    });
  })();

  listen(document, "keydown", (e) => {
    if (find("lightbox").style.display !== "flex") return;
    if (e.key === "Escape") closeLightbox();
    if (e.key === "ArrowLeft") lbGoto(-1);
    if (e.key === "ArrowRight") lbGoto(1);
  });

  /* ---------- ADMIN GATE ---------- */
  listen(find("openAdmin"), "click", () => {
    const pass = prompt("Пароль администратора:");
    if (pass === ADMIN_PASSWORD) {
      app.style.display = "none";
      find("adminPanel").style.display = "block";
    } else if (pass !== null) {
      alert("Неверный пароль");
    }
  });
  listen(find("closeAdmin"), "click", () => {
    find("adminPanel").style.display = "none";
    app.style.display = "block";
  });

  /* ---------- SPEC FIELDS (nomi + qiymati) ---------- */
  const specFields = find("specFields");

  function addSpecRow(name, value) {
    const row = document.createElement("div");
    row.className = "spec-row";
    row.innerHTML = `
      <input type="text" class="spec-name" placeholder="Название (напр. Материал)">
      <input type="text" class="spec-value" placeholder="Значение (напр. Дерево)">
      <button type="button" class="spec-remove">&times;</button>
    `;
    row.querySelector(".spec-name").value = name || "";
    row.querySelector(".spec-value").value = value || "";
    listen(row.querySelector(".spec-remove"), "click", () => {
      if (specFields.children.length > 1) row.remove();
    });
    specFields.appendChild(row);
  }

  function resetSpecFields() {
    specFields.innerHTML = "";
    addSpecRow();
  }

  function collectSpecs() {
    return Array.from(specFields.querySelectorAll(".spec-row"))
      .map((row) => ({
        name: row.querySelector(".spec-name").value.trim(),
        value: row.querySelector(".spec-value").value.trim(),
      }))
      .filter((s) => s.name || s.value);
  }

  listen(find("addSpecBtn"), "click", () => addSpecRow());
  resetSpecFields();

  /* ---------- IMAGE COMPRESSION + UPLOAD ----------
     Photos are compressed client-side and stored as base64 text directly on
     the Firestore documents (Storage needs the Blaze billing plan, which this
     project isn't on) — so sizes stay well under Firestore's 1MB/document cap. */
  let pendingImages = [];
  let pendingThumb = null;

  const uploadCatSelect = find("uploadCat");
  const fileInput = find("fileInput");
  const previewThumbs = find("previewThumbs");
  const dropLabel = find("dropLabel");

  function updateFileInputMode() {
    fileInput.multiple = true;
    dropLabel.textContent =
      "Нажмите или перетащите изображения сюда (можно несколько)";
  }

  listen(fileInput, "change", async () => {
    const files = Array.from(fileInput.files || []);
    if (files.length === 0) return;
    pendingImages = await Promise.all(
      files.map((f) => compressImage(f, 1200, 0.85)),
    );
    pendingThumb = await compressImage(files[0], 1200, 0.85);
    previewThumbs.innerHTML = pendingImages
      .map((src) => `<img src="${src}">`)
      .join("");
    dropLabel.textContent =
      files.length === 1 ? files[0].name : `${files.length} файлов выбрано`;
  });

  function compressImage(file, maxWidth, quality) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          let w = img.width,
            h = img.height;
          if (w > maxWidth) {
            h = Math.round(h * (maxWidth / w));
            w = maxWidth;
          }
          const canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          canvas.getContext("2d").drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL("image/jpeg", quality));
        };
        img.onerror = reject;
        img.src = e.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function compressDataUrl(dataUrl, maxWidth, quality) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        let w = img.width,
          h = img.height;
        if (w > maxWidth) {
          h = Math.round(h * (maxWidth / w));
          w = maxWidth;
        }
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = reject;
      img.src = dataUrl;
    });
  }

  listen(find("uploadBtn"), "click", async () => {
    const statusEl = find("uploadStatus");
    const btn = find("uploadBtn");
    const category = uploadCatSelect.value;
    const specs = collectSpecs();

    if (pendingImages.length === 0) {
      statusEl.textContent = "Выберите изображение";
      statusEl.className = "status-msg err";
      return;
    }

    btn.disabled = true;
    statusEl.textContent = "Загрузка...";
    statusEl.className = "status-msg";

    try {
      const tag = await getNextTag();
      const docRef = await itemsCol.add({
        tag,
        category,
        specs,
        thumb: pendingThumb,
        imageCount: pendingImages.length,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
      // full-res images live in a separate collection so the catalog listing
      // (onSnapshot on itemsCol) never has to download them up front
      await itemImagesCol.doc(docRef.id).set({ images: pendingImages });
      statusEl.textContent = `Готово — присвоен ${tag}`;
      statusEl.className = "status-msg ok";
      pendingImages = [];
      pendingThumb = null;
      previewThumbs.innerHTML = "";
      updateFileInputMode();
      resetSpecFields();
      fileInput.value = "";
    } catch (err) {
      console.error(err);
      statusEl.textContent = "Ошибка загрузки. Проверьте Firebase.";
      statusEl.className = "status-msg err";
    } finally {
      btn.disabled = false;
    }
  });

  async function getNextTag() {
    return db.runTransaction(async (tx) => {
      const doc = await tx.get(counterRef);
      const next = doc.exists ? doc.data().next || 1 : 1;
      tx.set(counterRef, { next: next + 1 }, { merge: true });
      return "#M" + String(next).padStart(4, "0");
    });
  }

  /* ---------- ADMIN LIST + DELETE ---------- */
  function legacyItems() {
    return ALL_ITEMS.filter((i) => !i.thumb && itemImages(i).length);
  }

  function renderAdminList() {
    const migrateBox = find("migrateBox");
    migrateBox.style.display = legacyItems().length ? "block" : "none";

    const list = find("adminList");
    if (ALL_ITEMS.length === 0) {
      list.innerHTML = `<div class="empty">Пока нет изделий</div>`;
      return;
    }
    list.innerHTML = ALL_ITEMS.map((i) => {
      const count = itemImageCount(i);
      return `
      <div class="admin-list-row">
        <img src="${itemThumbSrc(i)}" alt="" loading="lazy" decoding="async">
        <div class="info">
          <div class="tag">${i.tag}${count > 1 ? ` (${count} фото)` : ""}</div>
          <div class="cat">${catLabel(i.category)}${(i.specs || []).map((s) => " · " + s.name + ": " + s.value).join("")}</div>
        </div>
        <button class="del-btn" data-id="${i.id}">Удалить</button>
      </div>
    `;
    }).join("");
    list.querySelectorAll(".del-btn").forEach((b) => {
      listen(b, "click", async () => {
        if (!confirm("Удалить это изделие?")) return;
        await Promise.all([
          itemsCol.doc(b.dataset.id).delete(),
          itemImagesCol
            .doc(b.dataset.id)
            .delete()
            .catch(() => {}),
        ]);
      });
    });
  }

  /* ---------- MIGRATE LEGACY ITEMS (move inline images out of the listing) ---------- */
  listen(find("migrateBtn"), "click", async () => {
    const btn = find("migrateBtn");
    const statusEl = find("migrateStatus");
    const legacy = legacyItems();
    if (legacy.length === 0) {
      statusEl.textContent = "Все изделия уже оптимизированы.";
      statusEl.className = "status-msg ok";
      return;
    }
    btn.disabled = true;
    let done = 0,
      failed = 0;
    for (const item of legacy) {
      statusEl.textContent = `Оптимизация ${done + failed + 1} из ${legacy.length}...`;
      statusEl.className = "status-msg";
      try {
        const images = itemImages(item);
        const thumb = await compressDataUrl(images[0], 1200, 0.85);
        await itemImagesCol.doc(item.id).set({ images });
        await itemsCol.doc(item.id).update({
          thumb,
          imageCount: images.length,
          images: firebase.firestore.FieldValue.delete(),
          image: firebase.firestore.FieldValue.delete(),
        });
        done++;
      } catch (err) {
        console.error("migrate failed for", item.id, err);
        failed++;
      }
    }
    statusEl.textContent = failed
      ? `Готово: ${done} оптимизировано, ${failed} с ошибкой.`
      : `Готово: оптимизировано ${done} изделий. Каталог теперь загружается быстрее.`;
    statusEl.className = failed ? "status-msg err" : "status-msg ok";
    btn.disabled = false;
  });

  boot();
  scheduleFrame(() => updateIntroAnimation && updateIntroAnimation());

  /* ---------- INTRO SCROLL ANIMATION ---------- */
  (function () {
    const introSection = find("intro");
    const stage = find("introStage");
    const stageInner = find("introStageInner");
    const sofaLeft = find("sofaLeft");
    const sofaRight = find("sofaRight");
    const logo = find("introLogo");
    const hint = find("introHint");
    const header = find("siteHeader");
    const galImgs = [0, 1, 2, 3].map((i) => find("galImg" + i));
    const mainContent = find("mainContent");
    if (!introSection) return;
    const reduce = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (reduce) {
      header.classList.add("revealed");
      return;
    }

    const mobileLogoQuery = window.matchMedia("(max-width:500px)");

    function clamp(v, a, b) {
      return Math.max(a, Math.min(b, v));
    }
    function lerp(a, b, t) {
      return a + (b - a) * t;
    }
    function easeOut(t) {
      return 1 - Math.pow(1 - t, 3);
    }

    function update() {
      const rect = introSection.getBoundingClientRect();
      const total = introSection.offsetHeight - window.innerHeight;
      const scrolled = -rect.top;
      const progress = clamp(total > 0 ? scrolled / total : 0, 0, 1);

      // stage A (0 -> .55): the two furniture halves rise in from the bottom
      // corners and slide together, reassembling into one piece at center
      const pMove = easeOut(clamp(progress / 0.55, 0, 1));
      const offX = lerp(46, 0, pMove); // vw, mirrored per side
      const offY = lerp(46, 0, pMove); // vh

      // quick fade-in for the furniture as it starts moving
      const pFade = clamp(progress / 0.16, 0, 1);

      // stage D (.55 -> .78): once assembled, the furniture shrinks down
      // to a small point and drifts up slightly, then fades right at the end
      const pShrink = clamp((progress - 0.55) / 0.23, 0, 1);
      const shrinkEase = easeOut(pShrink);
      const shrinkScale = lerp(1, 0.1, shrinkEase);
      const shrinkLift = lerp(0, -8, shrinkEase);
      const shrinkOpacity = clamp(1 - Math.max(0, pShrink - 0.55) / 0.45, 0, 1);

      sofaLeft.style.transform = `translate(calc(-50% - ${offX}vw), calc(${offY}vh + ${shrinkLift}vh)) scale(${shrinkScale})`;
      sofaRight.style.transform = `translate(calc(-50% + ${offX}vw), calc(${offY}vh + ${shrinkLift}vh)) scale(${shrinkScale})`;
      sofaLeft.style.opacity = pFade * shrinkOpacity;
      sofaRight.style.opacity = pFade * shrinkOpacity;

      // stage B (0 -> .55): logo starts big & full-strength, then slowly
      // fades out and recedes behind the furniture as it assembles
      const pLogo = clamp(progress / 0.55, 0, 1);
      const logoScale = lerp(1.25, 0.8, pLogo);
      logo.style.opacity = 1 - pLogo;
      const logoSqueezeX = mobileLogoQuery.matches ? 0.8 : 1;
      const logoSqueezeY = mobileLogoQuery.matches ? 0.86 : 1;
      logo.style.transform = `translate(-50%, -50%) scale(${logoScale}) scaleX(${logoSqueezeX}) scaleY(${logoSqueezeY})`;

      // background gallery: alternating columns drift opposite ways
      // (even columns rise, odd columns sink) as the page scrolls
      galImgs.forEach((img, i) => {
        if (!img) return;
        const dir = i % 2 === 0 ? -1 : 1;
        img.style.transform = `translateY(${dir * lerp(0, 16, progress)}%)`;
      });

      // stage E (.78 -> 1): the whole pinned scene pushes forward and fades,
      // as if the camera passes through the point the furniture shrank into —
      // the site (header + catalog) scales and fades in right behind it
      const pReveal = clamp((progress - 0.78) / 0.22, 0, 1);
      const revealEase = easeOut(pReveal);
      stage.style.opacity = 1 - pReveal;
      stageInner.style.transform = `scale(${lerp(1, 1.22, revealEase)})`;
      if (header) header.classList.toggle("revealed", pReveal > 0.3);
      if (mainContent) {
        mainContent.style.opacity = pReveal;
        mainContent.style.transform = `scale(${lerp(0.9, 1, revealEase)}) translateY(${lerp(26, 0, revealEase)}px)`;
      }

      hint.style.opacity = progress > 0.025 ? 0 : 1;
    }

    listen(window, "scroll", update, { passive: true });
    listen(window, "resize", update);
    updateIntroAnimation = update;
    update();
  })();

  return () => {
    disposed = true;
    lbRequestId++;
    events.abort();
    unsubscribeItems?.();
    gridImgObserver.disconnect();
    imgQueue.length = 0;
    frames.forEach(cancelAnimationFrame);
    timers.forEach(clearTimeout);
    resetLightboxZoom?.();
    document.documentElement.style.overflow = initialHtmlOverflow;
    document.body.style.overflow = initialBodyOverflow;
  };
}
