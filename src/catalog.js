import { db, firebase } from "./firebase.js";
import {
  CATALOG_COVER_VERSION,
  createCatalogPreview,
  readCachedCatalogCover,
  cacheCatalogCover,
  removeCachedCatalogCover,
} from "./catalog-images.js";

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
  const itemCoversCol = db.collection("furniture_item_covers");
  const counterRef = db.collection("meta").doc("counter");

  let ALL_ITEMS = [];
  let activeCategory = "all";
  let activeSearch = "";
  let optimizing = false;
  const fullImagesCache = {};
  const fullImagesRequests = new Map();
  const coversCache = new Map();
  const coverRequests = new Map();
  const imageKey = (item) => `${item.id}:${item.imageRevision || "legacy"}`;
  const placeholder =
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='4' height='3'/%3E";
  const escapeHtml = (value) =>
    String(value ?? "").replace(
      /[&<>"']/g,
      (char) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[char],
    );

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
  function itemImages(item) {
    return item.images?.length ? item.images : item.image ? [item.image] : [];
  }

  function itemThumbSrc(item) {
    return item.thumb || itemImages(item)[0] || placeholder;
  }

  function itemImageCount(item) {
    return item.imageCount || itemImages(item).length;
  }

  async function getFullImages(item) {
    const inline = itemImages(item);
    if (inline.length) return inline;
    const key = imageKey(item);
    if (fullImagesCache[key]) return fullImagesCache[key];
    if (!fullImagesRequests.has(key)) {
      const request = itemImagesCol
        .doc(item.id)
        .get()
        .then((doc) => {
          const images = doc.exists ? doc.data().images || [] : [];
          if (images.length) fullImagesCache[key] = images;
          return images;
        })
        .finally(() => fullImagesRequests.delete(key));
      fullImagesRequests.set(key, request);
    }
    return fullImagesRequests.get(key);
  }

  async function getCatalogCover(item) {
    const key = imageKey(item);
    if (coversCache.has(key)) return coversCache.get(key);
    if (!coverRequests.has(key)) {
      const request = (async () => {
        // Old records remain sharp until their one-time optimization is complete.
        if (
          item.coverVersion !== CATALOG_COVER_VERSION ||
          !item.imageRevision
        ) {
          const images = await getFullImages(item);
          if (!images[0]) throw new Error("No source photo");
          return createCatalogPreview(images[0]);
        }
        const cacheKey = `furnizapchast-4a429:cover:${CATALOG_COVER_VERSION}:${key}`;
        const cached = await readCachedCatalogCover(cacheKey);
        if (cached) return cached;
        const doc = await itemCoversCol.doc(item.id).get();
        const cover = doc.exists ? doc.data() : null;
        if (!cover?.image || cover.imageRevision !== item.imageRevision) {
          throw new Error("Catalog cover is missing or outdated");
        }
        return cover;
      })()
        .then(async (cover) => {
          // Validate before caching, even if the original card was removed meanwhile.
          const decoded = new Image();
          decoded.src = cover.image;
          await decoded.decode();
          coversCache.set(key, cover);
          if (
            item.coverVersion === CATALOG_COVER_VERSION &&
            item.imageRevision
          ) {
            void cacheCatalogCover(
              `furnizapchast-4a429:cover:${CATALOG_COVER_VERSION}:${key}`,
              cover,
            );
          }
          return cover;
        })
        .catch((error) => {
          coversCache.delete(key);
          void removeCachedCatalogCover(
            `furnizapchast-4a429:cover:${CATALOG_COVER_VERSION}:${key}`,
          );
          throw error;
        })
        .finally(() => coverRequests.delete(key));
      coverRequests.set(key, request);
    }
    return coverRequests.get(key);
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
        activeSearch = "";
        find("idSearch").value = "";
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
        const nextItems = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        const nextById = new Map(nextItems.map((item) => [item.id, item]));
        ALL_ITEMS.forEach((item) => {
          const next = nextById.get(item.id);
          if (
            !next ||
            imageKey(next) !== imageKey(item) ||
            next.thumb !== item.thumb
          ) {
            delete fullImagesCache[imageKey(item)];
            coversCache.delete(imageKey(item));
          }
        });
        ALL_ITEMS = nextItems;
        renderGrid();
        if (find("adminPanel").style.display === "block") renderAdminList();
      },
      (err) => {
        if (disposed) return;
        find("grid").innerHTML =
          `<div class="empty"><b>Ошибка загрузки</b>Проверьте настройки Firebase (firebaseConfig) в коде файла.</div>`;
        console.error(err);
      },
    );
  }

  /* ---------- LAZY CATALOG COVERS ---------- */
  const IMG_CONCURRENCY = 5;
  let imgActive = 0;
  const imgQueue = [];

  function queueImageLoad(img) {
    img.closest(".card-img-wrap").classList.remove("image-error");
    img.closest(".card-img-wrap").classList.add("image-loading");
    imgQueue.push(img);
    pumpImageQueue();
  }

  function pumpImageQueue() {
    while (!disposed && imgActive < IMG_CONCURRENCY && imgQueue.length) {
      const img = imgQueue.shift();
      if (!img.isConnected) continue;
      const rect = img.getBoundingClientRect();
      if (rect.bottom < -300 || rect.top > window.innerHeight + 300) {
        gridImgObserver.observe(img);
        continue;
      }
      imgActive++;
      loadGridImage(img).finally(() => {
        imgActive--;
        pumpImageQueue();
      });
    }
  }

  async function loadGridImage(img) {
    const item = ALL_ITEMS.find((entry) => entry.id === img.dataset.itemId);
    if (!item) return;
    const wrap = img.closest(".card-img-wrap");
    try {
      const cover = await getCatalogCover(item);
      if (disposed || !img.isConnected) return;
      img.src = cover.image;
      wrap.classList.remove("image-loading", "image-error");
    } catch (err) {
      if (disposed || !img.isConnected) return;
      coversCache.delete(imageKey(item));
      void removeCachedCatalogCover(
        `furnizapchast-4a429:cover:${CATALOG_COVER_VERSION}:${imageKey(item)}`,
      );
      wrap.classList.remove("image-loading");
      wrap.classList.add("image-error");
      console.warn("Could not load catalog cover:", item.id, err);
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

  function renderGrid() {
    const grid = find("grid");
    gridImgObserver.disconnect();
    imgQueue.length = 0;
    let items =
      activeCategory === "all"
        ? ALL_ITEMS
        : ALL_ITEMS.filter((item) => item.category === activeCategory);
    if (activeSearch) {
      items = ALL_ITEMS.filter((item) =>
        item.tag.toUpperCase().includes(activeSearch),
      );
    }
    if (!items.length) {
      grid.innerHTML = `<div class="empty"><b>Ничего не найдено</b>Попробуйте другую категорию или ID.</div>`;
      return;
    }
    grid.innerHTML = items
      .map((item) => {
        const count = itemImageCount(item);
        const cached = coversCache.get(imageKey(item));
        return `
        <div class="card" data-id="${item.id}" tabindex="0" role="button" aria-label="${escapeHtml(item.tag)}">
          <div class="card-img-wrap ${cached ? "" : "image-loading"}">
            <img class="card-img" data-item-id="${item.id}" src="${cached?.image || placeholder}" alt="${escapeHtml(item.tag)}" width="1440" height="1080" loading="lazy" decoding="async">
            <button class="image-retry" type="button">Повторить загрузку</button>
            ${count > 1 ? `<span class="card-img-count">1/${count}</span>` : ""}
          </div>
          <div class="card-body">
            <span class="card-tag">${escapeHtml(item.tag)}</span>
            <span class="card-cat">${escapeHtml(catLabel(item.category))}</span>
          </div>
        </div>`;
      })
      .join("");
    grid.querySelectorAll(".card").forEach((card) => {
      listen(card, "click", () => openLightbox(card.dataset.id));
      listen(card, "keydown", (event) => {
        if (event.target === card && ["Enter", " "].includes(event.key)) {
          event.preventDefault();
          openLightbox(card.dataset.id);
        }
      });
      listen(card.querySelector(".image-retry"), "click", (event) => {
        event.stopPropagation();
        queueImageLoad(card.querySelector(".card-img"));
      });
    });
    grid.querySelectorAll(".card-img").forEach((img) => {
      if (img.src === placeholder) gridImgObserver.observe(img);
    });
  }

  /* ---------- ID SEARCH ---------- */
  function doSearch() {
    activeSearch = find("idSearch").value.trim().toUpperCase().replace("#", "");
    renderGrid();
  }
  listen(find("idSearchBtn"), "click", doSearch);
  listen(find("idSearch"), "keydown", (e) => {
    if (e.key === "Enter") doSearch();
  });

  /* ---------- LIGHTBOX ---------- */
  let lbImages = [];
  let lbIndex = 0;
  let lbRequestId = 0;
  let currentLightboxId = null;

  async function openLightbox(id) {
    const item = ALL_ITEMS.find((i) => i.id === id);
    if (!item) return;
    const requestId = ++lbRequestId;
    currentLightboxId = id;
    find("lbTag").textContent = item.tag;
    find("lbCat").textContent = catLabel(item.category);
    const specs = item.specs || [];
    find("lbSpecsTitle").style.display = specs.length ? "block" : "none";
    find("lbSpecs").innerHTML = specs
      .map(
        (s) =>
          `<div class="spec-line"><span class="spec-k">${escapeHtml(s.name)}:</span><span class="spec-v">${escapeHtml(s.value)}</span></div>`,
      )
      .join("");

    lbImages = fullImagesCache[imageKey(item)] || itemImages(item);
    const cover = coversCache.get(imageKey(item));
    if (!lbImages.length) lbImages = cover ? [cover.image] : [];
    find("lbLoadStatus").textContent = "Загрузка фотографий…";
    find("lbRetry").hidden = true;
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
        find("lbLoadStatus").textContent = "";
      } else if (!disposed && requestId === lbRequestId) {
        throw new Error("No product photos");
      }
    } catch (err) {
      if (!disposed && requestId === lbRequestId) {
        find("lbLoadStatus").textContent =
          "Не удалось загрузить фото. Попробуйте ещё раз.";
        find("lbRetry").hidden = false;
        find("lbLoader").style.display = "none";
      }
      console.warn("Could not load full-size product photos:", id, err);
    }
  }

  listen(find("lbRetry"), "click", () => {
    if (currentLightboxId) openLightbox(currentLightboxId);
  });

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
      renderAdminList();
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

  /* ---------- IMAGE PREPARATION + ATOMIC UPLOAD ---------- */
  let pendingImages = [];
  let pendingCover = null;
  let selectionVersion = 0;
  let preparingImages = false;
  const uploadCatSelect = find("uploadCat");
  const fileInput = find("fileInput");
  const previewThumbs = find("previewThumbs");
  const dropLabel = find("dropLabel");

  function updateFileInputMode() {
    fileInput.multiple = true;
    dropLabel.textContent =
      "Нажмите или перетащите изображения сюда (можно несколько)";
  }

  // Leave room for Firestore's field/document overhead; validate before any write.
  function validateImageDocument(data) {
    if (new TextEncoder().encode(JSON.stringify(data)).length > 950000) {
      throw new Error(
        "Фотографии слишком большие. Выберите меньше фотографий для одного изделия.",
      );
    }
  }

  async function prepareFiles(files) {
    const version = ++selectionVersion;
    pendingImages = [];
    pendingCover = null;
    previewThumbs.innerHTML = "";
    const status = find("uploadStatus");
    status.textContent = "";
    status.className = "status-msg";
    preparingImages = files.length > 0;
    find("uploadBtn").disabled = preparingImages;
    if (!files.length) {
      updateFileInputMode();
      return;
    }
    status.textContent = "Подготовка фотографий…";
    try {
      const images = await Promise.all(
        files.map((file) => compressImage(file, 1200, 0.85)),
      );
      const cover = await createCatalogPreview(files[0]);
      validateImageDocument({ images });
      validateImageDocument({ image: cover.image });
      if (disposed || version !== selectionVersion) return;
      pendingImages = images;
      pendingCover = cover;
      previewThumbs.innerHTML = images
        .map((image) => `<img src="${image}" alt="Выбранное фото">`)
        .join("");
      dropLabel.textContent =
        files.length === 1 ? files[0].name : `${files.length} файлов выбрано`;
      status.textContent = "";
    } catch (err) {
      if (disposed || version !== selectionVersion) return;
      status.textContent =
        err.message ||
        "Не удалось прочитать фото. Выберите другое изображение.";
      status.className = "status-msg err";
      updateFileInputMode();
    } finally {
      if (!disposed && version === selectionVersion) {
        preparingImages = false;
        find("uploadBtn").disabled = false;
      }
    }
  }

  listen(fileInput, "change", () =>
    prepareFiles(Array.from(fileInput.files || [])),
  );
  listen(find("dropZone"), "dragover", (event) => event.preventDefault());
  listen(find("dropZone"), "drop", (event) => {
    event.preventDefault();
    if (!fileInput.disabled)
      prepareFiles(Array.from(event.dataTransfer.files || []));
  });

  function compressImage(file, maxWidth, quality) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        try {
          const width = Math.min(img.naturalWidth, maxWidth);
          const height = Math.round(
            (img.naturalHeight * width) / img.naturalWidth,
          );
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const context = canvas.getContext("2d");
          context.imageSmoothingQuality = "high";
          context.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL("image/jpeg", quality));
        } catch (err) {
          reject(err);
        } finally {
          URL.revokeObjectURL(url);
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(
          new Error("Не удалось прочитать фото. Выберите другое изображение."),
        );
      };
      img.src = url;
    });
  }

  listen(find("uploadBtn"), "click", async () => {
    const statusEl = find("uploadStatus");
    const btn = find("uploadBtn");
    if (preparingImages || btn.disabled) return;
    if (!pendingImages.length || !pendingCover) {
      statusEl.textContent = "Выберите изображение";
      statusEl.className = "status-msg err";
      return;
    }
    btn.disabled = true;
    fileInput.disabled = true;
    statusEl.textContent = "Загрузка…";
    statusEl.className = "status-msg";
    try {
      const images = pendingImages;
      const category = uploadCatSelect.value;
      const specs = collectSpecs();
      const { image, thumb, width, height } = pendingCover;
      validateImageDocument({ images });
      const tag = await getNextTag();
      const docRef = itemsCol.doc();
      const imageRevision = crypto.randomUUID();
      const batch = db.batch();
      batch.set(docRef, {
        tag,
        category,
        specs,
        thumb,
        imageCount: images.length,
        coverVersion: CATALOG_COVER_VERSION,
        imageRevision,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
      batch.set(itemImagesCol.doc(docRef.id), { images });
      batch.set(itemCoversCol.doc(docRef.id), {
        image,
        width,
        height,
        imageRevision,
      });
      await batch.commit();
      if (disposed) return;
      statusEl.textContent = `Готово — присвоен ${tag}`;
      statusEl.className = "status-msg ok";
      pendingImages = [];
      pendingCover = null;
      previewThumbs.innerHTML = "";
      updateFileInputMode();
      resetSpecFields();
      fileInput.value = "";
    } catch (err) {
      console.error(err);
      if (!disposed) {
        statusEl.textContent =
          "Не удалось загрузить изделие. Попробуйте ещё раз.";
        statusEl.className = "status-msg err";
      }
    } finally {
      if (!disposed) {
        btn.disabled = false;
        fileInput.disabled = false;
      }
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
    return ALL_ITEMS.filter(
      (item) =>
        item.coverVersion !== CATALOG_COVER_VERSION || !item.imageRevision,
    );
  }

  function renderAdminList() {
    const migrateBox = find("migrateBox");
    migrateBox.style.display =
      optimizing || legacyItems().length ? "block" : "none";

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
          <div class="tag">${escapeHtml(i.tag)}${count > 1 ? ` (${count} фото)` : ""}</div>
          <div class="cat">${escapeHtml(catLabel(i.category))}${(i.specs || []).map((s) => " · " + escapeHtml(s.name) + ": " + escapeHtml(s.value)).join("")}</div>
        </div>
        <button class="del-btn" data-id="${i.id}">Удалить</button>
      </div>
    `;
    }).join("");
    list.querySelectorAll(".del-btn").forEach((b) => {
      listen(b, "click", async () => {
        if (!confirm("Удалить это изделие?")) return;
        b.disabled = true;
        try {
          const batch = db.batch();
          batch.delete(itemsCol.doc(b.dataset.id));
          batch.delete(itemImagesCol.doc(b.dataset.id));
          batch.delete(itemCoversCol.doc(b.dataset.id));
          await batch.commit();
        } catch (err) {
          console.error(err);
          if (!disposed) {
            b.disabled = false;
            alert("Не удалось удалить изделие. Попробуйте ещё раз.");
          }
        }
      });
    });
  }

  /* ---------- ONE-TIME CATALOG COVER OPTIMIZATION ---------- */
  listen(find("migrateBtn"), "click", async () => {
    if (optimizing) return;
    const btn = find("migrateBtn");
    const statusEl = find("migrateStatus");
    const legacy = legacyItems();
    if (!legacy.length) {
      statusEl.textContent = "Все изделия уже оптимизированы.";
      statusEl.className = "status-msg ok";
      return;
    }
    optimizing = true;
    btn.disabled = true;
    let done = 0,
      failed = 0;
    for (const item of legacy) {
      if (disposed) break;
      statusEl.textContent = `Оптимизация ${done + failed + 1} из ${legacy.length}…`;
      statusEl.className = "status-msg";
      try {
        const images = await getFullImages(item);
        if (!images[0]) throw new Error("No original image available");
        const { image, thumb, width, height } = await createCatalogPreview(
          images[0],
        );
        validateImageDocument({ image });
        if (disposed) break;
        const imageRevision = crypto.randomUUID();
        const batch = db.batch();
        batch.set(itemCoversCol.doc(item.id), {
          image,
          width,
          height,
          imageRevision,
        });
        const changes = {
          thumb,
          imageCount: images.length,
          coverVersion: CATALOG_COVER_VERSION,
          imageRevision,
        };
        // Preserve every full-size image; old inline galleries move atomically.
        if (itemImages(item).length) {
          validateImageDocument({ images });
          batch.set(itemImagesCol.doc(item.id), { images });
          changes.images = firebase.firestore.FieldValue.delete();
          changes.image = firebase.firestore.FieldValue.delete();
        }
        batch.update(itemsCol.doc(item.id), changes);
        await batch.commit();
        done++;
      } catch (err) {
        console.error("Cover optimization failed:", item.id, err);
        failed++;
      }
    }
    optimizing = false;
    if (disposed) return;
    statusEl.textContent = failed
      ? `Готово: ${done} оптимизировано, ${failed} с ошибкой. Повторите попытку.`
      : `Готово: оптимизировано ${done} изделий. Исходные фотографии сохранены.`;
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
