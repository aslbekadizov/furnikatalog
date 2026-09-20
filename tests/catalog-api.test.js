import assert from "node:assert/strict";
import { test, afterEach } from "node:test";
import { createCatalogApi } from "../src/catalog-api.js";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const raw = {
  id: 27,
  tag: "#M0027",
  category: "kitchen",
  specs: [{ name: "Материал", value: "Дерево" }],
  thumb: "https://images.example/items/uuid/thumb.jpg",
  imageCount: 2,
  createdAt: "2026-09-14T15:58:03.569Z",
};
const json = (value, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });

test("uses numeric backend IDs as DOM-safe strings and full-size cover without requesting gallery", async () => {
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return json([raw]);
  };
  const [item] = await createCatalogApi().list();
  assert.equal(item.id, "27");
  assert.equal(item.cover, "https://images.example/items/uuid/0.jpg");
  assert.equal(item.thumb, raw.thumb);
  assert.deepEqual(item.specs, raw.specs);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/items");
  assert.equal(calls[0].options.cache, "no-store");
  assert.equal(calls[0].options.headers.Authorization, undefined);
});

test("login does not authorize a cancelled UI login until explicitly accepted", async () => {
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "/api/admin/login");
    assert.deepEqual(JSON.parse(options.body), {
      password: "example-password",
    });
    return json({ token: "example-token" });
  };
  const api = createCatalogApi();
  const token = await api.login("example-password");
  assert.equal(api.authenticated, false);
  api.authorize(token);
  assert.equal(api.authenticated, true);
  api.logout();
  assert.equal(api.authenticated, false);
});

test("uploads untouched files with backend multipart field names and Bearer token", async () => {
  const bytes = new Uint8Array([1, 2, 3, 4, 5]);
  const file = new File([bytes], "original.jpg", { type: "image/jpeg" });
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "/api/items");
    assert.equal(options.method, "POST");
    assert.equal(options.headers.Authorization, "Bearer example-token");
    assert.equal(options.headers["Content-Type"], undefined);
    assert.equal(options.body.get("category"), "kitchen");
    assert.deepEqual(JSON.parse(options.body.get("specs")), raw.specs);
    const uploaded = options.body.getAll("images");
    assert.equal(uploaded.length, 1);
    assert.equal(uploaded[0].name, file.name);
    assert.deepEqual(new Uint8Array(await uploaded[0].arrayBuffer()), bytes);
    return json(raw, 201);
  };
  const api = createCatalogApi();
  api.authorize("example-token");
  assert.equal(
    (await api.create({ category: "kitchen", specs: raw.specs, files: [file] }))
      .id,
    "27",
  );
});

test("handles empty successful DELETE and blocks mutation after logout", async () => {
  let calls = 0;
  globalThis.fetch = async (url, options) => {
    calls++;
    assert.equal(url, "/api/items/27");
    assert.equal(options.method, "DELETE");
    return new Response(null, { status: 200 });
  };
  const api = createCatalogApi();
  api.authorize("token");
  await api.remove("27");
  api.logout();
  await assert.rejects(api.remove("27"), { status: 401 });
  assert.equal(calls, 1);
});

test("expired authorization is cleared and can be replaced by a fresh login", async () => {
  globalThis.fetch = async () => json({ message: "Unauthorized" }, 401);
  const api = createCatalogApi();
  api.authorize("expired");
  await assert.rejects(api.remove("27"), { status: 401 });
  assert.equal(api.authenticated, false);
  api.authorize("fresh");
  globalThis.fetch = async () => new Response(null, { status: 204 });
  await api.remove("27");
});

test("surfaces upload size failures without reporting success", async () => {
  globalThis.fetch = async () =>
    new Response("Request too large", { status: 413 });
  const api = createCatalogApi();
  api.authorize("token");
  await assert.rejects(
    api.create({ category: "kitchen", specs: [], files: [] }),
    { status: 413 },
  );
});

test("rejects SPA HTML masquerading as API JSON and invalid image protocols", async () => {
  const api = createCatalogApi();
  globalThis.fetch = async () => new Response("<!doctype html><html></html>");
  await assert.rejects(api.list(), /\/api/);
  globalThis.fetch = async () =>
    json([{ ...raw, thumb: "javascript:alert(1)" }]);
  await assert.rejects(api.list(), /Invalid image URL/);
  globalThis.fetch = async () => json(["javascript:alert(1)"]);
  await assert.rejects(api.images("27"), /Invalid image URL/);
});

test("uses gallery endpoint and rejects invalid IDs before sending requests", async () => {
  let calls = 0;
  globalThis.fetch = async (url) => {
    calls++;
    assert.equal(url, "/api/items/27/images");
    return json(["https://images.example/items/uuid/0.jpg"]);
  };
  const api = createCatalogApi();
  assert.deepEqual(await api.images("27"), [
    "https://images.example/items/uuid/0.jpg",
  ]);
  await assert.rejects(api.images("../admin"), /Invalid item ID/);
  assert.equal(calls, 1);
});

test("network failure on mutation warns to inspect catalog before retrying", async () => {
  globalThis.fetch = async () => {
    throw new TypeError("Network failed");
  };
  const api = createCatalogApi();
  api.authorize("token");
  await assert.rejects(
    api.create({ category: "kitchen", specs: [], files: [] }),
    /Проверьте каталог/,
  );
});

test("request is cancelled on controller disposal", async () => {
  globalThis.fetch = async (_url, { signal }) =>
    new Promise((_resolve, reject) => {
      signal.addEventListener(
        "abort",
        () => reject(new DOMException("Aborted", "AbortError")),
        { once: true },
      );
    });
  const api = createCatalogApi();
  const controller = new AbortController();
  const pending = api.list(controller.signal);
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
});
