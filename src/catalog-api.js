// Requests stay on the site's origin. Vite/Vercel proxy /api to the existing backend.
const API_BASE = (import.meta.env?.VITE_API_BASE_URL || "/api").replace(
  /\/$/,
  "",
);

export class CatalogApiError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.name = "CatalogApiError";
    this.status = status;
  }
}

function imageUrl(value) {
  if (typeof value !== "string" || !value) throw new Error("Invalid image URL");
  const url = new URL(
    value,
    globalThis.location?.origin || "https://furnikatalog.uz",
  );
  if (!["https:", "http:"].includes(url.protocol))
    throw new Error("Invalid image URL");
  return url.href;
}

function normalizeItem(item) {
  if (
    !item ||
    !Number.isSafeInteger(item.id) ||
    item.id <= 0 ||
    typeof item.tag !== "string" ||
    typeof item.category !== "string"
  ) {
    throw new Error("Invalid catalog response");
  }
  const thumb = imageUrl(item.thumb);
  const firstImage = new URL(thumb);
  // This is the layout in the supplied backend's Catalog.create(), not a thumbnail upscale.
  const hasOriginal = /\/items\/[^/]+\/thumb\.jpg$/.test(firstImage.pathname);
  if (hasOriginal)
    firstImage.pathname = firstImage.pathname.replace(/thumb\.jpg$/, "0.jpg");
  return {
    id: String(item.id),
    tag: item.tag,
    category: item.category,
    thumb,
    cover: item.cover
      ? imageUrl(item.cover)
      : hasOriginal
        ? firstImage.href
        : null,
    specs: Array.isArray(item.specs)
      ? item.specs.filter(
          (s) => s && typeof s.name === "string" && typeof s.value === "string",
        )
      : [],
    imageCount:
      Number.isSafeInteger(item.imageCount) && item.imageCount > 0
        ? item.imageCount
        : 0,
    createdAt: typeof item.createdAt === "string" ? item.createdAt : "",
  };
}

export function createCatalogApi(base = API_BASE) {
  let token = null; // Admin credentials never enter localStorage or the client bundle.
  async function request(
    path,
    { method = "GET", body, auth = false, signal } = {},
  ) {
    if (auth && !token)
      throw new CatalogApiError("Войдите в аккаунт администратора.", 401);
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (signal?.aborted) controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    const timeout = setTimeout(
      abort,
      method === "POST" && auth ? 120000 : 30000,
    );
    try {
      const headers = { Accept: "application/json" };
      if (auth) headers.Authorization = `Bearer ${token}`;
      if (body && !(body instanceof FormData))
        headers["Content-Type"] = "application/json";
      const response = await fetch(`${base}${path}`, {
        method,
        body:
          body instanceof FormData
            ? body
            : body
              ? JSON.stringify(body)
              : undefined,
        headers,
        signal: controller.signal,
        cache: "no-store",
        credentials: "omit",
      });
      if (!response.ok) {
        if (response.status === 401 && auth) token = null;
        const messages = {
          400: "Проверьте фотографии и заполненные поля.",
          401: "Неверный пароль или срок входа истёк.",
          403: "Нет доступа к этому действию.",
          404: "Изделие или адрес API не найден.",
          413: "Размер загрузки превышает ограничение сервера.",
          429: "Слишком много запросов. Попробуйте позже.",
        };
        throw new CatalogApiError(
          messages[response.status] ||
            "Ошибка сервера. Не удалось выполнить действие.",
          response.status,
        );
      }
      const text = await response.text();
      if (!text) return null; // Nest's successful DELETE may return an empty 200 response.
      try {
        return JSON.parse(text);
      } catch {
        throw new CatalogApiError(
          "Сервер вернул неверный ответ. Проверьте настройку /api.",
        );
      }
    } catch (error) {
      if (error instanceof CatalogApiError) throw error;
      if (signal?.aborted) throw error;
      throw new CatalogApiError(
        method === "GET"
          ? "Не удалось связаться с сервером. Проверьте соединение."
          : "Связь с сервером прервалась. Проверьте каталог перед повторным действием.",
      );
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
    }
  }
  function itemPath(id) {
    if (!/^[1-9]\d*$/.test(String(id))) throw new Error("Invalid item ID");
    return `/items/${encodeURIComponent(id)}`;
  }
  return {
    get authenticated() {
      return Boolean(token);
    },
    authorize(value) {
      token = value;
    },
    logout() {
      token = null;
    },
    async list(signal) {
      const items = await request("/items", { signal });
      if (!Array.isArray(items)) throw new Error("Invalid catalog response");
      return items.map(normalizeItem);
    },
    async images(id, signal) {
      const images = await request(`${itemPath(id)}/images`, { signal });
      if (!Array.isArray(images)) throw new Error("Invalid gallery response");
      return images.map(imageUrl);
    },
    async login(password, signal) {
      const result = await request("/admin/login", {
        method: "POST",
        body: { password },
        signal,
      });
      if (typeof result?.token !== "string" || !result.token)
        throw new Error("Invalid login response");
      return result.token;
    },
    async create({ category, specs, files }, signal) {
      const body = new FormData();
      body.append("category", category);
      body.append("specs", JSON.stringify(specs));
      for (const file of files) body.append("images", file, file.name);
      return normalizeItem(
        await request("/items", { method: "POST", body, auth: true, signal }),
      );
    },
    async remove(id, signal) {
      await request(itemPath(id), { method: "DELETE", auth: true, signal });
    },
  };
}
