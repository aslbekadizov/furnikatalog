import { createCatalogApi } from "./catalog-api.js";

export function initializeCatalog(root) {
  let disposed = false;
  const api = createCatalogApi();
  let loadVersion = 0;
  let catalogLoaded = false;
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

  let ALL_ITEMS = [];
  let activeCategory = "all";
  let activeSearch = "";
  const fullImagesCache = {};
  const fullImagesRequests = new Map();
  const coversCache = new Map();
  const coverRequests = new Map();
  const imageKey = (item) =>
    `${item.id}:${item.thumb}:${item.createdAt}:${item.imageCount}`;
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
    const key = imageKey(item);
    if (fullImagesCache[key]) return fullImagesCache[key];
    if (!fullImagesRequests.has(key)) {
      const request = api
        .images(item.id, events.signal)
        .then((images) => {
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
        // The supplied backend stores the first full-size photo next to thumb.jpg.
        // Never enlarge the 500px admin thumbnail into a catalog cover.
        let source = item.cover;
        const decoded = new Image();
        decoded.decoding = "async";
        try {
          if (!source) throw new Error("No direct cover URL");
          decoded.src = source;
          await decoded.decode();
        } catch {
          const images = await getFullImages(item);
          source = images[0];
          if (!source) throw new Error("No source photo");
          decoded.src = source;
          await decoded.decode();
        }
        const cover = {
          image: source,
          width: decoded.naturalWidth,
          height: decoded.naturalHeight,
        };
        if (!disposed) coversCache.set(key, cover);
        return cover;
      })().finally(() => coverRequests.delete(key));
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
  function applyItems(nextItems) {
    const nextById = new Map(nextItems.map((item) => [item.id, item]));
    ALL_ITEMS.forEach((item) => {
      const next = nextById.get(item.id);
      if (!next || imageKey(next) !== imageKey(item)) {
        delete fullImagesCache[imageKey(item)];
        coversCache.delete(imageKey(item));
      }
    });
    ALL_ITEMS = nextItems;
    catalogLoaded = true;
    find("catalogStatus").textContent = "";
    find("catalogRetry").hidden = true;
    renderGrid();
    if (find("adminPanel").style.display === "block") renderAdminList();
  }

  async function loadItems() {
    const version = ++loadVersion;
    try {
      const items = await api.list(events.signal);
      if (!disposed && version === loadVersion) applyItems(items);
    } catch (error) {
      if (disposed || version !== loadVersion) return;
      find("catalogStatus").textContent =
        "Не удалось обновить каталог. Проверьте соединение и повторите попытку.";
      find("catalogRetry").hidden = false;
      if (!catalogLoaded) find("grid").innerHTML = "";
      console.warn("Catalog request failed:", error);
    }
  }
  listen(find("catalogRetry"), "click", loadItems);
  listen(window, "online", loadItems);
  listen(document, "visibilitychange", () => {
    if (!document.hidden) void loadItems();
  });

  /* ---------- LAZY CATALOG COVERS ---------- */
  const IMG_CONCURRENCY = 5;
  let imgActive = 0;
  const imgQueue = [];
  const queuedImages = new WeakSet();
  let preloadDistance = Math.round(window.innerHeight * 1.5);

  function queueImageLoad(img) {
    if (queuedImages.has(img)) return;
    queuedImages.add(img);
    img.closest(".card-img-wrap").classList.remove("image-error");
    img.closest(".card-img-wrap").classList.add("image-loading");
    imgQueue.push(img);
    pumpImageQueue();
  }

  function pumpImageQueue() {
    while (!disposed && imgActive < IMG_CONCURRENCY && imgQueue.length) {
      const img = imgQueue.shift();
      if (!img.isConnected) {
        queuedImages.delete(img);
        continue;
      }
      const rect = img.getBoundingClientRect();
      if (
        img.loading !== "eager" &&
        (rect.bottom < -preloadDistance ||
          rect.top > window.innerHeight + preloadDistance)
      ) {
        queuedImages.delete(img);
        gridImgObserver.observe(img);
        continue;
      }
      imgActive++;
      loadGridImage(img).finally(() => {
        queuedImages.delete(img);
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
      wrap.classList.remove("image-loading");
      wrap.classList.add("image-error");
      console.warn("Could not load catalog cover:", item.id, err);
    }
  }

  function createGridObserver() {
    return new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            gridImgObserver.unobserve(entry.target);
            queueImageLoad(entry.target);
          }
        });
      },
      { rootMargin: `${preloadDistance}px 0px` },
    );
  }
  let gridImgObserver = createGridObserver();

  function scheduleGridImages() {
    const grid = find("grid");
    const columns =
      getComputedStyle(grid).gridTemplateColumns.split(/\s+/).filter(Boolean)
        .length || 1;
    grid.querySelectorAll(".card-img").forEach((img, index) => {
      // Start the actual first row even while the visitor is still in the intro.
      img.loading = index < columns ? "eager" : "lazy";
      if (img.src !== placeholder || queuedImages.has(img)) return;
      if (index < columns) queueImageLoad(img);
      else gridImgObserver.observe(img);
    });
  }
  listen(window, "resize", () => {
    preloadDistance = Math.round(window.innerHeight * 1.5);
    gridImgObserver.disconnect();
    gridImgObserver = createGridObserver();
    scheduleGridImages();
  });

  function renderGrid() {
    const grid = find("grid");
    gridImgObserver.disconnect();
    imgQueue.forEach((img) => queuedImages.delete(img));
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
            <img class="card-img" data-item-id="${item.id}" src="${escapeHtml(cached?.image || placeholder)}" alt="${escapeHtml(item.tag)}" width="1440" height="1080" loading="lazy" decoding="async">
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
    scheduleGridImages();
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

  /* ---------- SERVER ADMIN LOGIN ---------- */
  const loginDialog = find("adminLogin");
  function showAdmin() {
    app.style.display = "none";
    find("adminPanel").style.display = "block";
    renderAdminList();
  }
  function showLogin() {
    find("loginStatus").textContent = "";
    if (!loginDialog.open) loginDialog.showModal();
    find("adminPassword").focus();
  }
  function handleAuthError(error) {
    if (error.status !== 401) return;
    api.logout();
    find("adminPanel").style.display = "none";
    app.style.display = "block";
    showLogin();
    find("loginStatus").textContent = "Сессия истекла. Войдите снова.";
  }
  listen(find("openAdmin"), "click", () => {
    if (api.authenticated) showAdmin();
    else showLogin();
  });
  let loginVersion = 0;
  listen(loginDialog, "close", () => {
    loginVersion++;
    find("adminPassword").value = "";
    find("loginSubmit").disabled = false;
  });
  listen(loginDialog, "cancel", () => {
    loginVersion++;
  });
  listen(find("loginCancel"), "click", () => {
    loginVersion++;
    loginDialog.close();
  });
  listen(find("loginForm"), "submit", async (event) => {
    event.preventDefault();
    const button = find("loginSubmit");
    if (button.disabled) return;
    const version = ++loginVersion;
    button.disabled = true;
    find("loginStatus").textContent = "Вход…";
    try {
      const token = await api.login(find("adminPassword").value, events.signal);
      if (disposed || version !== loginVersion || !loginDialog.open) return;
      api.authorize(token);
      loginDialog.close();
      showAdmin();
    } catch (error) {
      if (!disposed && version === loginVersion)
        find("loginStatus").textContent =
          error.status === 401 ? "Неверный пароль" : error.message;
    } finally {
      if (!disposed && version === loginVersion) button.disabled = false;
    }
  });
  listen(find("closeAdmin"), "click", () => {
    find("adminPanel").style.display = "none";
    app.style.display = "block";
  });
  listen(find("logoutAdmin"), "click", () => {
    api.logout();
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

  /* ---------- ORIGINAL FILE UPLOAD ---------- */
  let pendingFiles = [];
  let previewUrls = [];
  let selectionVersion = 0;
  let preparingImages = false;
  const uploadCatSelect = find("uploadCat");
  const fileInput = find("fileInput");
  const previewThumbs = find("previewThumbs");
  const dropLabel = find("dropLabel");

  function updateFileInputMode() {
    fileInput.multiple = true;
    dropLabel.textContent =
      "Нажмите или перетащите изображения сюда (до 20 фото, до 15 МБ каждое)";
  }
  function clearPreviews() {
    previewUrls.forEach((url) => URL.revokeObjectURL(url));
    previewUrls = [];
    previewThumbs.innerHTML = "";
  }
  async function prepareFiles(files) {
    const version = ++selectionVersion;
    pendingFiles = [];
    clearPreviews();
    const status = find("uploadStatus");
    status.textContent = "";
    status.className = "status-msg";
    preparingImages = true;
    find("uploadBtn").disabled = true;
    const urls = [];
    try {
      if (files.length > 20)
        throw new Error("Выберите не больше 20 фотографий.");
      for (const file of files) {
        if (file.size > 15 * 1024 * 1024)
          throw new Error("Каждое фото должно быть не больше 15 МБ.");
        if (file.type && !file.type.startsWith("image/"))
          throw new Error("Выберите файлы изображений.");
        const url = URL.createObjectURL(file);
        urls.push(url);
        const image = new Image();
        image.src = url;
        try {
          await image.decode();
        } catch {
          throw new Error(
            "Не удалось прочитать фото. Выберите другое изображение.",
          );
        }
        if (disposed || version !== selectionVersion) return;
      }
      pendingFiles = files;
      previewUrls = urls;
      previewThumbs.innerHTML = urls
        .map((url) => `<img src="${escapeHtml(url)}" alt="Выбранное фото">`)
        .join("");
      if (files.length)
        dropLabel.textContent =
          files.length === 1 ? files[0].name : `${files.length} файлов выбрано`;
      else updateFileInputMode();
    } catch (error) {
      if (disposed || version !== selectionVersion) return;
      status.textContent = error.message;
      status.className = "status-msg err";
      updateFileInputMode();
    } finally {
      if (previewUrls !== urls) urls.forEach((url) => URL.revokeObjectURL(url));
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
      void prepareFiles(Array.from(event.dataTransfer.files || []));
  });
  listen(find("uploadBtn"), "click", async () => {
    const statusEl = find("uploadStatus");
    const btn = find("uploadBtn");
    if (preparingImages || btn.disabled) return;
    if (!pendingFiles.length) {
      statusEl.textContent = "Выберите изображение";
      statusEl.className = "status-msg err";
      return;
    }
    const specs = collectSpecs();
    if (
      specs.length > 20 ||
      specs.some(
        (s) =>
          !s.name || !s.value || s.name.length > 120 || s.value.length > 300,
      )
    ) {
      statusEl.textContent =
        "Заполните название и значение каждой характеристики (до 20 строк, 120 и 300 символов).";
      statusEl.className = "status-msg err";
      return;
    }
    btn.disabled = true;
    fileInput.disabled = true;
    statusEl.textContent = "Загрузка…";
    statusEl.className = "status-msg";
    try {
      const item = await api.create(
        { category: uploadCatSelect.value, specs, files: pendingFiles },
        events.signal,
      );
      if (disposed) return;
      // Apply the successful mutation directly; a failed refresh must not invite duplicate uploads.
      loadVersion++;
      applyItems([item, ...ALL_ITEMS.filter((entry) => entry.id !== item.id)]);
      statusEl.textContent = `Готово — присвоен ${item.tag}`;
      statusEl.className = "status-msg ok";
      pendingFiles = [];
      clearPreviews();
      updateFileInputMode();
      resetSpecFields();
      fileInput.value = "";
    } catch (error) {
      if (!disposed) {
        statusEl.textContent = error.message;
        statusEl.className = "status-msg err";
        handleAuthError(error);
      }
    } finally {
      if (!disposed) {
        btn.disabled = false;
        fileInput.disabled = false;
      }
    }
  });

  /* ---------- ADMIN LIST + DELETE ---------- */
  function renderAdminList() {
    const list = find("adminList");
    if (ALL_ITEMS.length === 0) {
      list.innerHTML = `<div class="empty">Пока нет изделий</div>`;
      return;
    }
    list.innerHTML = ALL_ITEMS.map((i) => {
      const count = itemImageCount(i);
      return `
      <div class="admin-list-row">
        <img src="${escapeHtml(itemThumbSrc(i))}" alt="" loading="lazy" decoding="async">
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
          await api.remove(b.dataset.id, events.signal);
          if (disposed) return;
          loadVersion++;
          if (currentLightboxId === b.dataset.id) closeLightbox();
          applyItems(ALL_ITEMS.filter((item) => item.id !== b.dataset.id));
        } catch (err) {
          console.error(err);
          if (!disposed) {
            b.disabled = false;
            alert(err.message);
            handleAuthError(err);
          }
        }
      });
    });
  }

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
    loadVersion++;
    loginVersion++;
    api.logout();
    loginDialog.close();
    clearPreviews();
    gridImgObserver.disconnect();
    imgQueue.length = 0;
    frames.forEach(cancelAnimationFrame);
    timers.forEach(clearTimeout);
    resetLightboxZoom?.();
    document.documentElement.style.overflow = initialHtmlOverflow;
    document.body.style.overflow = initialBodyOverflow;
  };
}
