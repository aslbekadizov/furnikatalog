export const CATALOG_COVER_VERSION = 1;

const CACHE_DATABASE = "furni-catalog-covers";
const CACHE_STORE = "covers";
const CACHE_TIMEOUT_MS = 1000;
let databasePromise;

function loadImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => {
      image.onload = null;
      image.onerror = null;
      if (!image.naturalWidth || !image.naturalHeight) {
        reject(new Error("The selected image has no readable dimensions."));
      } else {
        resolve(image);
      }
    };
    image.onerror = () => {
      image.onload = null;
      image.onerror = null;
      reject(new Error("The selected image could not be decoded."));
    };
    image.src = source;
  });
}

function renderCrop(image, maxWidth, quality) {
  const cropWidth = Math.min(image.naturalWidth, (image.naturalHeight * 4) / 3);
  const cropHeight = (cropWidth * 3) / 4;
  // Multiples of four keep the encoded image exactly 4:3 without upscaling.
  const width = Math.floor(Math.min(maxWidth, cropWidth) / 4) * 4;
  const height = (width * 3) / 4;
  if (!width || !height) throw new Error("The selected image is too small.");

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  try {
    const context = canvas.getContext("2d");
    if (!context)
      throw new Error("Image processing is unavailable in this browser.");
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(
      image,
      (image.naturalWidth - cropWidth) / 2,
      (image.naturalHeight - cropHeight) / 2,
      cropWidth,
      cropHeight,
      0,
      0,
      width,
      height,
    );
    let encoded;
    try {
      encoded = canvas.toDataURL("image/webp", quality);
    } catch {
      // Older browsers may throw instead of returning PNG for unsupported WebP.
    }
    if (!encoded?.startsWith("data:image/webp")) {
      encoded = canvas.toDataURL("image/jpeg", quality);
    }
    if (!/^data:image\/(webp|jpeg);/.test(encoded)) {
      throw new Error("The image could not be encoded.");
    }
    return { image: encoded, width, height };
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

export async function createCatalogPreview(source) {
  const isBlob = typeof Blob !== "undefined" && source instanceof Blob;
  if (
    !isBlob &&
    (typeof source !== "string" || !source.startsWith("data:image/"))
  ) {
    throw new TypeError("Select an image file or an image data URL.");
  }
  const objectUrl = isBlob ? URL.createObjectURL(source) : null;
  try {
    const image = await loadImage(objectUrl || source);
    const cover = renderCrop(image, 1440, 0.94);
    const thumbnail = renderCrop(image, 160, 0.78);
    return { ...cover, thumb: thumbnail.image };
  } finally {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}

function openCache() {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve) => {
    let settled = false;
    const finish = (database) => {
      if (settled) {
        database?.close();
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolve(database);
    };
    const timeout = setTimeout(() => finish(null), CACHE_TIMEOUT_MS);
    try {
      if (!globalThis.indexedDB) {
        finish(null);
        return;
      }
      const request = globalThis.indexedDB.open(CACHE_DATABASE, 1);
      request.onupgradeneeded = () => {
        try {
          const database = request.result;
          if (!database.objectStoreNames.contains(CACHE_STORE)) {
            database.createObjectStore(CACHE_STORE, { keyPath: "key" });
          }
        } catch {
          request.transaction?.abort();
          finish(null);
        }
      };
      request.onsuccess = () => {
        const database = request.result;
        database.onversionchange = () => {
          database.close();
          databasePromise = undefined;
        };
        finish(database);
      };
      request.onerror = () => finish(null);
      request.onblocked = () => finish(null);
    } catch {
      finish(null);
    }
  });
  return databasePromise;
}

function validCover(cover) {
  return (
    typeof cover?.image === "string" &&
    cover.image.startsWith("data:image/") &&
    Number.isFinite(cover.width) &&
    cover.width > 0 &&
    Number.isFinite(cover.height) &&
    cover.height > 0
  );
}

async function withCache(mode, operation, fallback) {
  const database = await openCache();
  if (!database) return fallback;
  return new Promise((resolve) => {
    let value = fallback;
    const timeout = setTimeout(() => resolve(fallback), CACHE_TIMEOUT_MS);
    const finish = (result) => {
      clearTimeout(timeout);
      resolve(result);
    };
    try {
      const transaction = database.transaction(CACHE_STORE, mode);
      const request = operation(transaction.objectStore(CACHE_STORE));
      request.onsuccess = () => {
        value = request.result;
      };
      transaction.oncomplete = () => finish(value);
      transaction.onerror = () => finish(fallback);
      transaction.onabort = () => finish(fallback);
    } catch {
      finish(fallback);
    }
  });
}

export async function cacheCatalogCover(key, cover) {
  if (typeof key !== "string" || !key || !validCover(cover)) return false;
  const { image, width, height } = cover;
  const storedKey = await withCache(
    "readwrite",
    (store) => store.put({ key, image, width, height }),
    null,
  );
  return storedKey === key;
}

export async function readCachedCatalogCover(key) {
  if (typeof key !== "string" || !key) return null;
  const cover = await withCache("readonly", (store) => store.get(key), null);
  if (!validCover(cover)) return null;
  return { image: cover.image, width: cover.width, height: cover.height };
}

export async function removeCachedCatalogCover(key) {
  if (typeof key !== "string" || !key) return;
  await withCache("readwrite", (store) => store.delete(key), null);
}
