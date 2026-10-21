var _a, _b;
(function polyfill() {
  const relList = document.createElement("link").relList;
  if (relList && relList.supports && relList.supports("modulepreload")) return;
  for (const link of document.querySelectorAll('link[rel="modulepreload"]')) processPreload(link);
  new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type !== "childList") continue;
      for (const node of mutation.addedNodes) if (node.tagName === "LINK" && node.rel === "modulepreload") processPreload(node);
    }
  }).observe(document, {
    childList: true,
    subtree: true
  });
  function getFetchOpts(link) {
    const fetchOpts = {};
    if (link.integrity) fetchOpts.integrity = link.integrity;
    if (link.referrerPolicy) fetchOpts.referrerPolicy = link.referrerPolicy;
    if (link.crossOrigin === "use-credentials") fetchOpts.credentials = "include";
    else if (link.crossOrigin === "anonymous") fetchOpts.credentials = "omit";
    else fetchOpts.credentials = "same-origin";
    return fetchOpts;
  }
  function processPreload(link) {
    if (link.ep) return;
    link.ep = true;
    const fetchOpts = getFetchOpts(link);
    fetch(link.href, fetchOpts);
  }
})();
function createEventBus() {
  const target = new EventTarget();
  return {
    emit(type, detail) {
      target.dispatchEvent(new CustomEvent(type, { detail }));
    },
    on(type, listener, signal) {
      const handler = (event) => listener(event.detail);
      const off = () => target.removeEventListener(type, handler);
      if (!(signal == null ? void 0 : signal.aborted)) {
        target.addEventListener(type, handler);
        signal == null ? void 0 : signal.addEventListener("abort", off, { once: true });
      }
      return () => {
        off();
        signal == null ? void 0 : signal.removeEventListener("abort", off);
      };
    }
  };
}
const appEvents = createEventBus();
class Preferences {
  constructor(storage2) {
    this.storage = storage2;
  }
  getItem(key) {
    return this.storage().getItem(key);
  }
  setItem(key, value) {
    try {
      this.storage().setItem(key, String(value));
    } catch (error) {
      appEvents.emit("preferences:error", { key, message: "浏览器未能保存设置，本次修改不会在刷新后保留。" });
      throw error;
    }
  }
  removeItem(key) {
    this.storage().removeItem(key);
  }
  get(key, fallback) {
    try {
      const raw = this.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  }
  set(key, value) {
    this.setItem(key, JSON.stringify(value));
  }
}
const preferences = new Preferences(() => globalThis.localStorage);
const sessionPreferences = new Preferences(() => globalThis.sessionStorage);
let typographyService;
function initialize$r() {
  "use strict";
  const key = "localdns-typography-v1", root = document.documentElement;
  const defaults = { heading: "serif", numeral: "serif", body: "plex" };
  const families = {
    heading: { serif: "'Noto Serif SC','Songti SC','SimSun',serif", sans: "'Noto Sans SC','IBM Plex Sans','Microsoft YaHei',sans-serif", system: "system-ui,'Microsoft YaHei',sans-serif" },
    numeral: { serif: "'Instrument Serif','Times New Roman',serif", sans: "'IBM Plex Sans',sans-serif", mono: "'IBM Plex Mono',Consolas,monospace" },
    body: { plex: "'IBM Plex Sans','Noto Sans SC',-apple-system,BlinkMacSystemFont,sans-serif", noto: "'Noto Sans SC','IBM Plex Sans',sans-serif", system: "system-ui,'Microsoft YaHei',sans-serif" }
  };
  const isUploaded = (key2) => typeof key2 === "string" && /^up[a-z0-9_-]+$/i.test(key2);
  function normalize(value) {
    return Object.fromEntries(Object.keys(defaults).map((role) => [role, Object.hasOwn(families[role], value == null ? void 0 : value[role]) || isUploaded(value == null ? void 0 : value[role]) ? value[role] : defaults[role]]));
  }
  function read() {
    try {
      return normalize(JSON.parse(preferences.getItem(key) || "null"));
    } catch {
      return { ...defaults };
    }
  }
  let current = read(), bound = false;
  const family = (role) => families[role][current[role]] || families[role][defaults[role]];
  function apply3(value) {
    current = normalize(value);
    root.style.setProperty("--font-heading", family("heading"));
    root.style.setProperty("--font-numeral", family("numeral"));
    root.style.setProperty("--font-sans", family("body"));
    root.dataset.numeral = current.numeral;
    if (window.Chart) {
      window.Chart.defaults.font.family = family("body");
      Object.values(window.Chart.instances || {}).forEach((chart2) => chart2.update("none"));
    }
    sync();
    window.dispatchEvent(new Event("localdns-font-selection"));
  }
  function save() {
    const status = document.querySelector("#typography-save-status");
    try {
      preferences.setItem(key, JSON.stringify(current));
      if (status) {
        status.textContent = "已应用到当前浏览器；导出共享配置后可同步到其他设备。";
        status.dataset.state = "saved";
      }
    } catch {
      if (status) {
        status.textContent = "字体已预览，但浏览器禁止保存；刷新后将恢复原设置。";
        status.dataset.state = "error";
      }
    }
  }
  function registerFonts(fonts) {
    var _a2;
    for (const role of Object.keys(defaults)) {
      for (const id of Object.keys(families[role])) if (isUploaded(id)) delete families[role][id];
      const input = document.querySelector("#font-" + role);
      (_a2 = input == null ? void 0 : input.querySelector("[data-uploaded-fonts]")) == null ? void 0 : _a2.remove();
      const group = document.createElement("optgroup");
      group.label = "已上传字体";
      group.dataset.uploadedFonts = "";
      for (const font of fonts) {
        if (!isUploaded(font.id)) continue;
        families[role][font.id] = `'LocalDNSUploaded_${font.id}', ${families[role][defaults[role]]}`;
        const option = document.createElement("option");
        option.value = font.id;
        option.textContent = font.name;
        group.append(option);
      }
      if (group.children.length) input == null ? void 0 : input.append(group);
    }
    for (const role of Object.keys(defaults)) if (isUploaded(current[role]) && !Object.hasOwn(families[role], current[role])) current[role] = defaults[role];
    apply3(current);
  }
  function forgetFont(id) {
    const next = { ...current };
    let changed = false;
    for (const role of Object.keys(defaults)) if (next[role] === id) {
      next[role] = defaults[role];
      changed = true;
    }
    if (changed) {
      apply3(next);
      save();
    }
  }
  function sync() {
    for (const role of Object.keys(defaults)) {
      const input = document.querySelector("#font-" + role);
      if (input) input.value = current[role];
    }
  }
  apply3(current);
  document.addEventListener("keydown", (event) => {
    if (["Tab", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) root.dataset.inputModality = "keyboard";
  }, true);
  document.addEventListener("pointerdown", () => {
    root.dataset.inputModality = "pointer";
  }, true);
  function setup() {
    var _a2;
    if (bound) return;
    bound = true;
    sync();
    const status = document.querySelector("#typography-save-status");
    function choose(value) {
      apply3(value);
      save();
    }
    for (const role of Object.keys(defaults)) (_a2 = document.querySelector("#font-" + role)) == null ? void 0 : _a2.addEventListener("change", (event) => choose({ ...current, [role]: event.target.value }));
    window.addEventListener("storage", (event) => {
      if (event.key === key) apply3(read());
    });
  }
  const sharedReady = sharedUIService.ready.then((config) => {
    let override = false;
    try {
      override = preferences.getItem(key) !== null;
    } catch {
    }
    if (!override) {
      current = normalize(config.typography);
      apply3(current);
      const status = document.querySelector("#typography-save-status");
      if (status) status.textContent = "正在使用服务器共享字体设置。";
    }
  });
  typographyService = { setup, registerFonts, forgetFont, sharedReady, getSelection: () => ({ ...current }) };
}
let identityService;
function initialize$q() {
  "use strict";
  const key = "localdns-identity-v1";
  const defaultProxyLogo = "assets/img/proxy-panel.svg";
  function name(value, fallback) {
    const text2 = String(value ?? "").trim();
    if (text2.length > 32 || [...text2].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) throw new Error("名称最多 32 个字符，请勿使用换行或控制字符。");
    return text2 || fallback;
  }
  function logo(value) {
    const text2 = String(value ?? "").trim();
    if (!text2) return "";
    if (text2.startsWith("custom/assets/")) return sharedUIService.asset(text2);
    if (/^data:image\/(png|jpeg|webp|gif);base64,[a-z0-9+/=]+$/i.test(text2) && text2.length <= 5e5) return text2;
    if (text2.length > 4096) throw new Error("Logo 地址过长，请上传图片。");
    let url;
    try {
      url = new URL(text2);
    } catch {
      throw new Error("Logo 请使用完整的 http:// 或 https:// 图片地址，或上传图片。");
    }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("Logo 请使用不含账号密码的 HTTP(S) 图片地址。");
    return url.href;
  }
  function image(source) {
    return new Promise((resolve, reject) => {
      const img = new Image(), timer = setTimeout(() => {
        img.src = "";
        reject(new Error("Logo 加载超时，请检查图片地址。"));
      }, 1e4);
      img.onload = () => {
        clearTimeout(timer);
        if (!img.naturalWidth || !img.naturalHeight) reject(new Error("图片没有有效尺寸。"));
        else resolve(img);
      };
      img.onerror = () => {
        clearTimeout(timer);
        reject(new Error("Logo 无法读取，请选择有效图片或检查图片地址。"));
      };
      img.src = source;
    });
  }
  async function upload(file) {
    if (!file || file.size > 2 * 1024 * 1024) throw new Error("请选择不超过 2 MB 的 PNG、JPG、WebP、GIF 或 SVG 图片。");
    const url = URL.createObjectURL(file);
    try {
      const img = await image(url), scale = Math.min(1, 256 / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      return logo(canvas.toDataURL("image/png"));
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  function setImage(element, source, fallback) {
    if (!element) return;
    if (element.getAttribute("src") !== source) element.src = source;
    element.onerror = () => {
      element.onerror = null;
      element.src = fallback;
    };
  }
  async function loadSection(section) {
    return { value: await sharedUIService.section(section), revision: "browser" };
  }
  async function saveSection(section, value) {
    sharedUIService.save(section, value);
    return { value, revision: "browser", saved: true };
  }
  const defaults = { name: "LocalDNS", logo: "" };
  function read() {
    try {
      const value = JSON.parse(preferences.getItem(key));
      return { name: name(value == null ? void 0 : value.name, defaults.name), logo: logo(value == null ? void 0 : value.logo) };
    } catch {
      return { ...defaults };
    }
  }
  let current = read();
  const defaultLogo = () => "assets/img/" + (document.documentElement.dataset.theme === "light-glass" ? "logo-04-light" : "logo-08-dark") + ".png?v=20261015-2";
  function apply3() {
    const fallback = defaultLogo();
    setImage(document.querySelector("#brand-mark"), current.logo || fallback, fallback);
    for (const element of document.querySelectorAll(".brand-name,[data-localdns-name]")) {
      if (element.textContent !== current.name) element.textContent = current.name;
      element.title = current.name;
    }
    document.title = current.name + " 控制台";
    const favicon = document.querySelector("#dynamic-favicon");
    if (favicon) {
      favicon.removeAttribute("type");
      const source = current.logo || fallback;
      if (favicon.getAttribute("href") !== source) favicon.href = source;
    }
    const restart = document.querySelector("#restart-button");
    if (restart) {
      restart.title = "重启 " + current.name;
      restart.setAttribute("aria-label", restart.title);
    }
    const sidebar = document.querySelector("#sidebar-status strong");
    if (sidebar) sidebar.textContent = current.name + (document.querySelector("#sidebar-status .offline") ? " 连接异常" : " 运行正常");
  }
  function setup() {
    const field = document.querySelector("#identity-name"), url = document.querySelector("#identity-logo-url"), file = document.querySelector("#identity-logo-file");
    if (!field) return;
    const status = document.querySelector("#identity-status"), preview = document.querySelector("#identity-preview");
    let uploaded = "", loading = false, generation = 0;
    const show = (message, error = false) => {
      status.textContent = message;
      status.dataset.state = error ? "error" : "saved";
    };
    function syncFields() {
      field.value = current.name;
      url.value = current.logo.startsWith("data:") ? "" : current.logo;
      uploaded = current.logo.startsWith("data:") ? current.logo : "";
      file.value = "";
      setImage(preview, current.logo || defaultLogo(), defaultLogo());
    }
    let revision = "", ready = false;
    const saveButton = document.querySelector("#identity-save"), resetButton = document.querySelector("#identity-reset"), retryButton = document.querySelector("#identity-retry");
    const enable = (value) => {
      for (const item of [field, url, file, saveButton, resetButton]) item.disabled = !value;
    };
    let legacy = null;
    try {
      const raw = JSON.parse(preferences.getItem(key) || "null");
      if (raw) legacy = { name: name(raw.name, defaults.name), logo: logo(raw.logo) };
    } catch {
    }
    async function refresh() {
      enable(false);
      show("正在读取共享配置…");
      retryButton.hidden = true;
      try {
        const result = await loadSection("localdns", legacy, key);
        current = result.value ? { name: name(result.value.name, defaults.name), logo: logo(result.value.logo) } : { ...defaults };
        revision = result.revision;
        ready = true;
        apply3();
        syncFields();
        show(sharedUIService.hasOverride("localdns") ? "正在使用本机设置；导出后可共享到其他设备。" : "正在跟随服务器共享配置。");
      } catch (error) {
        ready = false;
        show(error.message, true);
        retryButton.hidden = false;
      } finally {
        enable(ready);
      }
    }
    syncFields();
    apply3();
    refresh();
    retryButton.onclick = refresh;
    file.onchange = async () => {
      const selected = file.files[0];
      if (!selected) return;
      const id = ++generation;
      loading = true;
      show("正在读取 Logo…");
      try {
        const result = await upload(selected);
        if (id !== generation) return;
        uploaded = result;
        url.value = "";
        setImage(preview, result, defaultLogo());
        show("Logo 已选取，点击保存名称与 Logo。");
      } catch (error) {
        if (id === generation) show(error.message, true);
      } finally {
        if (id === generation) loading = false;
      }
    };
    url.oninput = () => {
      ++generation;
      loading = false;
      uploaded = "";
      file.value = "";
    };
    saveButton.onclick = async () => {
      if (!ready) return;
      if (loading) {
        show("Logo 正在读取，请稍候。");
        return;
      }
      enable(false);
      const version = generation;
      try {
        const next = { name: name(field.value, defaults.name), logo: logo(uploaded || url.value) };
        if (next.logo) await image(next.logo);
        if (version !== generation) return;
        const result = await saveSection("localdns", next, revision);
        current = result.value;
        revision = result.revision;
        apply3();
        syncFields();
        show("已应用到当前浏览器；点击下方“导出共享配置”同步到服务器。");
      } catch (error) {
        show(error.message, true);
        retryButton.hidden = false;
      } finally {
        enable(ready);
      }
    };
    resetButton.onclick = async () => {
      if (!ready) return;
      enable(false);
      ++generation;
      loading = false;
      try {
        const result = await saveSection("localdns", { ...defaults }, revision);
        current = result.value;
        revision = result.revision;
        apply3();
        syncFields();
        show("默认名称与 Logo 已应用到当前浏览器。");
      } catch (error) {
        show(error.message, true);
        retryButton.hidden = false;
      } finally {
        enable(ready);
      }
    };
  }
  identityService = { apply: apply3, name, logo, upload, image, setImage, defaultProxyLogo, loadSection, saveSection, getValue: () => ({ ...current }), getName: () => current.name };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", setup, { once: true });
  else setup();
}
class AppearanceRepository {
  constructor(factory = () => globalThis.indexedDB) {
    this.factory = factory;
  }
  transaction(mode, keys, value) {
    return new Promise((resolve, reject) => {
      let settled = false, database, transaction;
      const result = {};
      const finish = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        database == null ? void 0 : database.close();
        if (error) reject(error);
        else resolve(result);
      };
      const timer = setTimeout(() => {
        try {
          transaction == null ? void 0 : transaction.abort();
        } catch {
        }
        finish(new Error("浏览器存储响应超时"));
      }, 8e3);
      let request2;
      try {
        request2 = this.factory().open("localdns-appearance", 1);
      } catch (error) {
        finish(error);
        return;
      }
      request2.onupgradeneeded = () => {
        if (!request2.result.objectStoreNames.contains("settings")) request2.result.createObjectStore("settings");
      };
      request2.onerror = () => finish(request2.error);
      request2.onblocked = () => finish(new Error("请关闭其他 LocalDNS 标签页后重试"));
      request2.onsuccess = () => {
        database = request2.result;
        if (settled) {
          database.close();
          return;
        }
        try {
          transaction = database.transaction("settings", mode);
          const store = transaction.objectStore("settings");
          for (const key of keys) {
            const operation = mode === "readonly" ? store.get(key) : store.put(value, key);
            operation.onsuccess = () => {
              result[key] = operation.result;
            };
          }
          transaction.oncomplete = () => finish();
          transaction.onabort = () => finish((transaction == null ? void 0 : transaction.error) || new Error("浏览器未能保存设置"));
          transaction.onerror = () => {
          };
        } catch (error) {
          finish(error);
        }
      };
    });
  }
  read(keys) {
    return this.transaction("readonly", keys);
  }
  async write(key, value) {
    await this.transaction("readwrite", [key], value);
  }
}
const appearanceRepository = new AppearanceRepository();
class ApiError extends Error {
  constructor(message, status = 0, body = null, code = "http") {
    super(message);
    this.status = status;
    this.body = body;
    this.code = code;
    this.name = "ApiError";
  }
}
function throwIfAborted(signal) {
  if (signal.aborted) throw signal.reason || new DOMException("Request cancelled", "AbortError");
}
class HttpClient {
  constructor(options = {}) {
    this.options = options;
  }
  url(path) {
    if (path instanceof URL || /^(?:https?:|data:|blob:)/i.test(String(path))) return String(path);
    return `${this.options.base || ""}${path}`;
  }
  async run(path, options, read) {
    var _a2, _b2;
    const controller = new AbortController();
    const signal = options.signal || (String(options.method || "GET").toUpperCase() === "GET" ? (_b2 = (_a2 = this.options).signal) == null ? void 0 : _b2.call(_a2) : void 0);
    const forward = () => controller.abort(signal == null ? void 0 : signal.reason);
    if (signal == null ? void 0 : signal.aborted) forward();
    else signal == null ? void 0 : signal.addEventListener("abort", forward, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.options.timeout ?? 1e4);
    try {
      throwIfAborted(controller.signal);
      const response = await (this.options.fetch || globalThis.fetch)(this.url(path), { ...options, signal: controller.signal });
      const value = await read(response);
      throwIfAborted(controller.signal);
      return value;
    } catch (error) {
      if (signal == null ? void 0 : signal.aborted) throw signal.reason || new DOMException("Request cancelled", "AbortError");
      if (timedOut) throw new ApiError("请求超时，请重试。", 0, null, "timeout");
      if (error instanceof ApiError) throw error;
      if (error instanceof SyntaxError) throw new ApiError("服务器返回了无效的 JSON。", 0, null, "invalid-json");
      if (error instanceof Error && error.name === "AbortError") throw error;
      throw new ApiError(error instanceof Error ? error.message : "网络请求失败。", 0, null, "network");
    } finally {
      clearTimeout(timer);
      signal == null ? void 0 : signal.removeEventListener("abort", forward);
    }
  }
  request(path, options = {}) {
    return this.run(path, options, async (response) => {
      const body = response.status === 204 ? null : /(?:application\/json|\+json)/i.test(response.headers.get("content-type") || "") ? await response.json() : await response.text();
      if (!response.ok) {
        const message = body && typeof body === "object" && "error" in body ? String(body.error) : typeof body === "string" && body ? body : `HTTP ${response.status}`;
        throw new ApiError(message, response.status, body);
      }
      return body;
    });
  }
  // Buffer while the timeout and cancellation handlers are still attached.
  // Asset callers retain Response APIs and their existing status handling.
  fetch(path, options = {}) {
    return this.run(path, options, async (response) => {
      const body = [204, 205, 304].includes(response.status) ? null : await response.arrayBuffer();
      return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
    });
  }
}
class CleanupScope {
  constructor() {
    this.controller = new AbortController();
    this.cleanups = /* @__PURE__ */ new Set();
  }
  get signal() {
    return this.controller.signal;
  }
  add(cleanup) {
    if (this.signal.aborted) {
      cleanup();
      return () => {
      };
    }
    this.cleanups.add(cleanup);
    return () => {
      if (this.cleanups.delete(cleanup)) cleanup();
    };
  }
  listen(target, event, listener, options) {
    target.addEventListener(event, listener, options);
    return this.add(() => target.removeEventListener(event, listener, options));
  }
  timeout(callback, delay) {
    const timer = setTimeout(() => {
      release();
      if (!this.signal.aborted) callback();
    }, delay);
    const release = this.add(() => clearTimeout(timer));
    return release;
  }
  interval(callback, delay) {
    const timer = setInterval(() => {
      if (!this.signal.aborted) callback();
    }, delay);
    return this.add(() => clearInterval(timer));
  }
  async guard(promise) {
    throwIfAborted(this.signal);
    const result = await promise;
    throwIfAborted(this.signal);
    return result;
  }
  dispose() {
    if (this.signal.aborted) return;
    this.controller.abort();
    for (const cleanup of [...this.cleanups].reverse()) {
      try {
        cleanup();
      } catch {
      }
    }
    this.cleanups.clear();
  }
}
let active$1 = new CleanupScope();
function currentScope() {
  return active$1;
}
function beginRoute() {
  active$1.dispose();
  active$1 = new CleanupScope();
  return active$1;
}
const assetHttp = new HttpClient();
const backendHttp = new HttpClient({
  base: String(((_a = globalThis.LOCALDNS_UI_CONFIG) == null ? void 0 : _a.apiBase) || "").replace(/\/$/, ""),
  timeout: ((_b = globalThis.LOCALDNS_UI_CONFIG) == null ? void 0 : _b.requestTimeout) || 1e4,
  signal: () => currentScope().signal
});
let fontsService;
function initialize$p() {
  "use strict";
  const typography = typographyService;
  const input = document.querySelector("#input-font-upload");
  const button = document.querySelector("#btn-font-upload");
  const list = document.querySelector("#font-upload-list");
  const hint = document.querySelector("#val-font-upload");
  if (!typography || !input || !button || !list || !hint) return;
  let records = [], faces = /* @__PURE__ */ new Map(), pending = /* @__PURE__ */ new Map(), ready = false, busy = false;
  const message = (text2) => {
    hint.textContent = text2;
  };
  function storage2(mode, value) {
    return mode === "readonly" ? appearanceRepository.read(["fonts"]).then((values) => values.fonts) : appearanceRepository.write("fonts", value);
  }
  function setBusy(value) {
    busy = value;
    button.disabled = value;
    input.disabled = value;
    list.querySelectorAll("button").forEach((item) => {
      item.disabled = value;
    });
  }
  function render() {
    typography.registerFonts(records.filter((record2) => record2.shared || faces.has(record2.id)));
    list.replaceChildren();
    list.hidden = !records.length;
    for (const record2 of records) {
      const row = document.createElement("div");
      row.className = "bcp-font-item";
      const name = document.createElement("span");
      name.className = "bcp-font-name";
      name.textContent = record2.name;
      name.title = record2.name;
      const size = document.createElement("span");
      size.className = "bcp-font-size";
      size.textContent = record2.shared ? `服务器 · ${(record2.size / 1048576).toFixed(1)} MB` : faces.has(record2.id) ? `${(record2.size / 1048576).toFixed(1)} MB` : "无法加载";
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "bcp-font-del";
      remove.textContent = "移除";
      remove.setAttribute("aria-label", `移除 ${record2.name}`);
      remove.disabled = busy;
      remove.addEventListener("click", () => removeFont(record2.id));
      if (record2.shared) {
        row.append(name, size);
      } else row.append(name, size, remove);
      list.append(row);
    }
    message(records.length ? `${records.length} 个字体` : "未上传");
  }
  async function load() {
    if (busy) return;
    setBusy(true);
    try {
      await typography.sharedReady;
      const shared = sharedUIService.config.fonts;
      let saved;
      try {
        saved = await storage2("readonly");
      } catch (error) {
        if (!shared.length) throw error;
        message("本机字体暂时无法读取，服务器字体仍可使用。");
      }
      records = Array.isArray(saved) ? saved.filter((record2) => record2 && /^up[a-z0-9_-]+$/i.test(record2.id) && record2.data instanceof ArrayBuffer) : [];
      let failed = 0;
      for (const record2 of records) {
        record2.name = String(record2.name || "自定义字体");
        record2.size = record2.data.byteLength;
        try {
          const face = new FontFace(`LocalDNSUploaded_${record2.id}`, record2.data);
          await face.load();
          document.fonts.add(face);
          faces.set(record2.id, face);
        } catch {
          failed++;
        }
      }
      records = [...shared, ...records.filter((record2) => !shared.some((font) => font.id === record2.id))];
      ready = true;
      button.textContent = "选择本机字体…";
      render();
      loadSelected();
      if (failed) message(`${failed} 个字体无法加载，暂用默认字体；可移除后重新上传。`);
    } catch {
      message("字体读取失败，请点击重新读取；原有设置未更改。");
      button.textContent = "重新读取字体";
    } finally {
      setBusy(false);
    }
  }
  async function upload(files) {
    var _a2;
    if (!ready || busy) return;
    setBusy(true);
    message("正在检查并保存字体…");
    const additions = [], loaded = /* @__PURE__ */ new Map(), failures = [];
    try {
      for (const file of files) {
        try {
          if (!/\.(ttf|otf|woff2?)$/i.test(file.name)) throw new Error("仅支持 ttf、otf、woff、woff2");
          if (!file.size || file.size > 64 * 1048576) throw new Error("单个文件需大于 0 且不超过 64 MB");
          if (records.concat(additions).reduce((sum, record2) => sum + record2.size, 0) + file.size > 128 * 1048576) throw new Error("字体总量不能超过 128 MB");
          const id = "up" + (((_a2 = crypto.randomUUID) == null ? void 0 : _a2.call(crypto).replaceAll("-", "")) || Date.now().toString(36) + Math.random().toString(36).slice(2)), data = await file.arrayBuffer();
          const face = new FontFace(`LocalDNSUploaded_${id}`, data);
          await face.load();
          additions.push({ id, name: file.name, size: file.size, data });
          loaded.set(id, face);
        } catch (error) {
          failures.push(`${file.name}：${error.message}`);
        }
      }
      if (additions.length) {
        await storage2("readwrite", records.filter((record2) => !record2.shared).concat(additions));
        for (const [id, face] of loaded) {
          document.fonts.add(face);
          faces.set(id, face);
        }
        records.push(...additions);
        render();
      }
      message(failures.length ? failures.join("；") : "字体已保存到当前浏览器；选择用途后可导出共享配置。");
    } catch {
      message("字体未能保存，请检查浏览器存储空间或权限后重试。原有字体保持不变。");
    } finally {
      setBusy(false);
    }
  }
  async function removeFont(id) {
    if (busy) return;
    setBusy(true);
    try {
      const next = records.filter((record2) => record2.id !== id);
      await storage2("readwrite", next.filter((record2) => !record2.shared));
      typography.forgetFont(id);
      if (faces.has(id)) document.fonts.delete(faces.get(id));
      faces.delete(id);
      records = next;
      render();
      message("字体已移除；受影响的字体选项已恢复默认。");
    } catch {
      message("移除失败，字体仍保留。请检查浏览器存储空间或权限后重试。");
    } finally {
      setBusy(false);
    }
  }
  async function loadSelected() {
    const selected = new Set(Object.values(typography.getSelection()));
    for (const record2 of records.filter((record3) => record3.shared && selected.has(record3.id))) {
      if (faces.has(record2.id) || pending.has(record2.id)) continue;
      const task = (async () => {
        try {
          const face = new FontFace(`LocalDNSUploaded_${record2.id}`, `url(${JSON.stringify(sharedUIService.asset(record2.path))})`);
          await face.load();
          document.fonts.add(face);
          faces.set(record2.id, face);
        } catch {
          message(`服务器字体“${record2.name}”无法加载，暂用默认字体；刷新可重试。`);
        } finally {
          pending.delete(record2.id);
        }
      })();
      pending.set(record2.id, task);
      await task;
    }
  }
  async function exportRecords() {
    if (!ready) throw new Error("字体尚未读取完成，请稍后重试");
    return Promise.all(records.map(async (record2) => {
      if (!record2.shared) return { ...record2 };
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 3e4);
      try {
        const response = await assetHttp.fetch(sharedUIService.asset(record2.path), { signal: controller.signal });
        if (!response.ok) throw new Error("无法读取共享字体：" + record2.name);
        const data = await response.arrayBuffer();
        if (data.byteLength !== record2.size) throw new Error("共享字体文件与清单大小不一致");
        return { ...record2, data };
      } finally {
        clearTimeout(timer);
      }
    }));
  }
  fontsService = { exportRecords };
  window.addEventListener("localdns-font-selection", () => loadSelected());
  button.addEventListener("click", () => {
    if (ready) input.click();
    else load();
  });
  input.addEventListener("change", () => {
    const files = [...input.files];
    input.value = "";
    if (files.length) upload(files);
  });
  load();
}
function validPanelURL(value) {
  const text2 = String(value ?? "").trim();
  if (!/^https?:\/\//i.test(text2)) throw new Error("请输入以 http:// 或 https:// 开头的完整地址。");
  let url;
  try {
    url = new URL(text2);
  } catch {
    throw new Error("面板地址格式不正确，请检查主机和端口。");
  }
  if (!url.hostname || url.username || url.password) throw new Error("请使用不含用户名和密码的面板地址。");
  return url.href;
}
function panelIconCandidates(value, dark) {
  const url = new URL(validPanelURL(value));
  url.search = "";
  url.hash = "";
  if (/\.[a-z0-9]+$/i.test(url.pathname)) url.pathname = url.pathname.slice(0, url.pathname.lastIndexOf("/") + 1);
  else if (!url.pathname.endsWith("/")) url.pathname += "/";
  const names = dark ? ["favicon-dark.svg", "favicon.svg", "apple-touch-icon.png", "favicon.ico"] : ["favicon.svg", "apple-touch-icon.png", "favicon.ico"];
  return [.../* @__PURE__ */ new Set([...names.map((name) => new URL(name, url).href), new URL("/favicon.ico", url).href])];
}
let proxyPanelService;
function initialize$o() {
  "use strict";
  const STORAGE_KEY = "localdns-proxy-panel-v1";
  const identity = identityService;
  const defaultURL = new URL("/ui/", location.origin);
  defaultURL.port = "9090";
  const DEFAULT = { name: "代理面板", url: defaultURL.href };
  function configFrom(value) {
    if (!value || typeof value !== "object") throw new Error("面板设置无效。");
    return { name: identity.name(value.name, DEFAULT.name), url: validPanelURL(value.url || DEFAULT.url) };
  }
  function candidates(value) {
    return panelIconCandidates(value, document.documentElement.dataset.theme !== "light-glass");
  }
  const attempts = /* @__PURE__ */ new WeakMap();
  function loadLogo(element, value, status) {
    if (!element) return;
    const token = {};
    attempts.set(element, token);
    element.referrerPolicy = "no-referrer";
    element.onerror = null;
    element.src = identity.defaultProxyLogo;
    if (status) status.textContent = "正在读取面板图标…";
    let urls;
    try {
      urls = candidates(value);
    } catch {
      if (status) status.textContent = "填写有效面板地址后自动读取图标";
      return;
    }
    (async () => {
      for (const url of urls) {
        if (attempts.get(element) !== token) return;
        try {
          await new Promise((resolve, reject) => {
            const image = new Image();
            image.referrerPolicy = "no-referrer";
            const timer = setTimeout(() => {
              image.src = "";
              reject(new Error("timeout"));
            }, 2500);
            image.onload = () => {
              clearTimeout(timer);
              resolve();
            };
            image.onerror = () => {
              clearTimeout(timer);
              reject(new Error("image"));
            };
            image.src = url;
          });
          if (attempts.get(element) !== token) return;
          element.src = url;
          if (status) status.textContent = "已读取面板图标";
          return;
        } catch {
        }
      }
      if (attempts.get(element) === token && status) status.textContent = "未找到面板图标，使用默认图标";
    })();
  }
  let config = { ...DEFAULT };
  try {
    const saved = preferences.getItem(STORAGE_KEY);
    if (saved) config = configFrom(JSON.parse(saved));
  } catch {
  }
  let initialized = false;
  function setup({ notify = () => {
  } } = {}) {
    var _a2, _b2;
    if (initialized) return;
    const launcher = document.querySelector("#proxy-launcher");
    const panel = document.querySelector("#proxy-panel-popover");
    if (!launcher || !panel) return;
    initialized = true;
    const opener = launcher.querySelector("button");
    const form = panel.querySelector("form");
    const field = panel.querySelector("#proxy-panel-url");
    const error = panel.querySelector("#proxy-panel-error");
    const nameField = panel.querySelector("#proxy-panel-name"), preview = panel.querySelector("#proxy-panel-preview"), logoStatus = panel.querySelector("#proxy-logo-status");
    let returnFocus = opener, sequence = 0, revision = "", ready = false, loadError = "";
    const submit = form.querySelector("[type=submit]"), retry = panel.querySelector("#proxy-panel-retry");
    const enable = (value) => {
      for (const item of [nameField, field, submit]) item.disabled = !value;
    };
    let legacy = null;
    try {
      const raw = JSON.parse(preferences.getItem(STORAGE_KEY) || "null");
      if (raw) legacy = configFrom(raw);
    } catch {
    }
    async function refresh() {
      enable(false);
      retry.hidden = true;
      try {
        const result = await identity.loadSection("proxy", legacy, STORAGE_KEY);
        config = configFrom(result.value || DEFAULT);
        revision = result.revision;
        ready = true;
        loadError = "";
        sync();
        if (!panel.hidden) open(returnFocus);
      } catch (failure) {
        ready = false;
        loadError = failure.message;
        error.textContent = loadError;
        error.hidden = false;
        retry.hidden = false;
      } finally {
        enable(ready);
      }
    }
    retry.onclick = refresh;
    const previewLogo = () => loadLogo(preview, field.value || config.url, logoStatus);
    function sync() {
      const label = config.name;
      for (const item of document.querySelectorAll("[data-proxy-panel-link]")) {
        item.href = config.url;
        item.title = "打开 " + label + " · " + config.url;
        item.setAttribute("aria-label", "打开 " + label + "（新标签页）");
        const image = item.querySelector("img");
        loadLogo(image, config.url);
      }
      for (const item of document.querySelectorAll("[data-proxy-panel-name]")) item.textContent = label;
      for (const item of document.querySelectorAll("[data-proxy-panel-address]")) item.textContent = config.url;
    }
    function place() {
      if (panel.hidden) return;
      const rect = launcher.getBoundingClientRect();
      const viewport = window.visualViewport;
      const left = (viewport == null ? void 0 : viewport.offsetLeft) || 0, top = (viewport == null ? void 0 : viewport.offsetTop) || 0;
      const width = (viewport == null ? void 0 : viewport.width) || document.documentElement.clientWidth;
      const height = (viewport == null ? void 0 : viewport.height) || innerHeight;
      panel.style.maxHeight = Math.max(120, height - 24) + "px";
      panel.style.left = Math.max(left + 12, Math.min(left + width - panel.offsetWidth - 12, rect.right - panel.offsetWidth)) + "px";
      panel.style.top = Math.max(top + 12, Math.min(rect.bottom + 12, top + height - panel.offsetHeight - 12)) + "px";
    }
    function close(restore = true) {
      if (panel.hidden) return;
      ++sequence;
      panel.hidden = true;
      opener.setAttribute("aria-expanded", "false");
      if (restore && (returnFocus == null ? void 0 : returnFocus.isConnected)) returnFocus.focus({ preventScroll: true });
    }
    function open(origin = opener) {
      var _a3, _b3;
      if ((_a3 = document.querySelector("#bg-customizer-popover")) == null ? void 0 : _a3.classList.contains("open")) {
        (_b3 = document.querySelector("#btn-close-bg-popover")) == null ? void 0 : _b3.click();
        queueMicrotask(() => open(origin));
        return;
      }
      returnFocus = origin;
      error.hidden = ready;
      error.textContent = loadError || "正在读取服务器设置…";
      retry.hidden = ready || !loadError;
      field.removeAttribute("aria-invalid");
      field.value = config.url;
      nameField.value = config.name;
      previewLogo();
      panel.hidden = false;
      opener.setAttribute("aria-expanded", "true");
      place();
      nameField.focus({ preventScroll: true });
    }
    opener.addEventListener("click", () => panel.hidden ? open() : close());
    panel.querySelectorAll("[data-proxy-panel-close]").forEach((button) => button.addEventListener("click", () => close()));
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      error.hidden = true;
      field.removeAttribute("aria-invalid");
      if (!ready) return;
      const generation = sequence;
      enable(false);
      try {
        const next = configFrom({ name: nameField.value, url: field.value });
        if (generation !== sequence || panel.hidden) return;
        const result = await identity.saveSection("proxy", next, revision);
        config = configFrom(result.value);
        revision = result.revision;
        sync();
        close();
        notify("面板地址已应用到当前浏览器");
      } catch (failure) {
        if (generation !== sequence || panel.hidden) return;
        error.textContent = failure.message;
        error.hidden = false;
        retry.hidden = false;
        place();
      } finally {
        enable(ready);
      }
    });
    field.addEventListener("input", () => {
      ++sequence;
      error.hidden = true;
      field.removeAttribute("aria-invalid");
    });
    field.addEventListener("change", previewLogo);
    document.addEventListener("click", (event) => {
      const settings = event.target.closest("[data-proxy-panel-settings]");
      if (settings) {
        open(settings);
        return;
      }
      if (!panel.hidden && !panel.contains(event.target) && !launcher.contains(event.target)) close(false);
    });
    document.addEventListener("keydown", (event) => {
      if (!panel.hidden && event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        close();
      }
    }, true);
    document.addEventListener("focusin", (event) => {
      if (!panel.hidden && !panel.contains(event.target) && !launcher.contains(event.target)) close(false);
    });
    window.addEventListener("resize", place, { passive: true });
    window.addEventListener("scroll", place, { passive: true });
    (_a2 = window.visualViewport) == null ? void 0 : _a2.addEventListener("resize", place, { passive: true });
    (_b2 = window.visualViewport) == null ? void 0 : _b2.addEventListener("scroll", place, { passive: true });
    window.addEventListener("hashchange", () => close(false));
    proxyPanelService.sync = sync;
    new MutationObserver(() => {
      sync();
      if (!panel.hidden) previewLogo();
    }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    sync();
    refresh();
  }
  proxyPanelService = { setup, sync() {
  }, getValue: () => ({ ...config }), candidates };
}
let sharedUIService;
function initialize$n() {
  "use strict";
  const base = new URL("./", document.baseURI);
  const keys = { localdns: "localdns-identity-v1", proxy: "localdns-proxy-panel-v1", typography: "localdns-typography-v1" };
  const defaults = { version: 1, localdns: { name: "LocalDNS", logo: "" }, proxy: { name: "代理面板", url: "" }, typography: { heading: "serif", numeral: "serif", body: "plex" }, fonts: [] };
  let config = structuredClone(defaults), error = "";
  const read = (key) => {
    try {
      return JSON.parse(preferences.getItem(key) || "null");
    } catch {
      return null;
    }
  };
  const asset = (path) => {
    if (typeof path !== "string" || !/^custom\/(assets|fonts)\/[a-zA-Z0-9._-]+$/.test(path)) throw new Error("共享资源路径无效");
    return new URL(path, base).href;
  };
  try {
    const old = read(keys.proxy);
    if (old && Object.hasOwn(old, "logo")) {
      delete old.logo;
      preferences.setItem(keys.proxy, JSON.stringify(old));
    }
  } catch {
  }
  const ready = (async () => {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 6e3);
    try {
      const response = await assetHttp.fetch(new URL("custom/settings.json", base), { cache: "no-store", signal: controller.signal });
      if (response.status === 404) return config;
      if (!response.ok) throw new Error("共享配置读取失败");
      const value = await response.json();
      if (value.version !== 1 || !Array.isArray(value.fonts) || value.fonts.length > 128) throw new Error("共享配置格式无效");
      const fonts = value.fonts.map((font) => {
        if (!/^up[a-z0-9_-]+$/i.test(font.id) || typeof font.name !== "string" || !Number.isFinite(font.size) || font.size <= 0 || font.size > 67108864) throw new Error("共享字体清单无效");
        asset(font.path);
        return { ...font, name: font.name.slice(0, 200), shared: true };
      });
      if (new Set(fonts.map((f) => f.id)).size !== fonts.length || fonts.reduce((sum, f) => sum + f.size, 0) > 134217728) throw new Error("共享字体数量或容量无效");
      config = { version: 1, localdns: value.localdns || defaults.localdns, proxy: value.proxy || defaults.proxy, typography: value.typography || defaults.typography, fonts };
      return config;
    } catch (failure) {
      error = failure.name === "AbortError" ? "服务器共享配置读取超时" : failure.message;
      return config;
    } finally {
      clearTimeout(timer);
    }
  })();
  async function section(name) {
    await ready;
    return read(keys[name]) || config[name];
  }
  function hasOverride(name) {
    try {
      return preferences.getItem(keys[name]) !== null;
    } catch {
      return false;
    }
  }
  function save(name, value) {
    try {
      preferences.setItem(keys[name], JSON.stringify(value));
    } catch {
      throw new Error("当前浏览器禁止保存设置，请允许站点存储后重试。");
    }
  }
  function follow() {
    try {
      for (const key of Object.values(keys)) preferences.removeItem(key);
      location.reload();
    } catch {
      const status = document.querySelector("#shared-ui-status");
      status.textContent = "浏览器禁止修改站点存储，无法清除本机设置。";
      status.dataset.state = "error";
    }
  }
  const crcTable = Uint32Array.from({ length: 256 }, (_, i) => {
    let n = i;
    for (let j = 0; j < 8; j++) n = n & 1 ? 3988292384 ^ n >>> 1 : n >>> 1;
    return n >>> 0;
  });
  function crc(bytes) {
    let n = 4294967295;
    for (const b of bytes) n = crcTable[(n ^ b) & 255] ^ n >>> 8;
    return (n ^ 4294967295) >>> 0;
  }
  function zip(files) {
    const parts2 = [], central = [];
    let offset = 0, centralSize = 0;
    for (const [path, data] of files) {
      const name = new TextEncoder().encode(path), bytes = data instanceof Uint8Array ? data : new Uint8Array(data), sum = crc(bytes);
      const head = new Uint8Array(30 + name.length), h = new DataView(head.buffer);
      h.setUint32(0, 67324752, true);
      h.setUint16(4, 20, true);
      h.setUint16(6, 2048, true);
      h.setUint16(12, 33, true);
      h.setUint32(14, sum, true);
      h.setUint32(18, bytes.length, true);
      h.setUint32(22, bytes.length, true);
      h.setUint16(26, name.length, true);
      head.set(name, 30);
      const index = new Uint8Array(46 + name.length), v = new DataView(index.buffer);
      v.setUint32(0, 33639248, true);
      v.setUint16(4, 20, true);
      v.setUint16(6, 20, true);
      v.setUint16(8, 2048, true);
      v.setUint16(14, 33, true);
      v.setUint32(16, sum, true);
      v.setUint32(20, bytes.length, true);
      v.setUint32(24, bytes.length, true);
      v.setUint16(28, name.length, true);
      v.setUint32(42, offset, true);
      index.set(name, 46);
      parts2.push(head, bytes);
      central.push(index);
      centralSize += index.length;
      offset += head.length + bytes.length;
    }
    const end = new Uint8Array(22), e = new DataView(end.buffer);
    e.setUint32(0, 101010256, true);
    e.setUint16(8, files.length, true);
    e.setUint16(10, files.length, true);
    e.setUint32(12, centralSize, true);
    e.setUint32(16, offset, true);
    return new Blob([...parts2, ...central, end], { type: "application/zip" });
  }
  async function exportBundle() {
    await ready;
    const files = [];
    const identity = identityService.getValue(), proxy = (proxyPanelService == null ? void 0 : proxyPanelService.getValue()) || await section("proxy");
    const value = { version: 1, localdns: { ...identity }, proxy: { name: proxy.name, url: proxy.url }, typography: typographyService.getSelection(), fonts: [] };
    if (identity.logo.startsWith("data:") || identity.logo.startsWith(new URL("custom/assets/", base).href) || identity.logo.startsWith("custom/assets/")) {
      const blob = await (await assetHttp.fetch(identity.logo.startsWith("custom/") ? new URL(identity.logo, base) : identity.logo)).blob();
      const ext = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" }[blob.type];
      if (!ext) throw new Error("共享 Logo 请使用 PNG、JPG、WebP 或 GIF");
      files.push(["assets/logo." + ext, await blob.arrayBuffer()]);
      value.localdns.logo = "custom/assets/logo." + ext;
    }
    const fonts = await fontsService.exportRecords();
    for (const font of fonts) {
      const ext = font.name.split(".").pop().toLowerCase(), path = "fonts/" + font.id + "." + ext;
      files.push([path, font.data]);
      value.fonts.push({ id: font.id, name: font.name, size: font.data.byteLength, path: "custom/" + path });
    }
    files.unshift(["settings.json", new TextEncoder().encode(JSON.stringify(value, null, 2) + "\n")]);
    const url = URL.createObjectURL(zip(files)), a = document.createElement("a");
    a.href = url;
    a.download = "localdns-ui-settings.zip";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1e4);
  }
  function setup() {
    var _a2;
    const button = document.querySelector("#export-shared-ui"), status = document.querySelector("#shared-ui-status");
    button == null ? void 0 : button.addEventListener("click", async () => {
      button.disabled = true;
      status.textContent = "正在打包名称、Logo 与字体…";
      try {
        await exportBundle();
        status.textContent = "配置包已导出；导入服务器后，其他设备刷新即可同步。";
        status.dataset.state = "saved";
      } catch (failure) {
        status.textContent = "导出失败：" + failure.message;
        status.dataset.state = "error";
      } finally {
        button.disabled = false;
      }
    });
    (_a2 = document.querySelector("#use-shared-ui")) == null ? void 0 : _a2.addEventListener("click", follow);
    ready.then(() => {
      if (error) {
        status.textContent = error + "，当前使用默认值或本机设置；可刷新重试。";
        status.dataset.state = "error";
      }
    });
  }
  sharedUIService = { ready, section, save, asset, follow, hasOverride, get config() {
    return config;
  }, get error() {
    return error;
  } };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", setup, { once: true });
  else setup();
}
/*! @license DOMPurify 3.4.17 | (c) Cure53 and other contributors | Released under the Apache license 2.0 and Mozilla Public License 2.0 | github.com/cure53/DOMPurify/blob/3.4.17/LICENSE */
function _OverloadYield(e, d) {
  this.v = e, this.k = d;
}
function _arrayLikeToArray(r, a) {
  (null == a || a > r.length) && (a = r.length);
  for (var e = 0, n = Array(a); e < a; e++) n[e] = r[e];
  return n;
}
function _arrayWithHoles(r) {
  if (Array.isArray(r)) return r;
}
function _iterableToArrayLimit(r, l) {
  var t = null == r ? null : "undefined" != typeof Symbol && r[Symbol.iterator] || r["@@iterator"];
  if (null != t) {
    var e, n, i, u, a = [], f = true, o = false;
    try {
      if (i = (t = t.call(r)).next, 0 === l) {
        if (Object(t) !== t) return;
        f = false;
      } else for (; !(f = (e = i.call(t)).done) && (a.push(e.value), a.length !== l); f = true) ;
    } catch (r2) {
      o = true, n = r2;
    } finally {
      try {
        if (!f && null != t.return && (u = t.return(), Object(u) !== u)) return;
      } finally {
        if (o) throw n;
      }
    }
    return a;
  }
}
function _nonIterableRest() {
  throw new TypeError("Invalid attempt to destructure non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.");
}
/*! regenerator-runtime -- Copyright (c) 2014-present, Facebook, Inc. -- license (MIT): https://github.com/babel/babel/blob/main/packages/babel-helpers/LICENSE */
function _slicedToArray(r, e) {
  return _arrayWithHoles(r) || _iterableToArrayLimit(r, e) || _unsupportedIterableToArray(r, e) || _nonIterableRest();
}
function _unsupportedIterableToArray(r, a) {
  if (r) {
    if ("string" == typeof r) return _arrayLikeToArray(r, a);
    var t = {}.toString.call(r).slice(8, -1);
    return "Object" === t && r.constructor && (t = r.constructor.name), "Map" === t || "Set" === t ? Array.from(r) : "Arguments" === t || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(t) ? _arrayLikeToArray(r, a) : void 0;
  }
}
function AsyncGenerator(e) {
  var t, n;
  function resume(t2, n2) {
    try {
      var r = e[t2](n2), o = r.value, u = o instanceof _OverloadYield;
      Promise.resolve(u ? o.v : o).then(function(n3) {
        if (u) {
          var i = "return" === t2 && o.k ? t2 : "next";
          if (!o.k || n3.done) return resume(i, n3);
          n3 = e[i](n3).value;
        }
        settle(!!r.done, n3);
      }, function(e2) {
        resume("throw", e2);
      });
    } catch (e2) {
      settle(2, e2);
    }
  }
  function settle(e2, r) {
    2 === e2 ? t.reject(r) : t.resolve({
      value: r,
      done: e2
    }), (t = t.next) ? resume(t.key, t.arg) : n = null;
  }
  this._invoke = function(e2, r) {
    return new Promise(function(o, u) {
      var i = {
        key: e2,
        arg: r,
        resolve: o,
        reject: u,
        next: null
      };
      n ? n = n.next = i : (t = n = i, resume(e2, r));
    });
  }, "function" != typeof e.return && (this.return = void 0);
}
AsyncGenerator.prototype["function" == typeof Symbol && Symbol.asyncIterator || "@@asyncIterator"] = function() {
  return this;
}, AsyncGenerator.prototype.next = function(e) {
  return this._invoke("next", e);
}, AsyncGenerator.prototype.throw = function(e) {
  return this._invoke("throw", e);
}, AsyncGenerator.prototype.return = function(e) {
  return this._invoke("return", e);
};
const entries = Object.entries;
const setPrototypeOf = Object.setPrototypeOf;
const isFrozen = Object.isFrozen;
const getPrototypeOf = Object.getPrototypeOf;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
let freeze = Object.freeze;
let seal = Object.seal;
let create = Object.create;
let _ref = typeof Reflect !== "undefined" && Reflect;
let apply = _ref.apply;
let construct = _ref.construct;
if (!freeze) freeze = function freeze2(x) {
  return x;
};
if (!seal) seal = function seal2(x) {
  return x;
};
if (!apply) apply = function apply2(func, thisArg) {
  for (var _len = arguments.length, args = new Array(_len > 2 ? _len - 2 : 0), _key = 2; _key < _len; _key++) args[_key - 2] = arguments[_key];
  return func.apply(thisArg, args);
};
if (!construct) construct = function construct2(Func) {
  for (var _len2 = arguments.length, args = new Array(_len2 > 1 ? _len2 - 1 : 0), _key2 = 1; _key2 < _len2; _key2++) args[_key2 - 1] = arguments[_key2];
  return new Func(...args);
};
const arrayForEach = unapply(Array.prototype.forEach);
Array.prototype.indexOf;
const arrayLastIndexOf = unapply(Array.prototype.lastIndexOf);
const arrayPop = unapply(Array.prototype.pop);
const arrayPush = unapply(Array.prototype.push);
const arraySlice = unapply(Array.prototype.slice);
const arraySplice = unapply(Array.prototype.splice);
const arrayIsArray = Array.isArray;
const setCreate = unconstruct(Set);
const setAdd = unapply(Set.prototype.add);
const setHas = unapply(Set.prototype.has);
const stringToLowerCase = unapply(String.prototype.toLowerCase);
const stringToString = unapply(String.prototype.toString);
const stringMatch = unapply(String.prototype.match);
const stringReplace = unapply(String.prototype.replace);
const stringIndexOf = unapply(String.prototype.indexOf);
const stringTrim = unapply(String.prototype.trim);
const numberToString = unapply(Number.prototype.toString);
const booleanToString = unapply(Boolean.prototype.toString);
const bigintToString = typeof BigInt === "undefined" ? null : unapply(BigInt.prototype.toString);
const symbolToString = typeof Symbol === "undefined" ? null : unapply(Symbol.prototype.toString);
const objectHasOwnProperty = unapply(Object.prototype.hasOwnProperty);
const objectToString = unapply(Object.prototype.toString);
const regExpTest = unapply(RegExp.prototype.test);
const typeErrorCreate = unconstruct(TypeError);
function unapply(func) {
  return function(thisArg) {
    if (thisArg instanceof RegExp) thisArg.lastIndex = 0;
    for (var _len3 = arguments.length, args = new Array(_len3 > 1 ? _len3 - 1 : 0), _key3 = 1; _key3 < _len3; _key3++) args[_key3 - 1] = arguments[_key3];
    return apply(func, thisArg, args);
  };
}
function unconstruct(Func) {
  return function() {
    for (var _len4 = arguments.length, args = new Array(_len4), _key4 = 0; _key4 < _len4; _key4++) args[_key4] = arguments[_key4];
    return construct(Func, args);
  };
}
function addToSet(set, array2) {
  let transformCaseFunc = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : stringToLowerCase;
  if (setPrototypeOf) setPrototypeOf(set, null);
  if (!arrayIsArray(array2)) return set;
  let l = array2.length;
  while (l--) {
    let element = array2[l];
    if (typeof element === "string") {
      const lcElement = transformCaseFunc(element);
      if (lcElement !== element) {
        if (!isFrozen(array2)) array2[l] = lcElement;
        element = lcElement;
      }
    }
    set[element] = true;
  }
  return set;
}
function cleanArray(array2) {
  for (let index = 0; index < array2.length; index++) if (!objectHasOwnProperty(array2, index)) array2[index] = null;
  return array2;
}
function clone(object) {
  const newObject = create(null);
  for (const _ref2 of entries(object)) {
    var _ref3 = _slicedToArray(_ref2, 2);
    const property = _ref3[0];
    const value = _ref3[1];
    if (objectHasOwnProperty(object, property)) {
      if (arrayIsArray(value)) newObject[property] = cleanArray(value);
      else if (value && typeof value === "object" && value.constructor === Object) newObject[property] = clone(value);
      else newObject[property] = value;
    }
  }
  return newObject;
}
function stringifyValue(value) {
  switch (typeof value) {
    case "string":
      return value;
    case "number":
      return numberToString(value);
    case "boolean":
      return booleanToString(value);
    case "bigint":
      return bigintToString ? bigintToString(value) : "0";
    case "symbol":
      return symbolToString ? symbolToString(value) : "Symbol()";
    case "undefined":
      return objectToString(value);
    case "function":
    case "object": {
      if (value === null) return objectToString(value);
      const valueAsRecord = value;
      const valueToString = lookupGetter(valueAsRecord, "toString");
      if (typeof valueToString === "function") {
        const stringified = valueToString(valueAsRecord);
        return typeof stringified === "string" ? stringified : objectToString(stringified);
      }
      return objectToString(value);
    }
    default:
      return objectToString(value);
  }
}
function lookupGetter(object, prop) {
  while (object !== null) {
    const desc = getOwnPropertyDescriptor(object, prop);
    if (desc) {
      if (desc.get) return unapply(desc.get);
      if (typeof desc.value === "function") return unapply(desc.value);
    }
    object = getPrototypeOf(object);
  }
  function fallbackValue() {
    return null;
  }
  return fallbackValue;
}
function lookupAccessor(object, prop) {
  while (object !== null) {
    const desc = getOwnPropertyDescriptor(object, prop);
    if (desc) return desc.get ? unapply(desc.get) : null;
    object = getPrototypeOf(object);
  }
  return null;
}
function isRegex(value) {
  try {
    regExpTest(value, "");
    return true;
  } catch (_unused) {
    return false;
  }
}
const html$1 = freeze([
  "a",
  "abbr",
  "acronym",
  "address",
  "area",
  "article",
  "aside",
  "audio",
  "b",
  "bdi",
  "bdo",
  "big",
  "blink",
  "blockquote",
  "body",
  "br",
  "button",
  "canvas",
  "caption",
  "center",
  "cite",
  "code",
  "col",
  "colgroup",
  "content",
  "data",
  "datalist",
  "dd",
  "decorator",
  "del",
  "details",
  "dfn",
  "dialog",
  "dir",
  "div",
  "dl",
  "dt",
  "element",
  "em",
  "fieldset",
  "figcaption",
  "figure",
  "font",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "head",
  "header",
  "hgroup",
  "hr",
  "html",
  "i",
  "img",
  "input",
  "ins",
  "kbd",
  "label",
  "legend",
  "li",
  "main",
  "map",
  "mark",
  "marquee",
  "menu",
  "menuitem",
  "meter",
  "nav",
  "nobr",
  "ol",
  "optgroup",
  "option",
  "output",
  "p",
  "picture",
  "pre",
  "progress",
  "q",
  "rp",
  "rt",
  "ruby",
  "s",
  "samp",
  "search",
  "section",
  "select",
  "shadow",
  "slot",
  "small",
  "source",
  "spacer",
  "span",
  "strike",
  "strong",
  "style",
  "sub",
  "summary",
  "sup",
  "table",
  "tbody",
  "td",
  "template",
  "textarea",
  "tfoot",
  "th",
  "thead",
  "time",
  "tr",
  "track",
  "tt",
  "u",
  "ul",
  "var",
  "video",
  "wbr"
]);
const svg$1 = freeze([
  "svg",
  "a",
  "altglyph",
  "altglyphdef",
  "altglyphitem",
  "animatecolor",
  "animatemotion",
  "animatetransform",
  "circle",
  "clippath",
  "defs",
  "desc",
  "ellipse",
  "enterkeyhint",
  "exportparts",
  "filter",
  "font",
  "g",
  "glyph",
  "glyphref",
  "hkern",
  "image",
  "inputmode",
  "line",
  "lineargradient",
  "marker",
  "mask",
  "metadata",
  "mpath",
  "part",
  "path",
  "pattern",
  "polygon",
  "polyline",
  "radialgradient",
  "rect",
  "stop",
  "style",
  "switch",
  "symbol",
  "text",
  "textpath",
  "title",
  "tref",
  "tspan",
  "view",
  "vkern"
]);
const svgFilters = freeze([
  "feBlend",
  "feColorMatrix",
  "feComponentTransfer",
  "feComposite",
  "feConvolveMatrix",
  "feDiffuseLighting",
  "feDisplacementMap",
  "feDistantLight",
  "feDropShadow",
  "feFlood",
  "feFuncA",
  "feFuncB",
  "feFuncG",
  "feFuncR",
  "feGaussianBlur",
  "feImage",
  "feMerge",
  "feMergeNode",
  "feMorphology",
  "feOffset",
  "fePointLight",
  "feSpecularLighting",
  "feSpotLight",
  "feTile",
  "feTurbulence"
]);
const svgDisallowed = freeze([
  "animate",
  "color-profile",
  "cursor",
  "discard",
  "font-face",
  "font-face-format",
  "font-face-name",
  "font-face-src",
  "font-face-uri",
  "foreignobject",
  "hatch",
  "hatchpath",
  "mesh",
  "meshgradient",
  "meshpatch",
  "meshrow",
  "missing-glyph",
  "script",
  "set",
  "solidcolor",
  "unknown",
  "use"
]);
const mathMl$1 = freeze([
  "math",
  "menclose",
  "merror",
  "mfenced",
  "mfrac",
  "mglyph",
  "mi",
  "mlabeledtr",
  "mmultiscripts",
  "mn",
  "mo",
  "mover",
  "mpadded",
  "mphantom",
  "mroot",
  "mrow",
  "ms",
  "mspace",
  "msqrt",
  "mstyle",
  "msub",
  "msup",
  "msubsup",
  "mtable",
  "mtd",
  "mtext",
  "mtr",
  "munder",
  "munderover",
  "mprescripts"
]);
const mathMlDisallowed = freeze([
  "maction",
  "maligngroup",
  "malignmark",
  "mlongdiv",
  "mscarries",
  "mscarry",
  "msgroup",
  "mstack",
  "msline",
  "msrow",
  "semantics",
  "annotation",
  "annotation-xml",
  "mprescripts",
  "none"
]);
const text = freeze(["#text"]);
const html = freeze([
  "accept",
  "action",
  "align",
  "alt",
  "autocapitalize",
  "autocomplete",
  "autopictureinpicture",
  "autoplay",
  "background",
  "bgcolor",
  "border",
  "capture",
  "cellpadding",
  "cellspacing",
  "checked",
  "cite",
  "class",
  "clear",
  "color",
  "cols",
  "colspan",
  "command",
  "commandfor",
  "controls",
  "controlslist",
  "coords",
  "crossorigin",
  "datetime",
  "decoding",
  "default",
  "dir",
  "disabled",
  "disablepictureinpicture",
  "disableremoteplayback",
  "download",
  "draggable",
  "enctype",
  "enterkeyhint",
  "exportparts",
  "face",
  "for",
  "headers",
  "height",
  "hidden",
  "high",
  "href",
  "hreflang",
  "id",
  "inert",
  "inputmode",
  "integrity",
  "ismap",
  "kind",
  "label",
  "lang",
  "list",
  "loading",
  "loop",
  "low",
  "max",
  "maxlength",
  "media",
  "method",
  "min",
  "minlength",
  "multiple",
  "muted",
  "name",
  "nonce",
  "noshade",
  "novalidate",
  "nowrap",
  "open",
  "optimum",
  "part",
  "pattern",
  "placeholder",
  "playsinline",
  "popover",
  "popovertarget",
  "popovertargetaction",
  "poster",
  "preload",
  "pubdate",
  "radiogroup",
  "readonly",
  "rel",
  "required",
  "rev",
  "reversed",
  "role",
  "rows",
  "rowspan",
  "spellcheck",
  "scope",
  "selected",
  "shape",
  "size",
  "sizes",
  "slot",
  "span",
  "srclang",
  "start",
  "src",
  "srcset",
  "step",
  "style",
  "summary",
  "tabindex",
  "title",
  "translate",
  "type",
  "usemap",
  "valign",
  "value",
  "width",
  "wrap",
  "xmlns"
]);
const svg = freeze([
  "accent-height",
  "accumulate",
  "additive",
  "alignment-baseline",
  "amplitude",
  "ascent",
  "attributename",
  "attributetype",
  "azimuth",
  "basefrequency",
  "baseline-shift",
  "begin",
  "bias",
  "by",
  "class",
  "clip",
  "clippathunits",
  "clip-path",
  "clip-rule",
  "color",
  "color-interpolation",
  "color-interpolation-filters",
  "color-profile",
  "color-rendering",
  "cx",
  "cy",
  "d",
  "dx",
  "dy",
  "diffuseconstant",
  "direction",
  "display",
  "divisor",
  "dominant-baseline",
  "dur",
  "edgemode",
  "elevation",
  "end",
  "exponent",
  "fill",
  "fill-opacity",
  "fill-rule",
  "filter",
  "filterunits",
  "flood-color",
  "flood-opacity",
  "font-family",
  "font-size",
  "font-size-adjust",
  "font-stretch",
  "font-style",
  "font-variant",
  "font-weight",
  "fx",
  "fy",
  "g1",
  "g2",
  "glyph-name",
  "glyphref",
  "gradientunits",
  "gradienttransform",
  "height",
  "href",
  "id",
  "image-rendering",
  "in",
  "in2",
  "intercept",
  "k",
  "k1",
  "k2",
  "k3",
  "k4",
  "kerning",
  "keypoints",
  "keysplines",
  "keytimes",
  "lang",
  "lengthadjust",
  "letter-spacing",
  "kernelmatrix",
  "kernelunitlength",
  "lighting-color",
  "local",
  "marker-end",
  "marker-mid",
  "marker-start",
  "markerheight",
  "markerunits",
  "markerwidth",
  "maskcontentunits",
  "maskunits",
  "max",
  "mask",
  "mask-type",
  "media",
  "method",
  "mode",
  "min",
  "name",
  "numoctaves",
  "offset",
  "operator",
  "opacity",
  "order",
  "orient",
  "orientation",
  "origin",
  "overflow",
  "paint-order",
  "path",
  "pathlength",
  "patterncontentunits",
  "patterntransform",
  "patternunits",
  "pointer-events",
  "points",
  "preservealpha",
  "preserveaspectratio",
  "primitiveunits",
  "r",
  "rx",
  "ry",
  "radius",
  "refx",
  "refy",
  "repeatcount",
  "repeatdur",
  "restart",
  "result",
  "rotate",
  "scale",
  "seed",
  "shape-rendering",
  "slope",
  "specularconstant",
  "specularexponent",
  "spreadmethod",
  "startoffset",
  "stddeviation",
  "stitchtiles",
  "stop-color",
  "stop-opacity",
  "stroke-dasharray",
  "stroke-dashoffset",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-miterlimit",
  "stroke-opacity",
  "stroke",
  "stroke-width",
  "style",
  "surfacescale",
  "systemlanguage",
  "tabindex",
  "tablevalues",
  "targetx",
  "targety",
  "transform",
  "transform-origin",
  "text-anchor",
  "text-decoration",
  "text-orientation",
  "text-rendering",
  "textlength",
  "type",
  "u1",
  "u2",
  "unicode",
  "values",
  "vector-effect",
  "viewbox",
  "visibility",
  "version",
  "vert-adv-y",
  "vert-origin-x",
  "vert-origin-y",
  "width",
  "word-spacing",
  "wrap",
  "writing-mode",
  "xchannelselector",
  "ychannelselector",
  "x",
  "x1",
  "x2",
  "xmlns",
  "y",
  "y1",
  "y2",
  "z",
  "zoomandpan"
]);
const mathMl = freeze([
  "accent",
  "accentunder",
  "align",
  "bevelled",
  "close",
  "columnalign",
  "columnlines",
  "columnspacing",
  "columnspan",
  "denomalign",
  "depth",
  "dir",
  "display",
  "displaystyle",
  "encoding",
  "fence",
  "frame",
  "height",
  "href",
  "id",
  "largeop",
  "length",
  "linethickness",
  "lquote",
  "lspace",
  "mathbackground",
  "mathcolor",
  "mathsize",
  "mathvariant",
  "maxsize",
  "minsize",
  "movablelimits",
  "notation",
  "numalign",
  "open",
  "rowalign",
  "rowlines",
  "rowspacing",
  "rowspan",
  "rspace",
  "rquote",
  "scriptlevel",
  "scriptminsize",
  "scriptsizemultiplier",
  "selection",
  "separator",
  "separators",
  "stretchy",
  "subscriptshift",
  "supscriptshift",
  "symmetric",
  "voffset",
  "width",
  "xmlns"
]);
const xml = freeze([
  "xlink:href",
  "xml:id",
  "xlink:title",
  "xml:space",
  "xmlns:xlink"
]);
const MUSTACHE_EXPR = seal(/{{[\w\W]*|^[\w\W]*}}/g);
const ERB_EXPR = seal(/<%[\w\W]*|^[\w\W]*%>/g);
const TMPLIT_EXPR = seal(/\${[\w\W]*/g);
const DATA_ATTR = seal(/^data-[\-\w.\u00B7-\uFFFF]+$/);
const ARIA_ATTR = seal(/^aria-[\-\w]+$/);
const IS_ALLOWED_URI = seal(/^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|matrix):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i);
const IS_SCRIPT_OR_DATA = seal(/^(?:\w+script|data):/i);
const ATTR_WHITESPACE = seal(/[\u0000-\u0020\u00A0\u1680\u180E\u2000-\u2029\u205F\u3000]/g);
const DOCTYPE_NAME = seal(/^html$/i);
const CUSTOM_ELEMENT = seal(/^[a-z][.\w]*(-[.\w]+)+$/i);
const ELEMENT_MARKUP_PROBE = seal(/<[/\w!]/g);
const COMMENT_MARKUP_PROBE = seal(/<[/\w]/g);
const FALLBACK_TAG_CLOSE = seal(/<\/no(script|embed|frames)/i);
const SELF_CLOSING_TAG = seal(/\/>/i);
const NODE_TYPE = {
  element: 1,
  attribute: 2,
  text: 3,
  cdataSection: 4,
  entityReference: 5,
  entityNode: 6,
  processingInstruction: 7,
  comment: 8,
  document: 9,
  documentType: 10,
  documentFragment: 11,
  notation: 12
};
const LITERAL_TEXT_ELEMENTS = freeze(addToSet({}, [
  "style",
  "script",
  "xmp",
  "iframe",
  "noembed",
  "noframes",
  "plaintext",
  "noscript"
]));
const getGlobal = function getGlobal2() {
  return typeof window === "undefined" ? null : window;
};
const _createTrustedTypesPolicy = function _createTrustedTypesPolicy2(trustedTypes, purifyHostElement) {
  if (typeof trustedTypes !== "object" || typeof trustedTypes.createPolicy !== "function") return null;
  let suffix = null;
  const ATTR_NAME = "data-tt-policy-suffix";
  if (purifyHostElement && purifyHostElement.hasAttribute(ATTR_NAME)) suffix = purifyHostElement.getAttribute(ATTR_NAME);
  const policyName = "dompurify" + (suffix ? "#" + suffix : "");
  try {
    return trustedTypes.createPolicy(policyName, {
      createHTML(html2) {
        return html2;
      },
      createScriptURL(scriptUrl) {
        return scriptUrl;
      }
    });
  } catch (_) {
    console.warn("TrustedTypes policy " + policyName + " could not be created.");
    return null;
  }
};
const _createHooksMap = function _createHooksMap2() {
  return {
    afterSanitizeAttributes: [],
    afterSanitizeElements: [],
    afterSanitizeShadowDOM: [],
    beforeSanitizeAttributes: [],
    beforeSanitizeElements: [],
    beforeSanitizeShadowDOM: [],
    uponSanitizeAttribute: [],
    uponSanitizeElement: [],
    uponSanitizeShadowNode: []
  };
};
const _resolveSetOption = function _resolveSetOption2(cfg, key, fallback, options) {
  return objectHasOwnProperty(cfg, key) && arrayIsArray(cfg[key]) ? addToSet(options.base ? clone(options.base) : {}, cfg[key], options.transform) : fallback;
};
const _resolveObjectOption = function _resolveObjectOption2(cfg, key, makeFallback) {
  const value = objectHasOwnProperty(cfg, key) ? cfg[key] : void 0;
  return value && typeof value === "object" ? clone(value) : makeFallback();
};
function createDOMPurify() {
  let window2 = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : getGlobal();
  const DOMPurify = (root) => createDOMPurify(root);
  DOMPurify.version = "3.4.17";
  DOMPurify.removed = [];
  if (!window2 || !window2.document || window2.document.nodeType !== NODE_TYPE.document || !window2.Element) {
    DOMPurify.isSupported = false;
    return DOMPurify;
  }
  let document2 = window2.document;
  const originalDocument = document2;
  const currentScript = originalDocument.currentScript;
  window2.DocumentFragment;
  const HTMLTemplateElement = window2.HTMLTemplateElement, Node = window2.Node, Element = window2.Element, NodeFilter = window2.NodeFilter;
  window2.NamedNodeMap === void 0 && (window2.NamedNodeMap || window2.MozNamedAttrMap);
  window2.HTMLFormElement;
  const DOMParser = window2.DOMParser, trustedTypes = window2.trustedTypes;
  const ElementPrototype = Element.prototype;
  const cloneNode = lookupGetter(ElementPrototype, "cloneNode");
  const remove = lookupGetter(ElementPrototype, "remove");
  const removeAttributeNode = lookupGetter(ElementPrototype, "removeAttributeNode");
  const getNextSibling = lookupGetter(ElementPrototype, "nextSibling");
  const getChildNodes = lookupGetter(ElementPrototype, "childNodes");
  const getParentNode = lookupGetter(ElementPrototype, "parentNode");
  const getShadowRoot = lookupGetter(ElementPrototype, "shadowRoot");
  const getAttributes = lookupGetter(ElementPrototype, "attributes");
  const getNodeType = Node && Node.prototype ? lookupGetter(Node.prototype, "nodeType") : null;
  const getNodeName = Node && Node.prototype ? lookupGetter(Node.prototype, "nodeName") : null;
  const getOwnerDocument = Node && Node.prototype ? lookupGetter(Node.prototype, "ownerDocument") : null;
  const _readNodeType = function _readNodeType2(node) {
    return getNodeType ? getNodeType(node) : node.nodeType;
  };
  const _readNodeName = function _readNodeName2(node) {
    return getNodeName ? getNodeName(node) : node.nodeName;
  };
  const getNamespaceURI = lookupAccessor(ElementPrototype, "namespaceURI");
  const _readNamespaceURI = function _readNamespaceURI2(element) {
    return getNamespaceURI ? getNamespaceURI(element) : element.namespaceURI;
  };
  if (typeof HTMLTemplateElement === "function") {
    const template = document2.createElement("template");
    if (template.content && template.content.ownerDocument) document2 = template.content.ownerDocument;
  }
  let trustedTypesPolicy;
  let emptyHTML = "";
  let defaultTrustedTypesPolicy;
  let defaultTrustedTypesPolicyResolved = false;
  let IN_TRUSTED_TYPES_POLICY = 0;
  const _assertNotInTrustedTypesPolicy = function _assertNotInTrustedTypesPolicy2() {
    if (IN_TRUSTED_TYPES_POLICY > 0) throw typeErrorCreate('A configured TRUSTED_TYPES_POLICY callback (createHTML or createScriptURL) must not call DOMPurify.sanitize, as that causes infinite recursion. Do not pass a policy whose callbacks wrap DOMPurify as TRUSTED_TYPES_POLICY; see the "DOMPurify and Trusted Types" section of the README.');
  };
  const _createTrustedHTML = function _createTrustedHTML2(html2) {
    _assertNotInTrustedTypesPolicy();
    IN_TRUSTED_TYPES_POLICY++;
    try {
      return trustedTypesPolicy.createHTML(html2);
    } finally {
      IN_TRUSTED_TYPES_POLICY--;
    }
  };
  const _createTrustedScriptURL = function _createTrustedScriptURL2(scriptUrl) {
    _assertNotInTrustedTypesPolicy();
    IN_TRUSTED_TYPES_POLICY++;
    try {
      return trustedTypesPolicy.createScriptURL(scriptUrl);
    } finally {
      IN_TRUSTED_TYPES_POLICY--;
    }
  };
  const _getDefaultTrustedTypesPolicy = function _getDefaultTrustedTypesPolicy2() {
    if (!defaultTrustedTypesPolicyResolved) {
      defaultTrustedTypesPolicy = _createTrustedTypesPolicy(trustedTypes, currentScript);
      defaultTrustedTypesPolicyResolved = true;
    }
    return defaultTrustedTypesPolicy;
  };
  const _document = document2, implementation = _document.implementation, createNodeIterator = _document.createNodeIterator, createDocumentFragment = _document.createDocumentFragment, getElementsByTagName = _document.getElementsByTagName;
  const importNode = originalDocument.importNode;
  let hooks = _createHooksMap();
  DOMPurify.isSupported = typeof entries === "function" && typeof getParentNode === "function" && implementation && implementation.createHTMLDocument !== void 0;
  const MUSTACHE_EXPR$1 = MUSTACHE_EXPR, ERB_EXPR$1 = ERB_EXPR, TMPLIT_EXPR$1 = TMPLIT_EXPR, DATA_ATTR$1 = DATA_ATTR, ARIA_ATTR$1 = ARIA_ATTR, IS_SCRIPT_OR_DATA$1 = IS_SCRIPT_OR_DATA, ATTR_WHITESPACE$1 = ATTR_WHITESPACE, CUSTOM_ELEMENT$1 = CUSTOM_ELEMENT;
  let IS_ALLOWED_URI$1 = IS_ALLOWED_URI;
  let ALLOWED_TAGS = null;
  const DEFAULT_ALLOWED_TAGS = addToSet({}, [
    ...html$1,
    ...svg$1,
    ...svgFilters,
    ...mathMl$1,
    ...text
  ]);
  let ALLOWED_ATTR = null;
  const DEFAULT_ALLOWED_ATTR = addToSet({}, [
    ...html,
    ...svg,
    ...mathMl,
    ...xml
  ]);
  let CUSTOM_ELEMENT_HANDLING = Object.seal(create(null, {
    tagNameCheck: {
      writable: true,
      configurable: false,
      enumerable: true,
      value: null
    },
    attributeNameCheck: {
      writable: true,
      configurable: false,
      enumerable: true,
      value: null
    },
    allowCustomizedBuiltInElements: {
      writable: true,
      configurable: false,
      enumerable: true,
      value: false
    }
  }));
  let FORBID_TAGS = null;
  let FORBID_ATTR = null;
  const EXTRA_ELEMENT_HANDLING = Object.seal(create(null, {
    tagCheck: {
      writable: true,
      configurable: false,
      enumerable: true,
      value: null
    },
    attributeCheck: {
      writable: true,
      configurable: false,
      enumerable: true,
      value: null
    }
  }));
  let ALLOW_ARIA_ATTR = true;
  let ALLOW_DATA_ATTR = true;
  let ALLOW_UNKNOWN_PROTOCOLS = false;
  let ALLOW_SELF_CLOSE_IN_ATTR = true;
  let SAFE_FOR_TEMPLATES = false;
  let SAFE_FOR_XML = true;
  let WHOLE_DOCUMENT = false;
  let SET_CONFIG = false;
  let SET_CONFIG_ALLOWED_TAGS = null;
  let SET_CONFIG_ALLOWED_ATTR = null;
  let FORCE_BODY = false;
  let RETURN_DOM = false;
  let RETURN_DOM_FRAGMENT = false;
  let RETURN_TRUSTED_TYPE = false;
  let SANITIZE_DOM = true;
  let SANITIZE_NAMED_PROPS = false;
  const SANITIZE_NAMED_PROPS_PREFIX = "user-content-";
  let KEEP_CONTENT = true;
  let IN_PLACE = false;
  let IN_PLACE_VISITED = null;
  let USE_PROFILES = {};
  let FORBID_CONTENTS = null;
  const DEFAULT_FORBID_CONTENTS = addToSet({}, [
    "annotation-xml",
    "audio",
    "colgroup",
    "desc",
    "foreignobject",
    "head",
    "iframe",
    "math",
    "mi",
    "mn",
    "mo",
    "ms",
    "mtext",
    "noembed",
    "noframes",
    "noscript",
    "plaintext",
    "script",
    "selectedcontent",
    "style",
    "svg",
    "template",
    "thead",
    "title",
    "video",
    "xmp"
  ]);
  let DATA_URI_TAGS = null;
  const DEFAULT_DATA_URI_TAGS = addToSet({}, [
    "audio",
    "video",
    "img",
    "source",
    "image",
    "track"
  ]);
  let URI_SAFE_ATTRIBUTES = null;
  const DEFAULT_URI_SAFE_ATTRIBUTES = addToSet({}, [
    "alt",
    "class",
    "for",
    "id",
    "label",
    "name",
    "pattern",
    "placeholder",
    "role",
    "summary",
    "title",
    "value",
    "style",
    "xmlns"
  ]);
  const MATHML_NAMESPACE = "http://www.w3.org/1998/Math/MathML";
  const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
  const HTML_NAMESPACE = "http://www.w3.org/1999/xhtml";
  let NAMESPACE = HTML_NAMESPACE;
  let IS_EMPTY_INPUT = false;
  let ALLOWED_NAMESPACES = null;
  const DEFAULT_ALLOWED_NAMESPACES = addToSet({}, [
    MATHML_NAMESPACE,
    SVG_NAMESPACE,
    HTML_NAMESPACE
  ], stringToString);
  const DEFAULT_MATHML_TEXT_INTEGRATION_POINTS = freeze([
    "mi",
    "mo",
    "mn",
    "ms",
    "mtext"
  ]);
  let MATHML_TEXT_INTEGRATION_POINTS = addToSet({}, DEFAULT_MATHML_TEXT_INTEGRATION_POINTS);
  const DEFAULT_HTML_INTEGRATION_POINTS = freeze(["annotation-xml"]);
  let HTML_INTEGRATION_POINTS = addToSet({}, DEFAULT_HTML_INTEGRATION_POINTS);
  const COMMON_SVG_AND_HTML_ELEMENTS = addToSet({}, [
    "title",
    "style",
    "font",
    "a",
    "script"
  ]);
  let PARSER_MEDIA_TYPE = null;
  const SUPPORTED_PARSER_MEDIA_TYPES = ["application/xhtml+xml", "text/html"];
  const DEFAULT_PARSER_MEDIA_TYPE = "text/html";
  let transformCaseFunc = null;
  let CONFIG2 = null;
  const formElement = document2.createElement("form");
  const isRegexOrFunction = function isRegexOrFunction2(testValue) {
    return testValue instanceof RegExp || testValue instanceof Function;
  };
  const _parseConfig = function _parseConfig2() {
    let cfg = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : {};
    if (CONFIG2 && CONFIG2 === cfg) return;
    if (!cfg || typeof cfg !== "object") cfg = {};
    cfg = clone(cfg);
    PARSER_MEDIA_TYPE = SUPPORTED_PARSER_MEDIA_TYPES.indexOf(cfg.PARSER_MEDIA_TYPE) === -1 ? DEFAULT_PARSER_MEDIA_TYPE : cfg.PARSER_MEDIA_TYPE;
    transformCaseFunc = PARSER_MEDIA_TYPE === "application/xhtml+xml" ? stringToString : stringToLowerCase;
    ALLOWED_TAGS = _resolveSetOption(cfg, "ALLOWED_TAGS", DEFAULT_ALLOWED_TAGS, { transform: transformCaseFunc });
    ALLOWED_ATTR = _resolveSetOption(cfg, "ALLOWED_ATTR", DEFAULT_ALLOWED_ATTR, { transform: transformCaseFunc });
    ALLOWED_NAMESPACES = _resolveSetOption(cfg, "ALLOWED_NAMESPACES", DEFAULT_ALLOWED_NAMESPACES, { transform: stringToString });
    URI_SAFE_ATTRIBUTES = _resolveSetOption(cfg, "ADD_URI_SAFE_ATTR", DEFAULT_URI_SAFE_ATTRIBUTES, {
      transform: transformCaseFunc,
      base: DEFAULT_URI_SAFE_ATTRIBUTES
    });
    DATA_URI_TAGS = _resolveSetOption(cfg, "ADD_DATA_URI_TAGS", DEFAULT_DATA_URI_TAGS, {
      transform: transformCaseFunc,
      base: DEFAULT_DATA_URI_TAGS
    });
    FORBID_CONTENTS = _resolveSetOption(cfg, "FORBID_CONTENTS", DEFAULT_FORBID_CONTENTS, { transform: transformCaseFunc });
    FORBID_TAGS = _resolveSetOption(cfg, "FORBID_TAGS", clone({}), { transform: transformCaseFunc });
    FORBID_ATTR = _resolveSetOption(cfg, "FORBID_ATTR", clone({}), { transform: transformCaseFunc });
    USE_PROFILES = objectHasOwnProperty(cfg, "USE_PROFILES") ? cfg.USE_PROFILES && typeof cfg.USE_PROFILES === "object" ? clone(cfg.USE_PROFILES) : cfg.USE_PROFILES : false;
    ALLOW_ARIA_ATTR = cfg.ALLOW_ARIA_ATTR !== false;
    ALLOW_DATA_ATTR = cfg.ALLOW_DATA_ATTR !== false;
    ALLOW_UNKNOWN_PROTOCOLS = cfg.ALLOW_UNKNOWN_PROTOCOLS || false;
    ALLOW_SELF_CLOSE_IN_ATTR = cfg.ALLOW_SELF_CLOSE_IN_ATTR !== false;
    SAFE_FOR_TEMPLATES = cfg.SAFE_FOR_TEMPLATES || false;
    SAFE_FOR_XML = cfg.SAFE_FOR_XML !== false;
    WHOLE_DOCUMENT = cfg.WHOLE_DOCUMENT || false;
    RETURN_DOM = cfg.RETURN_DOM || false;
    RETURN_DOM_FRAGMENT = cfg.RETURN_DOM_FRAGMENT || false;
    RETURN_TRUSTED_TYPE = cfg.RETURN_TRUSTED_TYPE || false;
    FORCE_BODY = cfg.FORCE_BODY || false;
    SANITIZE_DOM = cfg.SANITIZE_DOM !== false;
    SANITIZE_NAMED_PROPS = cfg.SANITIZE_NAMED_PROPS || false;
    KEEP_CONTENT = cfg.KEEP_CONTENT !== false;
    IN_PLACE = cfg.IN_PLACE || false;
    IS_ALLOWED_URI$1 = isRegex(cfg.ALLOWED_URI_REGEXP) ? cfg.ALLOWED_URI_REGEXP : IS_ALLOWED_URI;
    NAMESPACE = typeof cfg.NAMESPACE === "string" ? cfg.NAMESPACE : HTML_NAMESPACE;
    MATHML_TEXT_INTEGRATION_POINTS = _resolveObjectOption(cfg, "MATHML_TEXT_INTEGRATION_POINTS", () => addToSet({}, DEFAULT_MATHML_TEXT_INTEGRATION_POINTS));
    HTML_INTEGRATION_POINTS = _resolveObjectOption(cfg, "HTML_INTEGRATION_POINTS", () => addToSet({}, DEFAULT_HTML_INTEGRATION_POINTS));
    const customElementHandling = _resolveObjectOption(cfg, "CUSTOM_ELEMENT_HANDLING", () => create(null));
    CUSTOM_ELEMENT_HANDLING = create(null);
    if (objectHasOwnProperty(customElementHandling, "tagNameCheck") && isRegexOrFunction(customElementHandling.tagNameCheck)) CUSTOM_ELEMENT_HANDLING.tagNameCheck = customElementHandling.tagNameCheck;
    if (objectHasOwnProperty(customElementHandling, "attributeNameCheck") && isRegexOrFunction(customElementHandling.attributeNameCheck)) CUSTOM_ELEMENT_HANDLING.attributeNameCheck = customElementHandling.attributeNameCheck;
    if (objectHasOwnProperty(customElementHandling, "allowCustomizedBuiltInElements") && typeof customElementHandling.allowCustomizedBuiltInElements === "boolean") CUSTOM_ELEMENT_HANDLING.allowCustomizedBuiltInElements = customElementHandling.allowCustomizedBuiltInElements;
    seal(CUSTOM_ELEMENT_HANDLING);
    if (SAFE_FOR_TEMPLATES) ALLOW_DATA_ATTR = false;
    if (RETURN_DOM_FRAGMENT) RETURN_DOM = true;
    if (USE_PROFILES) {
      ALLOWED_TAGS = addToSet({}, text);
      ALLOWED_ATTR = create(null);
      if (USE_PROFILES.html === true) {
        addToSet(ALLOWED_TAGS, html$1);
        addToSet(ALLOWED_ATTR, html);
      }
      if (USE_PROFILES.svg === true) {
        addToSet(ALLOWED_TAGS, svg$1);
        addToSet(ALLOWED_ATTR, svg);
        addToSet(ALLOWED_ATTR, xml);
      }
      if (USE_PROFILES.svgFilters === true) {
        addToSet(ALLOWED_TAGS, svgFilters);
        addToSet(ALLOWED_ATTR, svg);
        addToSet(ALLOWED_ATTR, xml);
      }
      if (USE_PROFILES.mathMl === true) {
        addToSet(ALLOWED_TAGS, mathMl$1);
        addToSet(ALLOWED_ATTR, mathMl);
        addToSet(ALLOWED_ATTR, xml);
      }
    }
    EXTRA_ELEMENT_HANDLING.tagCheck = null;
    EXTRA_ELEMENT_HANDLING.attributeCheck = null;
    if (objectHasOwnProperty(cfg, "ADD_TAGS")) {
      if (typeof cfg.ADD_TAGS === "function") EXTRA_ELEMENT_HANDLING.tagCheck = cfg.ADD_TAGS;
      else if (arrayIsArray(cfg.ADD_TAGS)) {
        if (ALLOWED_TAGS === DEFAULT_ALLOWED_TAGS) ALLOWED_TAGS = clone(ALLOWED_TAGS);
        addToSet(ALLOWED_TAGS, cfg.ADD_TAGS, transformCaseFunc);
      }
    }
    if (objectHasOwnProperty(cfg, "ADD_ATTR")) {
      if (typeof cfg.ADD_ATTR === "function") EXTRA_ELEMENT_HANDLING.attributeCheck = cfg.ADD_ATTR;
      else if (arrayIsArray(cfg.ADD_ATTR)) {
        if (ALLOWED_ATTR === DEFAULT_ALLOWED_ATTR) ALLOWED_ATTR = clone(ALLOWED_ATTR);
        addToSet(ALLOWED_ATTR, cfg.ADD_ATTR, transformCaseFunc);
      }
    }
    if (objectHasOwnProperty(cfg, "ADD_FORBID_CONTENTS") && arrayIsArray(cfg.ADD_FORBID_CONTENTS)) {
      if (FORBID_CONTENTS === DEFAULT_FORBID_CONTENTS) FORBID_CONTENTS = clone(FORBID_CONTENTS);
      addToSet(FORBID_CONTENTS, cfg.ADD_FORBID_CONTENTS, transformCaseFunc);
    }
    if (KEEP_CONTENT) ALLOWED_TAGS["#text"] = true;
    if (WHOLE_DOCUMENT) addToSet(ALLOWED_TAGS, [
      "html",
      "head",
      "body"
    ]);
    if (ALLOWED_TAGS.table) {
      addToSet(ALLOWED_TAGS, ["tbody"]);
      delete FORBID_TAGS.tbody;
    }
    if (cfg.TRUSTED_TYPES_POLICY) {
      if (typeof cfg.TRUSTED_TYPES_POLICY.createHTML !== "function") throw typeErrorCreate('TRUSTED_TYPES_POLICY configuration option must provide a "createHTML" hook.');
      if (typeof cfg.TRUSTED_TYPES_POLICY.createScriptURL !== "function") throw typeErrorCreate('TRUSTED_TYPES_POLICY configuration option must provide a "createScriptURL" hook.');
      const previousTrustedTypesPolicy = trustedTypesPolicy;
      trustedTypesPolicy = cfg.TRUSTED_TYPES_POLICY;
      try {
        emptyHTML = _createTrustedHTML("");
      } catch (error) {
        trustedTypesPolicy = previousTrustedTypesPolicy;
        throw error;
      }
    } else if (cfg.TRUSTED_TYPES_POLICY === null) {
      trustedTypesPolicy = void 0;
      emptyHTML = "";
    } else {
      if (trustedTypesPolicy === void 0) trustedTypesPolicy = _getDefaultTrustedTypesPolicy();
      if (trustedTypesPolicy && typeof emptyHTML === "string") emptyHTML = _createTrustedHTML("");
    }
    if (freeze) freeze(cfg);
    CONFIG2 = cfg;
  };
  const ALL_SVG_TAGS = addToSet({}, [
    ...svg$1,
    ...svgFilters,
    ...svgDisallowed
  ]);
  const ALL_MATHML_TAGS = addToSet({}, [...mathMl$1, ...mathMlDisallowed]);
  const _checkSvgNamespace = function _checkSvgNamespace2(tagName, parent, parentTagName) {
    if (parent.namespaceURI === HTML_NAMESPACE) return tagName === "svg";
    if (parent.namespaceURI === MATHML_NAMESPACE) return tagName === "svg" && (parentTagName === "annotation-xml" || MATHML_TEXT_INTEGRATION_POINTS[parentTagName]);
    return Boolean(ALL_SVG_TAGS[tagName]);
  };
  const _checkMathMlNamespace = function _checkMathMlNamespace2(tagName, parent, parentTagName) {
    if (parent.namespaceURI === HTML_NAMESPACE) return tagName === "math";
    if (parent.namespaceURI === SVG_NAMESPACE) return tagName === "math" && HTML_INTEGRATION_POINTS[parentTagName];
    return Boolean(ALL_MATHML_TAGS[tagName]);
  };
  const _checkHtmlNamespace = function _checkHtmlNamespace2(tagName, parent, parentTagName) {
    if (parent.namespaceURI === SVG_NAMESPACE && !HTML_INTEGRATION_POINTS[parentTagName]) return false;
    if (parent.namespaceURI === MATHML_NAMESPACE && !MATHML_TEXT_INTEGRATION_POINTS[parentTagName]) return false;
    return !ALL_MATHML_TAGS[tagName] && (COMMON_SVG_AND_HTML_ELEMENTS[tagName] || !ALL_SVG_TAGS[tagName]);
  };
  const _checkValidNamespace = function _checkValidNamespace2(element) {
    const elementNamespace = _readNamespaceURI(element);
    const tagName = stringToLowerCase(_readNodeName(element));
    const parentNode = getParentNode(element);
    let parent;
    let parentTagName;
    if (parentNode && _readNodeType(parentNode) === NODE_TYPE.element) {
      parent = { namespaceURI: _readNamespaceURI(parentNode) };
      parentTagName = stringToLowerCase(_readNodeName(parentNode));
    } else {
      parent = { namespaceURI: NAMESPACE };
      parentTagName = "template";
    }
    if (!ALLOWED_NAMESPACES[elementNamespace]) return false;
    if (elementNamespace === SVG_NAMESPACE) return _checkSvgNamespace(tagName, parent, parentTagName);
    if (elementNamespace === MATHML_NAMESPACE) return _checkMathMlNamespace(tagName, parent, parentTagName);
    if (elementNamespace === HTML_NAMESPACE) return _checkHtmlNamespace(tagName, parent, parentTagName);
    if (PARSER_MEDIA_TYPE === "application/xhtml+xml" && ALLOWED_NAMESPACES[elementNamespace]) return true;
    return false;
  };
  const _forceRemove = function _forceRemove2(node) {
    arrayPush(DOMPurify.removed, { element: node });
    try {
      getParentNode(node).removeChild(node);
    } catch (_) {
      remove(node);
      if (!getParentNode(node)) throw typeErrorCreate("a node selected for removal could not be detached from its tree and cannot be safely returned; refusing to sanitize in place");
    }
  };
  const _stripAttributeNode = function _stripAttributeNode2(element, attribute, name) {
    try {
      removeAttributeNode(element, attribute);
    } catch (_) {
      try {
        element.removeAttribute(name);
      } catch (_2) {
      }
    }
  };
  const _neutralizeRoot = function _neutralizeRoot2(root) {
    _neutralizeSubtree(root);
    const childNodes = getChildNodes(root);
    if (childNodes) arrayForEach(arraySlice(childNodes), (child) => {
      try {
        remove(child);
      } catch (_) {
      }
    });
    const attributes = _readNodeType(root) === NODE_TYPE.element ? getAttributes(root) : null;
    if (attributes) for (let i = attributes.length - 1; i >= 0; --i) {
      const attribute = attributes[i];
      const name = attribute && attribute.name;
      if (typeof name === "string") _stripAttributeNode(root, attribute, name);
    }
  };
  const _removeAttribute = function _removeAttribute2(name, element, attr) {
    if (!attr) try {
      attr = element.getAttributeNode(name);
    } catch (_) {
      attr = null;
    }
    arrayPush(DOMPurify.removed, {
      attribute: attr || null,
      from: element
    });
    try {
      if (attr) removeAttributeNode(element, attr);
      else element.removeAttribute(name);
    } catch (_) {
      try {
        element.removeAttribute(name);
      } catch (_2) {
      }
    }
    if (name === "is") {
      if (RETURN_DOM || RETURN_DOM_FRAGMENT) try {
        _forceRemove(element);
      } catch (_) {
      }
      else try {
        element.setAttribute(name, "");
      } catch (_) {
      }
    }
  };
  const _stripDisallowedAttributes = function _stripDisallowedAttributes2(element) {
    const attributes = getAttributes(element);
    if (!attributes) return;
    for (let i = attributes.length - 1; i >= 0; --i) {
      const attribute = attributes[i];
      const name = attribute && attribute.name;
      if (typeof name !== "string" || ALLOWED_ATTR[transformCaseFunc(name)]) continue;
      _stripAttributeNode(element, attribute, name);
    }
  };
  const _walkTree = function _walkTree2(root, visit) {
    let intoShadow = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : false;
    const stack = [root];
    while (stack.length > 0) {
      const node = stack.pop();
      if (visit(node) === false) continue;
      if (intoShadow && _readNodeType(node) === NODE_TYPE.element) {
        const shadowRoot = getShadowRoot(node);
        if (_isDocumentFragment(shadowRoot)) stack.push(shadowRoot);
      }
      const childNodes = getChildNodes(node);
      if (childNodes) for (let i = childNodes.length - 1; i >= 0; --i) stack.push(childNodes[i]);
    }
  };
  const _neutralizeSubtree = function _neutralizeSubtree2(root) {
    _walkTree(root, (node) => {
      if (_readNodeType(node) === NODE_TYPE.element) _stripDisallowedAttributes(node);
    });
  };
  const _collectLiveNodes = function _collectLiveNodes2(root) {
    const nodes = [];
    _walkTree(root, (node) => {
      nodes.push(node);
    }, true);
    return nodes;
  };
  const _neutralizeEscapedElements = function _neutralizeEscapedElements2(root, before) {
    const reachable = setCreate();
    arrayForEach(_collectLiveNodes(root), (node) => {
      if (_readNodeType(node) === NODE_TYPE.element) setAdd(reachable, node);
    });
    arrayForEach(before, (node) => {
      if (_readNodeType(node) === NODE_TYPE.element && !setHas(reachable, node)) _stripDisallowedAttributes(node);
    });
  };
  const _neutralizeDiscarded = function _neutralizeDiscarded2(root, before) {
    let rootRemoved = false;
    arrayForEach(DOMPurify.removed, (entry) => {
      if (entry.element) {
        rootRemoved = rootRemoved || entry.element === root;
        _neutralizeSubtree(entry.element);
      }
    });
    _neutralizeEscapedElements(root, before);
    return rootRemoved;
  };
  const MAX_UNVISITED_ROUNDS = 8;
  const _sanitizeUnvisitedNodes = function _sanitizeUnvisitedNodes2(root, before) {
    const visited = IN_PLACE_VISITED;
    let original = null;
    const getOriginal = () => {
      if (!original) {
        original = setCreate();
        arrayForEach(before, (beforeNode) => {
          setAdd(original, beforeNode);
        });
      }
      return original;
    };
    for (let round = 0; ; round++) {
      const live = _collectLiveNodes(root);
      const containers = [root];
      let pending = false;
      arrayForEach(live, (node) => {
        if (_readNodeType(node) === NODE_TYPE.documentFragment) arrayPush(containers, node);
        else if (!pending && !setHas(visited, node)) pending = setHas(getOriginal(), node);
      });
      if (!pending) return;
      if (round >= MAX_UNVISITED_ROUNDS) throw typeErrorCreate("the tree kept changing during in-place sanitization; refusing to return it");
      arrayForEach(containers, (container, index) => {
        _sanitizeUnvisitedIn(container, index > 0, root, getOriginal());
      });
    }
  };
  const _sanitizeUnvisitedIn = function _sanitizeUnvisitedIn2(container, inShadow, root, original) {
    const iterator = _createNodeIterator(container);
    let node;
    while (node = iterator.nextNode()) {
      if (!setHas(original, node) || setHas(IN_PLACE_VISITED, node)) continue;
      if (inShadow) _executeHooks(hooks.uponSanitizeShadowNode, node, null);
      _sanitizeElements(node, root);
      _sanitizeAttributes(node, root);
      if (_isDocumentFragment(node.content)) _sanitizeShadowDOM2(node.content);
    }
  };
  const _markVisited = function _markVisited2(node) {
    if (IN_PLACE_VISITED) setAdd(IN_PLACE_VISITED, node);
  };
  const _isPatchLinkageAttribute = function _isPatchLinkageAttribute2(lcName, lcTag) {
    if (!SAFE_FOR_XML) return false;
    if (lcName === "patchsrc") return true;
    return lcName === "for" && lcTag !== "label" && lcTag !== "output";
  };
  const _neutralizePatchLinkage = function _neutralizePatchLinkage2(root) {
    if (!SAFE_FOR_XML) return;
    _walkTree(root, (node) => {
      const nodeType = _readNodeType(node);
      if (nodeType === NODE_TYPE.processingInstruction || nodeType === NODE_TYPE.comment && regExpTest(COMMENT_MARKUP_PROBE, node.data)) {
        try {
          remove(node);
        } catch (_) {
        }
        return false;
      }
      if (nodeType === NODE_TYPE.element) {
        const element = node;
        const lcTag = transformCaseFunc(_readNodeName(node));
        try {
          if (element.hasAttribute && element.hasAttribute("patchsrc")) element.removeAttribute("patchsrc");
          if (element.hasAttribute && element.hasAttribute("for") && _isPatchLinkageAttribute("for", lcTag)) element.removeAttribute("for");
        } catch (_) {
        }
      }
      return true;
    });
  };
  const _initDocument = function _initDocument2(dirty) {
    let doc = null;
    let leadingWhitespace = null;
    if (FORCE_BODY) dirty = "<remove></remove>" + dirty;
    else {
      const matches = stringMatch(dirty, /^[\r\n\t ]+/);
      leadingWhitespace = matches && matches[0];
    }
    if (PARSER_MEDIA_TYPE === "application/xhtml+xml" && NAMESPACE === HTML_NAMESPACE) dirty = '<html xmlns="http://www.w3.org/1999/xhtml"><head></head><body>' + dirty + "</body></html>";
    const dirtyPayload = trustedTypesPolicy ? _createTrustedHTML(dirty) : dirty;
    if (NAMESPACE === HTML_NAMESPACE) try {
      doc = new DOMParser().parseFromString(dirtyPayload, PARSER_MEDIA_TYPE);
    } catch (_) {
    }
    if (!doc || !doc.documentElement) {
      doc = implementation.createDocument(NAMESPACE, "template", null);
      try {
        doc.documentElement.innerHTML = IS_EMPTY_INPUT ? emptyHTML : dirtyPayload;
      } catch (_) {
      }
    }
    const body = doc.body || doc.documentElement;
    if (dirty && leadingWhitespace) body.insertBefore(document2.createTextNode(leadingWhitespace), body.childNodes[0] || null);
    if (NAMESPACE === HTML_NAMESPACE) return getElementsByTagName.call(doc, WHOLE_DOCUMENT ? "html" : "body")[0];
    return WHOLE_DOCUMENT ? doc.documentElement : body;
  };
  const _createNodeIterator = function _createNodeIterator2(root) {
    const doc = getOwnerDocument ? getOwnerDocument(root) : root.ownerDocument;
    return createNodeIterator.call(doc || root, root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_COMMENT | NodeFilter.SHOW_TEXT | NodeFilter.SHOW_PROCESSING_INSTRUCTION | NodeFilter.SHOW_CDATA_SECTION, null);
  };
  const _stripTemplateExpressions = function _stripTemplateExpressions2(value) {
    value = stringReplace(value, MUSTACHE_EXPR$1, " ");
    value = stringReplace(value, ERB_EXPR$1, " ");
    value = stringReplace(value, TMPLIT_EXPR$1, " ");
    return value;
  };
  const _scrubTemplateExpressions2 = function _scrubTemplateExpressions(node) {
    var _node$querySelectorAl;
    _scrubOwnCharacterData(node);
    const templates = (_node$querySelectorAl = node.querySelectorAll) === null || _node$querySelectorAl === void 0 ? void 0 : _node$querySelectorAl.call(node, "template");
    if (templates) arrayForEach(templates, (tmpl) => {
      if (_isDocumentFragment(tmpl.content)) _scrubTemplateExpressions2(tmpl.content);
    });
  };
  const _scrubOwnCharacterData = function _scrubOwnCharacterData2(node) {
    node.normalize();
    const doc = getOwnerDocument ? getOwnerDocument(node) : node.ownerDocument;
    const walker = createNodeIterator.call(doc || node, node, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_COMMENT | NodeFilter.SHOW_CDATA_SECTION | NodeFilter.SHOW_PROCESSING_INSTRUCTION, null);
    let currentNode = walker.nextNode();
    while (currentNode) {
      currentNode.data = _stripTemplateExpressions(currentNode.data);
      currentNode = walker.nextNode();
    }
  };
  const _isClobbered = function _isClobbered2(element) {
    const realTagName = getNodeName ? getNodeName(element) : null;
    if (typeof realTagName !== "string") return false;
    if (transformCaseFunc(realTagName) !== "form") return false;
    return typeof element.nodeName !== "string" || typeof element.textContent !== "string" || typeof element.removeChild !== "function" || element.attributes !== getAttributes(element) || typeof element.removeAttribute !== "function" || typeof element.removeAttributeNode !== "function" || typeof element.getAttributeNode !== "function" || typeof element.setAttribute !== "function" || typeof element.namespaceURI !== "string" || typeof element.insertBefore !== "function" || typeof element.hasChildNodes !== "function" || element.nodeType !== getNodeType(element) || element.childNodes !== getChildNodes(element);
  };
  const _isDocumentFragment = function _isDocumentFragment2(value) {
    if (!getNodeType || typeof value !== "object" || value === null) return false;
    try {
      return getNodeType(value) === NODE_TYPE.documentFragment;
    } catch (_) {
      return false;
    }
  };
  const _isNode = function _isNode2(value) {
    if (!getNodeType || typeof value !== "object" || value === null) return false;
    try {
      return typeof getNodeType(value) === "number";
    } catch (_) {
      return false;
    }
  };
  function _executeHooks(hooks2, currentNode, data) {
    if (hooks2.length === 0) return;
    arrayForEach(hooks2, (hook) => {
      hook.call(DOMPurify, currentNode, data, CONFIG2);
    });
  }
  const _isUnsafeNode = function _isUnsafeNode2(currentNode, tagName) {
    if (SAFE_FOR_XML && currentNode.hasChildNodes() && !_isNode(currentNode.firstElementChild) && regExpTest(ELEMENT_MARKUP_PROBE, currentNode.textContent) && regExpTest(ELEMENT_MARKUP_PROBE, currentNode.innerHTML)) return true;
    if (SAFE_FOR_XML && LITERAL_TEXT_ELEMENTS[tagName] && _readNodeType(currentNode) === NODE_TYPE.element && _readNamespaceURI(currentNode) === HTML_NAMESPACE && (_isNode(currentNode.firstElementChild) || typeof currentNode.textContent === "string" && regExpTest(ELEMENT_MARKUP_PROBE, currentNode.textContent))) return true;
    if (currentNode.nodeType === NODE_TYPE.processingInstruction) return true;
    if (SAFE_FOR_XML && currentNode.nodeType === NODE_TYPE.comment && regExpTest(COMMENT_MARKUP_PROBE, currentNode.data)) return true;
    return false;
  };
  const _matchesNameCheck = function _matchesNameCheck2(check, name) {
    if (check instanceof RegExp) return regExpTest(check, name);
    if (check instanceof Function) {
      for (var _len = arguments.length, args = new Array(_len > 2 ? _len - 2 : 0), _key = 2; _key < _len; _key++) args[_key - 2] = arguments[_key];
      return Boolean(check(name, ...args));
    }
    return false;
  };
  const _sanitizeDisallowedNode = function _sanitizeDisallowedNode2(currentNode, tagName, root) {
    if (!FORBID_TAGS[tagName] && _isBasicCustomElement(tagName) && _matchesNameCheck(CUSTOM_ELEMENT_HANDLING.tagNameCheck, tagName)) return false;
    if (KEEP_CONTENT && !FORBID_CONTENTS[tagName] && !FORBID_CONTENTS[stringToLowerCase(tagName)]) {
      const parentNode = getParentNode(currentNode);
      const childNodes = getChildNodes(currentNode);
      if (childNodes && parentNode) {
        const childCount = childNodes.length;
        for (let i = childCount - 1; i >= 0; --i) {
          const hoisted = currentNode === root ? cloneNode(childNodes[i], true) : childNodes[i];
          parentNode.insertBefore(hoisted, getNextSibling(currentNode));
        }
      }
    }
    _forceRemove(currentNode);
    return true;
  };
  const _forkSharedAllowlist = function _forkSharedAllowlist2(hookList, set, defaultSet, setConfigSet) {
    if (hookList.length === 0) return set;
    return set === defaultSet || set === setConfigSet ? clone(set) : set;
  };
  const _handleHookDetachedNode = function _handleHookDetachedNode2(currentNode, root) {
    if (currentNode === root || getParentNode(currentNode) !== null) return false;
    if (IN_PLACE) _neutralizeSubtree(currentNode);
    return true;
  };
  const _sanitizeElements = function _sanitizeElements2(currentNode, root) {
    _markVisited(currentNode);
    _executeHooks(hooks.beforeSanitizeElements, currentNode, null);
    if (_handleHookDetachedNode(currentNode, root)) return true;
    if (_isClobbered(currentNode)) {
      _forceRemove(currentNode);
      return true;
    }
    const tagName = transformCaseFunc(_readNodeName(currentNode));
    ALLOWED_TAGS = _forkSharedAllowlist(hooks.uponSanitizeElement, ALLOWED_TAGS, DEFAULT_ALLOWED_TAGS, SET_CONFIG_ALLOWED_TAGS);
    _executeHooks(hooks.uponSanitizeElement, currentNode, {
      tagName,
      allowedTags: ALLOWED_TAGS
    });
    if (_handleHookDetachedNode(currentNode, root)) return true;
    if (_isUnsafeNode(currentNode, tagName)) {
      _forceRemove(currentNode);
      return true;
    }
    if (FORBID_TAGS[tagName] || !(EXTRA_ELEMENT_HANDLING.tagCheck instanceof Function && EXTRA_ELEMENT_HANDLING.tagCheck(tagName)) && !ALLOWED_TAGS[tagName]) {
      const removed = _sanitizeDisallowedNode(currentNode, tagName, root);
      if (removed === false) {
        _executeHooks(hooks.afterSanitizeElements, currentNode, null);
        if (_handleHookDetachedNode(currentNode, root)) return true;
      }
      return removed;
    }
    if (_readNodeType(currentNode) === NODE_TYPE.element && !_checkValidNamespace(currentNode)) {
      _forceRemove(currentNode);
      return true;
    }
    if ((tagName === "noscript" || tagName === "noembed" || tagName === "noframes") && regExpTest(FALLBACK_TAG_CLOSE, currentNode.innerHTML)) {
      _forceRemove(currentNode);
      return true;
    }
    if (SAFE_FOR_TEMPLATES && currentNode.nodeType === NODE_TYPE.text) {
      const content = _stripTemplateExpressions(currentNode.textContent);
      if (currentNode.textContent !== content) {
        arrayPush(DOMPurify.removed, { element: currentNode.cloneNode() });
        currentNode.textContent = content;
      }
    }
    _executeHooks(hooks.afterSanitizeElements, currentNode, null);
    return _handleHookDetachedNode(currentNode, root);
  };
  const _isValidAttribute = function _isValidAttribute2(lcTag, lcName, value) {
    if (FORBID_ATTR[lcName]) return false;
    if (_isPatchLinkageAttribute(lcName, lcTag)) return false;
    if (SANITIZE_DOM && (lcName === "id" || lcName === "name") && (value in document2 || value in formElement)) return false;
    const nameIsPermitted = ALLOWED_ATTR[lcName] || EXTRA_ELEMENT_HANDLING.attributeCheck instanceof Function && EXTRA_ELEMENT_HANDLING.attributeCheck(lcName, lcTag);
    if (ALLOW_DATA_ATTR && regExpTest(DATA_ATTR$1, lcName)) return true;
    if (ALLOW_ARIA_ATTR && regExpTest(ARIA_ATTR$1, lcName)) return true;
    if (!nameIsPermitted) return _isBasicCustomElement(lcTag) && _matchesNameCheck(CUSTOM_ELEMENT_HANDLING.tagNameCheck, lcTag) && _matchesNameCheck(CUSTOM_ELEMENT_HANDLING.attributeNameCheck, lcName, lcTag) || lcName === "is" && CUSTOM_ELEMENT_HANDLING.allowCustomizedBuiltInElements && _matchesNameCheck(CUSTOM_ELEMENT_HANDLING.tagNameCheck, value);
    if (URI_SAFE_ATTRIBUTES[lcName]) return true;
    if (regExpTest(IS_ALLOWED_URI$1, stringReplace(value, ATTR_WHITESPACE$1, ""))) return true;
    if ((lcName === "src" || lcName === "xlink:href" || lcName === "href") && lcTag !== "script" && stringIndexOf(value, "data:") === 0 && DATA_URI_TAGS[lcTag]) return true;
    if (ALLOW_UNKNOWN_PROTOCOLS && !regExpTest(IS_SCRIPT_OR_DATA$1, stringReplace(value, ATTR_WHITESPACE$1, ""))) return true;
    return !value;
  };
  const RESERVED_CUSTOM_ELEMENT_NAMES = addToSet({}, [
    "annotation-xml",
    "color-profile",
    "font-face",
    "font-face-format",
    "font-face-name",
    "font-face-src",
    "font-face-uri",
    "missing-glyph"
  ]);
  const _isBasicCustomElement = function _isBasicCustomElement2(tagName) {
    return !RESERVED_CUSTOM_ELEMENT_NAMES[stringToLowerCase(tagName)] && regExpTest(CUSTOM_ELEMENT$1, tagName);
  };
  const _applyTrustedTypesToAttribute = function _applyTrustedTypesToAttribute2(lcTag, lcName, namespaceURI, value) {
    if (trustedTypesPolicy && typeof trustedTypes === "object" && typeof trustedTypes.getAttributeType === "function" && !namespaceURI) switch (trustedTypes.getAttributeType(lcTag, lcName)) {
      case "TrustedHTML":
        return _createTrustedHTML(value);
      case "TrustedScriptURL":
        return _createTrustedScriptURL(value);
    }
    return value;
  };
  const _setAttributeValue = function _setAttributeValue2(currentNode, name, namespaceURI, value) {
    try {
      if (namespaceURI) currentNode.setAttributeNS(namespaceURI, name, value);
      else currentNode.setAttribute(name, value);
      if (_isClobbered(currentNode)) {
        _forceRemove(currentNode);
        return false;
      }
      return true;
    } catch (_) {
      _removeAttribute(name, currentNode);
      return false;
    }
  };
  const _isUnsafeAttributeValue = function _isUnsafeAttributeValue2(name, value) {
    if (SAFE_FOR_XML && regExpTest(/((--!?|])>)|<\/(style|script|title|xmp|textarea|noscript|iframe|noembed|noframes)/i, value)) return true;
    return stringToLowerCase(name) === "attributename" && stringMatch(value, "href") !== null;
  };
  const _sanitizeAttributes = function _sanitizeAttributes2(currentNode, root) {
    _executeHooks(hooks.beforeSanitizeAttributes, currentNode, null);
    if (_handleHookDetachedNode(currentNode, root)) return;
    const attributes = currentNode.attributes;
    if (!attributes || _isClobbered(currentNode)) return;
    ALLOWED_ATTR = _forkSharedAllowlist(hooks.uponSanitizeAttribute, ALLOWED_ATTR, DEFAULT_ALLOWED_ATTR, SET_CONFIG_ALLOWED_ATTR);
    const hookEvent = {
      attrName: "",
      attrValue: "",
      keepAttr: true,
      allowedAttributes: ALLOWED_ATTR,
      forceKeepAttr: void 0
    };
    let l = attributes.length;
    const lcTag = transformCaseFunc(currentNode.nodeName);
    while (l--) {
      const attr = attributes[l];
      const name = attr.name, namespaceURI = attr.namespaceURI, attrValue = attr.value;
      const lcName = transformCaseFunc(name);
      const initValue = attrValue;
      let value = name === "value" ? initValue : stringTrim(initValue);
      let recreatedNamedProp = false;
      hookEvent.attrName = lcName;
      hookEvent.attrValue = value;
      hookEvent.keepAttr = true;
      hookEvent.forceKeepAttr = void 0;
      _executeHooks(hooks.uponSanitizeAttribute, currentNode, hookEvent);
      value = hookEvent.attrValue;
      if (SANITIZE_NAMED_PROPS && (lcName === "id" || lcName === "name") && stringIndexOf(value, SANITIZE_NAMED_PROPS_PREFIX) !== 0) {
        _removeAttribute(name, currentNode, attr);
        value = SANITIZE_NAMED_PROPS_PREFIX + value;
        recreatedNamedProp = true;
      }
      if (_isUnsafeAttributeValue(name, value)) {
        _removeAttribute(name, currentNode, attr);
        continue;
      }
      if (hookEvent.forceKeepAttr) continue;
      if (!hookEvent.keepAttr) {
        _removeAttribute(name, currentNode, attr);
        continue;
      }
      if (!ALLOW_SELF_CLOSE_IN_ATTR && regExpTest(SELF_CLOSING_TAG, value)) {
        _removeAttribute(name, currentNode, attr);
        continue;
      }
      if (SAFE_FOR_TEMPLATES) value = _stripTemplateExpressions(value);
      if (!_isValidAttribute(lcTag, lcName, value)) {
        _removeAttribute(name, currentNode, attr);
        continue;
      }
      value = _applyTrustedTypesToAttribute(lcTag, lcName, namespaceURI, value);
      if (value !== initValue) {
        if (_setAttributeValue(currentNode, name, namespaceURI, value) && recreatedNamedProp) arrayPop(DOMPurify.removed);
      }
    }
    _executeHooks(hooks.afterSanitizeAttributes, currentNode, null);
    _handleHookDetachedNode(currentNode, root);
  };
  const _sanitizeShadowDOM2 = function _sanitizeShadowDOM(fragment) {
    let shadowNode = null;
    const shadowIterator = _createNodeIterator(fragment);
    _executeHooks(hooks.beforeSanitizeShadowDOM, fragment, null);
    while (shadowNode = shadowIterator.nextNode()) {
      _executeHooks(hooks.uponSanitizeShadowNode, shadowNode, null);
      _sanitizeElements(shadowNode, fragment);
      _sanitizeAttributes(shadowNode, fragment);
      if (_isDocumentFragment(shadowNode.content)) _sanitizeShadowDOM2(shadowNode.content);
      if (_readNodeType(shadowNode) === NODE_TYPE.element) {
        const innerSr = getShadowRoot(shadowNode);
        if (_isDocumentFragment(innerSr)) {
          _sanitizeAttachedShadowRoots(innerSr);
          _sanitizeShadowDOM2(innerSr);
        }
      }
    }
    if (SAFE_FOR_TEMPLATES) _scrubOwnCharacterData(fragment);
    _executeHooks(hooks.afterSanitizeShadowDOM, fragment, null);
  };
  const _sanitizeAttachedShadowRoots = function _sanitizeAttachedShadowRoots2(root) {
    const stack = [{
      node: root,
      shadow: null
    }];
    while (stack.length > 0) {
      const item = stack.pop();
      if (item.shadow) {
        _sanitizeShadowDOM2(item.shadow);
        continue;
      }
      const node = item.node;
      const isElement = _readNodeType(node) === NODE_TYPE.element;
      const childNodes = getChildNodes(node);
      if (childNodes) for (let i = childNodes.length - 1; i >= 0; --i) stack.push({
        node: childNodes[i],
        shadow: null
      });
      if (isElement) {
        const rootName = getNodeName ? getNodeName(node) : null;
        if (typeof rootName === "string" && transformCaseFunc(rootName) === "template") {
          const content = node.content;
          if (_isDocumentFragment(content)) stack.push({
            node: content,
            shadow: null
          });
        }
      }
      if (isElement) {
        const sr = getShadowRoot(node);
        if (_isDocumentFragment(sr)) stack.push({
          node: null,
          shadow: sr
        }, {
          node: sr,
          shadow: null
        });
      }
    }
  };
  DOMPurify.sanitize = function(dirty) {
    let cfg = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : {};
    let body = null;
    let importedNode = null;
    let currentNode = null;
    let returnNode = null;
    IS_EMPTY_INPUT = !dirty;
    if (IS_EMPTY_INPUT) dirty = "<!-->";
    if (typeof dirty !== "string" && !_isNode(dirty)) {
      dirty = stringifyValue(dirty);
      if (typeof dirty !== "string") throw typeErrorCreate("dirty is not a string, aborting");
    }
    if (!DOMPurify.isSupported) return dirty;
    if (SET_CONFIG) {
      ALLOWED_TAGS = SET_CONFIG_ALLOWED_TAGS;
      ALLOWED_ATTR = SET_CONFIG_ALLOWED_ATTR;
    } else _parseConfig(cfg);
    if (hooks.uponSanitizeElement.length > 0 || hooks.uponSanitizeAttribute.length > 0) ALLOWED_TAGS = clone(ALLOWED_TAGS);
    if (hooks.uponSanitizeAttribute.length > 0) ALLOWED_ATTR = clone(ALLOWED_ATTR);
    DOMPurify.removed = [];
    const inPlace = IN_PLACE && typeof dirty !== "string" && _isNode(dirty);
    let inPlaceNodes = [];
    const outerVisited = IN_PLACE_VISITED;
    if (inPlace) {
      _neutralizePatchLinkage(dirty);
      const nn = _readNodeName(dirty);
      if (typeof nn === "string") {
        const tagName = transformCaseFunc(nn);
        if (!ALLOWED_TAGS[tagName] || FORBID_TAGS[tagName]) {
          _neutralizeRoot(dirty);
          throw typeErrorCreate("root node is forbidden and cannot be sanitized in-place");
        }
      }
      if (_isClobbered(dirty)) {
        _neutralizeRoot(dirty);
        throw typeErrorCreate("root node is clobbered and cannot be sanitized in-place");
      }
      inPlaceNodes = _collectLiveNodes(dirty);
      IN_PLACE_VISITED = setCreate();
    } else if (_isNode(dirty)) {
      body = _initDocument("<!---->");
      importedNode = body.ownerDocument.importNode(dirty, true);
      if (importedNode.nodeType === NODE_TYPE.element && importedNode.nodeName === "BODY") body = importedNode;
      else if (importedNode.nodeName === "HTML") body = importedNode;
      else body.appendChild(importedNode);
      _sanitizeAttachedShadowRoots(body);
    } else {
      if (!RETURN_DOM && !SAFE_FOR_TEMPLATES && !WHOLE_DOCUMENT && dirty.indexOf("<") === -1) return trustedTypesPolicy && RETURN_TRUSTED_TYPE ? _createTrustedHTML(dirty) : dirty;
      body = _initDocument(dirty);
      if (!body) return RETURN_DOM ? null : RETURN_TRUSTED_TYPE ? emptyHTML : "";
    }
    if (body && FORCE_BODY) _forceRemove(body.firstChild);
    const walkRoot = inPlace ? dirty : body;
    try {
      if (inPlace) _sanitizeAttachedShadowRoots(dirty);
      const nodeIterator = _createNodeIterator(walkRoot);
      while (currentNode = nodeIterator.nextNode()) {
        _sanitizeElements(currentNode, walkRoot);
        _sanitizeAttributes(currentNode, walkRoot);
        if (_isDocumentFragment(currentNode.content)) _sanitizeShadowDOM2(currentNode.content);
      }
      if (inPlace) _sanitizeUnvisitedNodes(dirty, inPlaceNodes);
    } catch (error) {
      if (inPlace) {
        _neutralizeRoot(dirty);
        _neutralizeDiscarded(dirty, inPlaceNodes);
      }
      throw error;
    } finally {
      IN_PLACE_VISITED = outerVisited;
    }
    if (inPlace) {
      if (_neutralizeDiscarded(dirty, inPlaceNodes)) throw typeErrorCreate("a node selected for removal could not be safely returned; refusing to sanitize in place");
      if (SAFE_FOR_TEMPLATES) _scrubTemplateExpressions2(dirty);
      return dirty;
    }
    if (RETURN_DOM) {
      if (SAFE_FOR_TEMPLATES) _scrubTemplateExpressions2(body);
      if (RETURN_DOM_FRAGMENT) {
        returnNode = createDocumentFragment.call(body.ownerDocument);
        while (body.firstChild) returnNode.appendChild(body.firstChild);
      } else returnNode = body;
      if (ALLOWED_ATTR.shadowroot || ALLOWED_ATTR.shadowrootmode) returnNode = importNode.call(originalDocument, returnNode, true);
      return returnNode;
    }
    let serializedHTML = WHOLE_DOCUMENT ? body.outerHTML : body.innerHTML;
    if (WHOLE_DOCUMENT && ALLOWED_TAGS["!doctype"] && body.ownerDocument && body.ownerDocument.doctype && body.ownerDocument.doctype.name && regExpTest(DOCTYPE_NAME, body.ownerDocument.doctype.name)) serializedHTML = "<!DOCTYPE " + body.ownerDocument.doctype.name + ">\n" + serializedHTML;
    if (SAFE_FOR_TEMPLATES) serializedHTML = _stripTemplateExpressions(serializedHTML);
    return trustedTypesPolicy && RETURN_TRUSTED_TYPE ? _createTrustedHTML(serializedHTML) : serializedHTML;
  };
  DOMPurify.setConfig = function() {
    let cfg = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : {};
    _parseConfig(cfg);
    SET_CONFIG = true;
    SET_CONFIG_ALLOWED_TAGS = ALLOWED_TAGS;
    SET_CONFIG_ALLOWED_ATTR = ALLOWED_ATTR;
  };
  DOMPurify.clearConfig = function() {
    CONFIG2 = null;
    SET_CONFIG = false;
    SET_CONFIG_ALLOWED_TAGS = null;
    SET_CONFIG_ALLOWED_ATTR = null;
    trustedTypesPolicy = defaultTrustedTypesPolicy;
    emptyHTML = "";
  };
  DOMPurify.isValidAttribute = function(tag, attr, value) {
    if (!CONFIG2) _parseConfig({});
    const lcTag = transformCaseFunc(tag);
    const lcName = transformCaseFunc(attr);
    if (typeof value === "string" && (_isUnsafeAttributeValue(attr, value) || !ALLOW_SELF_CLOSE_IN_ATTR && regExpTest(SELF_CLOSING_TAG, value))) return false;
    return _isValidAttribute(lcTag, lcName, value);
  };
  DOMPurify.addHook = function(entryPoint, hookFunction) {
    if (typeof hookFunction !== "function") return;
    if (!objectHasOwnProperty(hooks, entryPoint)) return;
    arrayPush(hooks[entryPoint], hookFunction);
  };
  DOMPurify.removeHook = function(entryPoint, hookFunction) {
    if (!objectHasOwnProperty(hooks, entryPoint)) return;
    if (hookFunction !== void 0) {
      const index = arrayLastIndexOf(hooks[entryPoint], hookFunction);
      return index === -1 ? void 0 : arraySplice(hooks[entryPoint], index, 1)[0];
    }
    return arrayPop(hooks[entryPoint]);
  };
  DOMPurify.removeHooks = function(entryPoint) {
    if (!objectHasOwnProperty(hooks, entryPoint)) return;
    hooks[entryPoint] = [];
  };
  DOMPurify.removeAllHooks = function() {
    hooks = _createHooksMap();
  };
  return DOMPurify;
}
var purify_default = createDOMPurify();
function setHTML(element, value) {
  const staging = element.cloneNode(false);
  staging.innerHTML = String(value ?? "");
  purify_default.sanitize(staging, { IN_PLACE: true, ADD_ATTR: ["target"], FORBID_TAGS: ["script", "iframe", "object", "embed"] });
  for (const link of staging.querySelectorAll('a[target="_blank"]')) link.setAttribute("rel", "noopener noreferrer");
  const selected = staging.tagName === "SELECT" ? Array.from(staging.options, (option) => option.selected) : null;
  element.replaceChildren(...Array.from(staging.childNodes));
  if (selected) Array.from(element.options).forEach((option, index) => {
    option.selected = selected[index];
  });
}
function insertHTML(element, position, value) {
  const staging = element.ownerDocument.createElement("div");
  setHTML(staging, value);
  const fragment = element.ownerDocument.createDocumentFragment();
  fragment.append(...Array.from(staging.childNodes));
  switch (position.toLowerCase()) {
    case "beforebegin":
      element.before(fragment);
      break;
    case "afterend":
      element.after(fragment);
      break;
    case "afterbegin":
      element.prepend(fragment);
      break;
    case "beforeend":
      element.append(fragment);
      break;
    default:
      throw new Error("Invalid insertion position");
  }
}
function escapeHTML(value = "") {
  return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}
function parseProm(text2) {
  const out = [];
  String(text2 || "").split("\n").forEach((line) => {
    line = line.trim();
    if (!line || line.startsWith("#")) return;
    const m = line.match(/^([a-zA-Z_:][\w:]*)({([^}]*)})?\s+([^\s]+)$/);
    if (!m) return;
    const labels = {};
    if (m[3]) {
      const re = /(\w+)="((?:\\.|[^"])*)"/g;
      let x;
      while (x = re.exec(m[3])) {
        labels[x[1]] = x[2].replace(/\\"/g, '"').replace(/\\\\/g, "\\");
      }
    }
    out.push({ name: m[1], labels, value: Number(m[4]) });
  });
  return out;
}
function metricFind(metrics, name, labels = {}) {
  const m = metrics.find((x) => x.name === name && Object.entries(labels).every(([k, v]) => x.labels[k] === v));
  return m ? m.value : 0;
}
let trafficService;
function initialize$m() {
  const finite = (n) => typeof n === "number" && Number.isFinite(n);
  const nonnegative = (n) => finite(n) && n >= 0;
  const definitions = {
    qps: { label: "QPS", unit: "QPS", note: "每秒 DNS 请求数 · 按实际采样秒数计算", count: "区间请求", empty: "正在建立查询采样基线，通常约 2 秒后显示数据" },
    cache: { label: "缓存命中率", unit: "%", note: "主缓存命中数 ÷ 主缓存查询数 · 区间均值按查询数加权", count: "缓存查询", empty: "所选时段暂无有效缓存查询，或核心未提供主缓存计数" },
    latency: { label: "平均延迟", unit: "ms", note: "上游实际响应的平均耗时 · 不包含缓存命中请求", count: "上游响应", empty: "所选时段暂无上游响应，或核心未提供延迟计数" }
  };
  function parse(text2) {
    const metrics = parseProm(text2);
    const get = (name, tag) => {
      const found = metrics.filter((p) => p.name === name && (tag === void 0 || p.labels.tag === tag));
      return found.length === 1 && nonnegative(found[0].value) ? found[0].value : null;
    };
    const upstreams = /* @__PURE__ */ new Map();
    for (const p of metrics) {
      const kind = p.name === "localdns_upstream_response_latency_millisecond_sum" ? "sum" : p.name === "localdns_upstream_response_latency_millisecond_count" ? "count" : null;
      if (!kind) continue;
      const key = JSON.stringify(Object.entries(p.labels).sort(([a], [b]) => a.localeCompare(b)));
      if (!upstreams.has(key)) upstreams.set(key, {});
      const row = upstreams.get(key);
      row[kind] = row[kind] === void 0 && nonnegative(p.value) ? p.value : null;
    }
    const latency = [...upstreams].sort(([a], [b]) => a.localeCompare(b));
    const valid = latency.length > 0 && latency.every(([, p]) => nonnegative(p.sum) && nonnegative(p.count));
    return {
      total: get("localdns_queries_total"),
      start: get("process_start_time_seconds"),
      cacheQueries: get("localdns_cache_query_total", "cache_main"),
      cacheHits: get("localdns_cache_hit_total", "cache_main"),
      upstreams: valid ? latency.map(([key, p]) => [key, p.sum, p.count]) : null
    };
  }
  function raw(sample, now) {
    const upstreams = Array.isArray(sample.upstreams) && sample.upstreams.length <= 1024 && sample.upstreams.every((p) => Array.isArray(p) && p.length === 3 && typeof p[0] === "string" && p[0].length < 8192 && nonnegative(p[1]) && nonnegative(p[2])) ? sample.upstreams : null;
    return {
      time: now,
      total: sample.total,
      breakBefore: sample.breakBefore === true,
      start: nonnegative(sample.start) ? sample.start : null,
      cacheQueries: nonnegative(sample.cacheQueries) ? sample.cacheQueries : null,
      cacheHits: nonnegative(sample.cacheHits) ? sample.cacheHits : null,
      upstreams
    };
  }
  function record2(series, sample, now = Date.now()) {
    var _a2;
    if (!nonnegative(sample == null ? void 0 : sample.total) || !nonnegative(now)) return false;
    const previous = series.at(-1);
    if (previous && now - previous.time < 1500) return false;
    const next = raw(sample, now), elapsed = previous ? (now - previous.time) / 1e3 : 0;
    const valid = !!previous && !next.breakBefore && elapsed > 0 && elapsed <= 90 && previous.start === next.start && next.total >= previous.total;
    const difference = (a, b) => nonnegative(a) && nonnegative(b) && a >= b ? a - b : null;
    next.elapsed = valid ? elapsed : 0;
    next.delta = valid ? next.total - previous.total : null;
    next.qps = valid ? next.delta / elapsed : null;
    next.cacheQueriesDelta = valid ? difference(next.cacheQueries, previous.cacheQueries) : null;
    next.cacheHitsDelta = valid ? difference(next.cacheHits, previous.cacheHits) : null;
    next.cache = next.cacheQueriesDelta > 0 && next.cacheHitsDelta !== null && next.cacheHitsDelta <= next.cacheQueriesDelta ? next.cacheHitsDelta / next.cacheQueriesDelta * 100 : null;
    next.responseCount = next.responseSum = next.latency = null;
    if (valid && next.upstreams && previous.upstreams && next.upstreams.length === previous.upstreams.length) {
      let count = 0, sum = 0, consistent = true;
      next.upstreams.forEach(([key, s, c], i) => {
        const old = previous.upstreams[i];
        if (key !== old[0] || s < old[1] || c < old[2]) consistent = false;
        else {
          sum += s - old[1];
          count += c - old[2];
        }
      });
      if (consistent && count > 0) {
        next.responseCount = count;
        next.responseSum = sum;
        next.latency = sum / count;
      }
    }
    for (const key of ["qps", "cache", "latency"]) if (!nonnegative(next[key])) next[key] = null;
    series.push(next);
    while (series.length > 21602 || ((_a2 = series[0]) == null ? void 0 : _a2.time) < now - 864e5) series.shift();
    return true;
  }
  function weight(p, metric) {
    return metric === "cache" ? p.cacheQueriesDelta : metric === "latency" ? p.responseCount : p.elapsed;
  }
  function numerator(p, metric) {
    return metric === "cache" ? p.cacheHitsDelta * 100 : metric === "latency" ? p.responseSum : p.delta;
  }
  function summary(series, minutes = 60, now = Date.now(), metric = "qps") {
    if (!definitions[metric]) metric = "qps";
    const cutoff = now - minutes * 6e4;
    const rows = series.filter((p) => p.time >= cutoff && p.time <= now);
    const points = rows.map((p) => ({ ...p, value: p.time - p.elapsed * 1e3 >= cutoff ? p[metric] : null }));
    const valid = points.filter((p) => nonnegative(p.value) && p.elapsed > 0 && weight(p, metric) > 0);
    const requests = points.filter((p) => p.qps !== null && p.time - p.elapsed * 1e3 >= cutoff).reduce((n, p) => n + p.delta, 0);
    const denominator = valid.reduce((n, p) => n + weight(p, metric), 0);
    const total = valid.reduce((n, p) => n + numerator(p, metric), 0);
    const latest = series.at(-1), stale = !!latest && now - latest.time > 9e4;
    const firstIndex = points.findIndex((p) => nonnegative(p.value));
    return {
      points: firstIndex < 0 ? [] : points.slice(firstIndex),
      samples: valid.length,
      requests,
      count: metric === "qps" ? requests : denominator,
      seconds: valid.reduce((n, p) => n + p.elapsed, 0),
      average: denominator ? total / denominator : null,
      peak: valid.reduce((peak, p) => peak === null ? p.value : Math.max(peak, p.value), null),
      current: latest && !stale && now >= latest.time && nonnegative(latest[metric]) ? latest[metric] : null,
      stale,
      interval: (latest == null ? void 0 : latest.elapsed) || 0
    };
  }
  function aggregate(points, metric = "qps", limit = 480) {
    if (!points.length) return [];
    const first = points[0].time, step = Math.max(1, Math.ceil((points.at(-1).time - first + 1) / limit));
    const buckets = /* @__PURE__ */ new Map();
    let gap = false;
    for (const p of points) {
      const value = Object.hasOwn(p, "value") ? p.value : p.qps;
      if (!nonnegative(value)) {
        gap = true;
        continue;
      }
      const key = Math.floor((p.time - first) / step);
      if (!buckets.has(key)) buckets.set(key, { time: p.time, from: p.time - p.elapsed * 1e3, elapsed: 0, total: 0, weight: 0, peak: value, count: 0, breakBefore: gap });
      const b = buckets.get(key);
      b.breakBefore || (b.breakBefore = gap);
      b.time = p.time;
      b.elapsed += p.elapsed;
      b.total += numerator(p, metric);
      b.weight += weight(p, metric);
      b.peak = Math.max(b.peak, value);
      b.count++;
      gap = false;
    }
    const result = [];
    for (const b of buckets.values()) {
      if (b.breakBefore && result.length) result.push({ time: b.from, value: null });
      result.push({ ...b, value: b.total / b.weight });
    }
    if (gap) result.push({ time: points.at(-1).time, value: null });
    return result;
  }
  const rate = (n) => finite(n) ? n.toLocaleString("zh-CN", { maximumFractionDigits: 2 }) : "—";
  const time = (n, date = false) => new Date(n).toLocaleString("zh-CN", date ? { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false } : { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  function chart2(points, width = 660, metric = "qps", inspected = null) {
    const ps = aggregate(points, metric), definition = definitions[metric];
    const w = Math.max(280, Math.round(width)), h = 216, left = 48, right = 16, top = 26, bottom = 30;
    const first = points[0].time, last = points.at(-1).time, span = last - first || 1;
    const peak = ps.reduce((n, p) => finite(p.value) ? Math.max(n, p.peak) : n, 0);
    const magnitude = 10 ** Math.floor(Math.log10(peak || 1));
    const max = metric === "cache" ? 100 : Math.max(1, Math.ceil(peak / magnitude) * magnitude);
    const x = (p) => left + (p.time - first) / span * (w - left - right), y = (v) => top + (1 - v / max) * (h - top - bottom);
    const groups = [];
    let group = [];
    for (const p of ps) {
      if (!finite(p.value)) {
        if (group.length) groups.push(group);
        group = [];
      } else group.push(p);
    }
    if (group.length) groups.push(group);
    const paths = groups.map((g) => {
      const d = g.map((p, i) => `${i ? "L" : "M"}${x(p).toFixed(2)},${y(p.value).toFixed(2)}`).join(" ");
      return (g.length > 1 ? `<path class="traffic-area" d="${d} L${x(g.at(-1))},${h - bottom} L${x(g[0])},${h - bottom} Z"/>` : "") + `<path class="traffic-line" d="${d}"/>` + g.map((p) => (p.count > 1 && p.peak > p.value ? `<line class="traffic-peak" x1="${x(p)}" x2="${x(p)}" y1="${y(p.value)}" y2="${y(p.peak)}"/>` : "") + `<circle class="traffic-point" cx="${x(p)}" cy="${y(p.value)}" r="${g.length === 1 ? 3 : 1.7}"><title>${time(p.time, true)} · ${rate(p.value)} ${definition.unit} · 峰值 ${rate(p.peak)} ${definition.unit}</title></circle>`).join("");
    }).join("");
    const tick = (v) => v >= 1e4 ? v.toLocaleString("zh-CN", { notation: "compact", maximumFractionDigits: 1 }) : v >= 1e3 ? v.toLocaleString("zh-CN", { maximumFractionDigits: 0 }) : rate(v);
    const grids = [0, max / 2, max].map((v) => `<line class="traffic-grid" x1="${left}" x2="${w - right}" y1="${y(v)}" y2="${y(v)}"/><text x="${left - 8}" y="${y(v) + 4}" text-anchor="end">${tick(v)}</text>`).join("");
    const ticks = first === last ? [first] : [first, ...w >= 480 ? [(first + last) / 2] : [], last];
    return `<div class="traffic-plot" tabindex="0" role="group" aria-label="${definition.label}趋势，单位 ${definition.unit}。左右方向键查看采样，Escape 关闭提示。"><svg class="console-chart traffic-chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="${definition.label}，${time(first, true)} 至 ${time(last, true)}，单位 ${definition.unit}"><title>按实际采样显示，断采不连线；长范围按请求量汇总并保留峰值</title><text class="traffic-axis-unit" x="${left}" y="14">${definition.unit}</text>${grids}${paths}${ticks.map((t, i) => `<text x="${left + (t - first) / span * (w - left - right)}" y="${h - 7}" text-anchor="${i === 0 ? "start" : i === ticks.length - 1 ? "end" : "middle"}">${time(t, span >= 432e5)}</text>`).join("")}<line class="traffic-inspect-line" x1="0" x2="0" y1="${top}" y2="${h - bottom}" visibility="hidden"/></svg><output class="traffic-tooltip" hidden></output><span class="sr-only traffic-live" aria-live="polite"></span></div>`;
  }
  function inspect(container, points, metric) {
    const plot = container.querySelector(".traffic-plot");
    if (!plot) return;
    const ps = aggregate(points, metric).filter((p) => finite(p.value)), svg2 = plot.querySelector("svg"), tip = plot.querySelector("output"), line = plot.querySelector(".traffic-inspect-line");
    let index = -1, pinned = false;
    function show(i, announce = false) {
      index = Math.max(0, Math.min(ps.length - 1, i));
      const p = ps[index];
      if (!p) return;
      const w = svg2.viewBox.baseVal.width, span = points.at(-1).time - points[0].time || 1;
      const x = 48 + (p.time - points[0].time) / span * (w - 64);
      line.setAttribute("x1", x);
      line.setAttribute("x2", x);
      line.setAttribute("visibility", "visible");
      tip.hidden = false;
      tip.textContent = `${time(p.from, true)}—${time(p.time, true)} · ${rate(p.value)} ${definitions[metric].unit}${p.count > 1 ? ` · 峰值 ${rate(p.peak)} ${definitions[metric].unit}` : ""}`;
      if (announce) plot.querySelector(".traffic-live").textContent = tip.textContent;
    }
    function hide() {
      tip.hidden = true;
      line.setAttribute("visibility", "hidden");
    }
    plot.onpointermove = (event) => {
      const rect = svg2.getBoundingClientRect(), w = svg2.viewBox.baseVal.width;
      const target = points[0].time + ((event.clientX - rect.left) / rect.width * w - 48) / (w - 64) * (points.at(-1).time - points[0].time);
      let low = 0, high = ps.length - 1;
      while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (ps[middle].time < target) low = middle + 1;
        else high = middle;
      }
      if (low && Math.abs(ps[low - 1].time - target) < Math.abs(ps[low].time - target)) low--;
      show(low);
    };
    plot.onpointerleave = () => {
      if (!pinned) hide();
    };
    plot.onblur = () => {
      pinned = false;
      hide();
    };
    plot.onpointerdown = (event) => {
      pinned = event.pointerType === "touch";
      plot.onpointermove(event);
      if (pinned) plot.focus({ preventScroll: true });
    };
    plot.onkeydown = (event) => {
      if (event.key === "Escape") {
        pinned = false;
        hide();
        return;
      }
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      show(event.key === "Home" ? 0 : event.key === "End" ? ps.length - 1 : index < 0 ? ps.length - 1 : index + (event.key === "ArrowLeft" ? -1 : 1), true);
    };
  }
  function render(container, series, minutes, now = Date.now(), state2 = {}) {
    var _a2, _b2, _c, _d;
    const metric = definitions[state2.metric] ? state2.metric : "qps", definition = definitions[metric], s = summary(series, minutes, now, metric);
    const focus = container.contains(document.activeElement) ? (_a2 = document.activeElement) == null ? void 0 : _a2.dataset.trafficMetric : null;
    const plotFocused = ((_b2 = document.activeElement) == null ? void 0 : _b2.classList.contains("traffic-plot")) && container.contains(document.activeElement);
    const item = (label, value, unit) => `<div><dt>${label}</dt><dd>${value}<small>${unit}</small></dd></div>`;
    setHTML(container, `<div class="traffic-metric-tabs" role="group" aria-label="选择 DNS 趋势指标">${Object.entries(definitions).map(([key, d]) => `<button type="button" data-traffic-metric="${key}" aria-pressed="${metric === key}">${d.label}</button>`).join("")}</div><p class="traffic-metric-note">${definition.note}</p><dl class="traffic-summary">${item("最近采样", rate(s.current), definition.unit)}${item("区间均值", rate(s.average), definition.unit)}${item("区间峰值", rate(s.peak), definition.unit)}${item(definition.count, s.samples ? rate(s.count) : "—", "次")}</dl>` + (s.samples ? chart2(s.points, container.clientWidth, metric) : `<div class="console-chart-empty">${state2.loading && !series.length ? "正在读取 DNS 采样，本机历史在后台恢复…" : definition.empty}<br>${series.length && metric === "qps" ? "已读取查询计数，正在等待下一次采样" : "未采集和无有效请求的区间不补零"}</div>`) + `<div class="traffic-caption"><span>${s.stale ? "采样暂时中断，正在自动重试" : s.samples ? `有效采样 ${rate(s.seconds)} 秒 · 最近间隔 ${rate(s.interval)} 秒` : "概览可见时每 5 秒采样"}</span><span>本浏览器保留 24 小时 · 当前 ${{ 15: "15 分钟", 60: "1 小时", 360: "6 小时", 1440: "24 小时" }[minutes] || minutes + " 分钟"}</span></div><p class="traffic-storage-note">${state2.storageError ? "本机历史存储暂不可用，新增采样仅临时保留。" : "刷新后可继续查看本机历史。"}关闭网页、切换页面或后台休眠期间留空。</p>`);
    if (state2.error) {
      const error = document.createElement("div");
      error.className = "traffic-read-error";
      error.setAttribute("role", "status");
      const message = document.createElement("span");
      message.textContent = state2.error;
      const retry = document.createElement("button");
      retry.type = "button";
      retry.className = "button small";
      retry.dataset.trafficRetry = "";
      retry.textContent = "重新读取";
      error.append(message, retry);
      container.append(error);
    }
    inspect(container, s.points, metric);
    if (definitions[focus]) (_c = container.querySelector(`[data-traffic-metric="${focus}"]`)) == null ? void 0 : _c.focus({ preventScroll: true });
    if (plotFocused) (_d = container.querySelector(".traffic-plot")) == null ? void 0 : _d.focus({ preventScroll: true });
  }
  trafficService = { parse, raw, record: record2, summary, aggregate, chart: chart2, render, definitions };
}
class TrafficRepository {
  constructor(factory = () => globalThis.indexedDB) {
    this.factory = factory;
  }
  transaction(mode, run) {
    return new Promise((resolve, reject) => {
      let settled = false, database, transaction;
      let value;
      const finish = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        database == null ? void 0 : database.close();
        if (error) reject(error);
        else resolve(value);
      };
      const timer = setTimeout(() => {
        try {
          transaction == null ? void 0 : transaction.abort();
        } catch {
        }
        finish(new Error("浏览器历史存储响应超时"));
      }, 8e3);
      let request2;
      try {
        request2 = this.factory().open("localdns-dns-trends", 1);
      } catch (error) {
        finish(error);
        return;
      }
      request2.onupgradeneeded = () => {
        const store = request2.result.createObjectStore("samples", { keyPath: ["source", "slot"] });
        store.createIndex("time", "time");
      };
      request2.onerror = () => finish(request2.error || new Error("无法打开浏览器历史存储"));
      request2.onblocked = () => finish(new Error("浏览器历史存储被其他标签页占用"));
      request2.onsuccess = () => {
        database = request2.result;
        if (settled) {
          database.close();
          return;
        }
        try {
          transaction = database.transaction("samples", mode);
          transaction.oncomplete = () => finish();
          transaction.onabort = () => finish((transaction == null ? void 0 : transaction.error) || new Error("浏览器未能保存采样"));
          transaction.onerror = () => finish((transaction == null ? void 0 : transaction.error) || new Error("浏览器历史读取失败"));
          run(transaction.objectStore("samples"), (result) => {
            value = result;
          });
        } catch (error) {
          finish(error);
        }
      };
    });
  }
  load(source, now = Date.now()) {
    return this.transaction("readonly", (store, done) => {
      const rows = [];
      const query = IDBKeyRange.bound([source, Math.floor((now - 864e5) / 5e3)], [source, Math.floor(now / 5e3)]);
      const cursor = store.openCursor(query);
      cursor.onsuccess = () => {
        const item = cursor.result;
        if (!item) {
          done(rows.sort((a, b) => Number(a.time) - Number(b.time)));
          return;
        }
        if (Number(item.value.time) >= now - 864e5 && Number(item.value.time) <= now && rows.length < 22e3) rows.push(item.value);
        item.continue();
      };
    });
  }
  save(source, sample, now = Date.now()) {
    const time = Number(sample.time);
    return this.transaction("readwrite", (store, done) => {
      const slot = Math.floor(time / 5e3), existing = store.get([source, slot]);
      existing.onsuccess = () => {
        if (!existing.result || Number(existing.result.time) < time) store.put({ ...sample, source, slot });
      };
      const expired = store.index("time").openCursor(IDBKeyRange.upperBound(now - 864e5, true));
      expired.onsuccess = () => {
        const item = expired.result;
        if (item) {
          item.delete();
          item.continue();
        }
      };
      done(void 0);
    });
  }
}
const trafficRepository = new TrafficRepository();
let trafficClientService;
function initialize$l() {
  const series = [];
  let range = 60, metric = "qps", pending = null, lastAttempt = 0, error = "", storageError = "", loading = true, mountedScope, breakNext = true;
  const overview = () => !location.hash || location.hash === "#/overview" || location.hash === "#overview";
  const base = () => {
    var _a2;
    return new URL(String(((_a2 = window.LOCALDNS_UI_CONFIG) == null ? void 0 : _a2.apiBase) || location.origin).replace(/\/$/, ""), location.origin);
  };
  const source = base().href.replace(/\/$/, "");
  const ready = trafficRepository.load(source).then((rows) => {
    const combined = rows.concat(series.map((p) => trafficService.raw(p, p.time))).sort((a, b) => a.time - b.time);
    series.length = 0;
    for (const row of combined) trafficService.record(series, row, row.time);
  }).catch(() => {
    storageError = "无法读取浏览器历史";
  }).finally(() => {
    loading = false;
    redraw();
  });
  function draw(container, minutes = range) {
    if (!(container == null ? void 0 : container.isConnected)) return;
    range = minutes;
    container.dataset.trafficMinutes = String(minutes);
    trafficService.render(container, series, minutes, Date.now(), { metric, error, storageError, loading });
  }
  function redraw() {
    for (const container of document.querySelectorAll(".traffic-chart-body")) draw(container, Number(container.dataset.trafficMinutes) || range);
  }
  async function refresh(force = false) {
    const scope = currentScope();
    if ((pending == null ? void 0 : pending.scope) === scope) return pending.promise;
    if (!force && Date.now() - lastAttempt < 4e3) return;
    lastAttempt = Date.now();
    const controller = new AbortController(), release = scope.add(() => controller.abort());
    const request2 = { scope, controller };
    pending = request2;
    request2.promise = (async () => {
      try {
        throwIfAborted(scope.signal);
        const response = await assetHttp.fetch(new URL(source + "/metrics"), { cache: "no-store", signal: controller.signal, credentials: "omit" });
        if (!response.ok) throw new Error("无法读取 DNS 查询采样");
        const sample = trafficService.parse(await response.text());
        if (sample.total === null) throw new Error("DNS 核心未返回查询计数");
        throwIfAborted(scope.signal);
        const recorded = trafficService.record(series, { ...sample, breakBefore: breakNext });
        error = "";
        if (recorded) {
          breakNext = false;
          redraw();
          trafficRepository.save(source, trafficService.raw(series.at(-1), series.at(-1).time)).then(() => {
            storageError = "";
            if (!scope.signal.aborted) redraw();
          }).catch(() => {
            storageError = "无法保存浏览器历史";
            if (!scope.signal.aborted) redraw();
          });
        }
      } catch {
        if (!scope.signal.aborted) error = "DNS 趋势采样暂时不可用，请检查连接后重新读取。";
      } finally {
        release();
        if (pending === request2) pending = null;
        if (!scope.signal.aborted) redraw();
      }
    })();
    return request2.promise;
  }
  function start(scope = currentScope()) {
    if (scope === mountedScope) return;
    mountedScope = scope;
    scope.add(() => {
      if (!overview() || document.visibilityState !== "visible") breakNext = true;
    });
    scope.interval(() => {
      if (document.visibilityState === "visible") refresh(true);
    }, 5e3);
    if (breakNext || !series.length) scope.timeout(() => {
      if (document.visibilityState === "visible") refresh(true);
    }, 2e3);
    scope.listen(document, "visibilitychange", () => {
      if (document.visibilityState === "visible") refresh(true);
      else breakNext = true;
    });
    scope.listen(document, "freeze", () => {
      breakNext = true;
    });
    scope.listen(window, "focus", () => refresh(true));
    scope.listen(document, "click", (event) => {
      const button = event.target.closest("[data-traffic-metric]");
      if ((button == null ? void 0 : button.closest(".traffic-chart-body")) && trafficService.definitions[button.dataset.trafficMetric]) {
        metric = button.dataset.trafficMetric;
        redraw();
      }
      if (event.target.closest("[data-traffic-retry]")) refresh(true);
    });
    refresh(true);
  }
  function mount2(container, minutes) {
    draw(container, minutes);
    start();
  }
  trafficClientService = { render: draw, refresh, start, mount: mount2, ready };
}
let shellInterfaceService;
function initialize$k() {
  "use strict";
  const $2 = (s, r = document) => r.querySelector(s), $$2 = (s, r = document) => [...r.querySelectorAll(s)];
  const drafts = /* @__PURE__ */ new Map(), series = [];
  let connected = null, lastSuccess = null, lastFocus = null, draftKey = "", observer = null, scheduled = false, shortcutsOpen = false, trafficRange = 60, trafficResize = null;
  const route = () => location.hash.replace(/^#\/?/, "") || "overview";
  const escape = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const labels = { r1: "国内域名", r2: "白名单与自定义", r3: "海外域名", r4: "FakeIP 与灰名单", r5: "广告与追踪拦截", r6: "黑名单与类型过滤", g1: "国内解析组", g2: "海外解析组", g3: "海外 ECS 组", g4: "代理解析组", g5: "本地拦截" };
  const activeTag = () => {
    var _a2;
    return (_a2 = $2(".rule-menu button.active")) == null ? void 0 : _a2.dataset.ruleTag;
  };
  function persistDrafts() {
    try {
      sessionPreferences.setItem(draftKey, JSON.stringify([...drafts]));
    } catch {
    }
  }
  function rememberDraft() {
    const text2 = $2("#rule-text"), tag = activeTag();
    if (text2 && tag && text2.dataset.original !== void 0) {
      if (text2.value !== text2.dataset.original) drafts.set(tag, text2.value);
      else drafts.delete(tag);
      persistDrafts();
    }
  }
  function updateBrand() {
    if (identityService) {
      identityService.apply();
      return;
    }
    const light = document.documentElement.dataset.theme === "light-glass";
    const base = light ? "logo-04-light" : "logo-08-dark";
    const img = $2("#brand-mark");
    if (img) img.src = `assets/img/${base}.png?v=20261015-2`;
    const favicon = $2("#dynamic-favicon");
    if (favicon) {
      favicon.type = "image/png";
      favicon.href = `assets/img/${base}-64.png?v=20261015-2`;
    }
  }
  function connection(ok, text2 = "") {
    var _a2;
    if (typeof ok === "boolean") {
      connected = ok;
      if (ok) lastSuccess = /* @__PURE__ */ new Date();
    }
    const status = $2("#connection-status");
    if (!status) return;
    status.classList.toggle("offline", connected === false);
    $2(".console-connection-text", status).textContent = connected === null ? "连接中" : connected ? "已连接" : "连接已断开";
    const time = lastSuccess ? lastSuccess.toLocaleTimeString("zh-CN", { hour12: false }) : null;
    $2("small", status).textContent = connected === false ? time ? `最后更新 ${time}` : "当前数据不可用" : time ? `更新于 ${time}` : "正在读取运行数据";
    status.title = connected === false ? String(text2 || "连接异常") : "API " + (((_a2 = window.LOCALDNS_UI_CONFIG) == null ? void 0 : _a2.apiBase) || location.host);
    const brandStatus = $2(".console-brand-status");
    if (brandStatus) {
      brandStatus.classList.toggle("offline", connected === false);
      brandStatus.classList.toggle("pending", connected === null);
      brandStatus.setAttribute("aria-label", $2(".console-connection-text", status).textContent);
      brandStatus.title = $2(".console-connection-text", status).textContent;
    }
    const mobile = $2(".console-mobile-status");
    if (mobile) {
      mobile.classList.toggle("offline", connected === false);
      mobile.textContent = (connected === null ? "连接中" : connected ? "已连接" : "连接已断开") + (time ? ` · ${connected === false ? "最后更新" : "更新于"} ${time}` : "");
    }
    const health = $2(".console-service-health");
    if (health) {
      health.classList.toggle("offline", connected === false);
      $2("#service-summary-title", health).textContent = connected === false ? "DNS 服务连接已断开" : connected === true ? "DNS 服务运行中" : "正在读取服务状态";
      $2(".service-connection", health).textContent = connected === null ? "连接中" : connected ? "已连接" : "已断开";
      $2("[data-service-check]", health).setAttribute("d", connected === false ? "m8 8 8 8m0-8-8 8" : "m7 12 3 3 7-7");
    }
  }
  function recordMetrics() {
  }
  function tinyPath(values, width = 100, height = 32) {
    const min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
    return values.map((v, i) => `${i ? "L" : "M"}${(i / (values.length - 1) * (width - 4) + 2).toFixed(1)},${(height - 4 - (v - min) / span * (height - 10)).toFixed(1)}`).join(" ");
  }
  function drawTraffic(container, minutes = trafficRange) {
    trafficClientService.mount(container, minutes);
  }
  function overview() {
    var _a2, _b2, _c;
    const main = $2("#page-content");
    if ($2(".console-kpi", main) || !$2(".spark-kpi-card", main)) return;
    (_a2 = $2("#btn-overview-custom-bg")) == null ? void 0 : _a2.remove();
    const title = $2(".view-title-row"), short = document.createElement("details");
    short.className = "console-shortcuts";
    short.open = shortcutsOpen;
    setHTML(short, '<summary><strong>快捷控制</strong><span>客户端分流 / 缓存 / 广告屏蔽</span></summary><div class="console-shortcut-grid"></div>');
    short.addEventListener("toggle", () => shortcutsOpen = short.open);
    $$2(".control-bar-card", main).forEach((card2) => {
      const old = card2.parentElement;
      $2(".console-shortcut-grid", short).append(card2);
      old.remove();
    });
    title.after(short);
    $$2(".spark-kpi-card", main).forEach((card2, i) => {
      card2.parentElement.classList.add("console-kpi");
      const key = ["total", "cache", "clients", "blocked", "latency", "domains"][i];
      const values = series.slice(-60).map((p) => p[key]).filter(Number.isFinite);
      const svg2 = $2(".sk-chart", card2);
      if (svg2) {
        if (values.length < 2) {
          svg2.remove();
        } else {
          setHTML(svg2, `<path d="${tinyPath(values)}" fill="none" stroke="var(--console-line)" stroke-width="1.8"/>`);
          svg2.setAttribute("aria-label", "当前会话采样趋势");
        }
      }
    });
    const service = $2(".console-service-summary", main);
    if (service) {
      $$2(".console-kpi", main).forEach((kpi) => service.append(kpi));
      (_b2 = $2(".view-title-row>div:first-child>.mono", main)) == null ? void 0 : _b2.remove();
    }
    const topo = $2(".topology-glass-card");
    topo.parentElement.classList.add("console-topology");
    if (!$2(".console-topology-heading", topo)) insertHTML(topo, "afterbegin", '<div class="console-topology-heading"><h2>DNS 解析路径</h2><span>选择节点锁定路径，再查看详情或相关查询 · 连线为解析路径示意</span></div>');
    const trend = $2(".traffic-chart-body");
    trend.closest(".col-8").classList.add("console-trend");
    const head = $2(".gc-head", trend.closest(".glass-card"));
    setHTML($2(".gc-title", head), 'DNS 趋势<span class="console-chart-sub">切换指标查看趋势 · 历史保存在当前浏览器</span>');
    const range = head.lastElementChild;
    range.className = "console-range";
    range.removeAttribute("style");
    range.setAttribute("role", "group");
    range.setAttribute("aria-label", "DNS 趋势时间范围");
    setHTML(range, [[15, "15 分钟"], [60, "1 小时"], [360, "6 小时"], [1440, "24 小时"]].map(([m, label]) => `<button type="button" data-chart-range="${m}" aria-pressed="${trafficRange === m}">${label}</button>`).join(""));
    drawTraffic(trend);
    $$2("[data-chart-range]", head).forEach((b) => b.onclick = () => {
      trafficRange = +b.dataset.chartRange;
      $$2("[data-chart-range]", head).forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      drawTraffic(trend);
    });
    trafficResize == null ? void 0 : trafficResize.disconnect();
    let trafficWidth = trend.clientWidth;
    const chartResize = new ResizeObserver(() => {
      if (!trend.isConnected) {
        chartResize.disconnect();
        return;
      }
      if (Math.abs(trend.clientWidth - trafficWidth) > 1) {
        trafficWidth = trend.clientWidth;
        drawTraffic(trend);
      }
    });
    trafficResize = chartResize;
    chartResize.observe(trend);
    (_c = $2(".outbound-donut-body")) == null ? void 0 : _c.closest(".col-4").classList.add("console-donut");
    $$2(".uniform-4rows").forEach((e) => {
      var _a3;
      return (_a3 = e.closest(".col-4")) == null ? void 0 : _a3.classList.add("console-lower");
    });
    $$2(".t-node").forEach((node) => {
      const name = $2(".tn-name", node), sub = $2(".tn-sub", node);
      if (!node.title) node.title = [name == null ? void 0 : name.textContent, sub == null ? void 0 : sub.textContent].filter(Boolean).join(" · ");
      if (labels[node.dataset.nodeId] && !$2(".tn-proto-tag", name)) name.textContent = labels[node.dataset.nodeId];
      if (node.dataset.nodeId === "e_core") node.setAttribute("aria-label", "查看多级缓存管理");
    });
    const names = { whitelist: "白名单", greylist: "灰名单", blocklist: "黑名单" };
    $$2(".rl-name").forEach((e) => {
      const t = e.lastChild;
      if ((t == null ? void 0 : t.nodeType) === 3) t.textContent = names[t.textContent.trim()] || t.textContent;
    });
    requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
  }
  function semantics(root = document) {
    $$2("input:not([type=file]),select,textarea", root).forEach((input) => {
      var _a2, _b2, _c, _d, _e;
      const field = input.closest(".field"), label = field && $2("label", field);
      if (label && input.id) label.htmlFor = input.id;
      if (input.type === "checkbox" && !input.getAttribute("aria-label")) input.setAttribute("aria-label", ((_b2 = (_a2 = input.closest(".feature-card")) == null ? void 0 : _a2.querySelector("h3")) == null ? void 0 : _b2.textContent) || ((_d = (_c = input.closest("tr")) == null ? void 0 : _c.querySelector("strong")) == null ? void 0 : _d.textContent) || ((_e = input.closest("label")) == null ? void 0 : _e.textContent.trim()) || "启用");
    });
    $$2(".t-node,.spark-kpi-card,[data-route]", root).forEach((el) => {
      if (!["BUTTON", "A"].includes(el.tagName)) {
        el.tabIndex = 0;
        el.setAttribute("role", "button");
        if (!el.dataset.consoleKeyboard) {
          el.dataset.consoleKeyboard = "1";
          el.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              el.click();
            }
          });
        }
      }
    });
    $$2("[data-route]", root).forEach((el) => {
      if (el.classList.contains("active")) el.setAttribute("aria-current", "page");
      else el.removeAttribute("aria-current");
    });
    $$2(".seg-item", root).forEach((el) => el.setAttribute("aria-pressed", String(el.classList.contains("active"))));
    $$2("table", root).forEach((table) => {
      const heads = $$2("thead th", table).map((x) => x.textContent.trim());
      if (!heads.length) return;
      const dedicated = table.matches(".workspace-rank-table,.workspace-upstream-table,.overview-slow-table,.overview-detail-table");
      table.classList.toggle("mobile-records", !dedicated);
      $$2("tbody tr", table).forEach((tr) => $$2("td", tr).forEach((td, i) => {
        if (!td.dataset.label) td.dataset.label = heads[i] || "";
      }));
    });
    $$2("label", root).forEach((label) => {
      if (label.querySelector("input[type=file]")) {
        label.tabIndex = 0;
        label.setAttribute("role", "button");
        if (!label.dataset.consoleKeyboard) {
          label.dataset.consoleKeyboard = "1";
          label.onkeydown = (e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              label.querySelector("input").click();
            }
          };
        }
      }
    });
  }
  function ruleState() {
    const el = $2(".console-rule-state"), tag = activeTag();
    if (!el) return;
    const dirty = drafts.has(tag);
    el.classList.toggle("dirty", dirty);
    el.textContent = dirty ? "有未保存修改 · 切换名单将保留草稿" : "当前内容已保存";
  }
  function rules() {
    const text2 = $2("#rule-text"), tag = activeTag();
    if (!text2 || !tag) return;
    if (!text2.dataset.consoleDraft) {
      text2.dataset.consoleDraft = "1";
      text2.dataset.original = text2.value;
      if (drafts.has(tag) && drafts.get(tag) === text2.value) {
        drafts.delete(tag);
        persistDrafts();
      }
      if (drafts.has(tag)) text2.value = drafts.get(tag);
      text2.addEventListener("input", () => {
        rememberDraft();
        ruleState();
      });
      insertHTML($2(".section-header>div"), "beforeend", '<div class="console-rule-state" role="status"></div>');
      if (!$2(".console-rule-select")) {
        const select = document.createElement("div");
        select.className = "console-rule-select";
        setHTML(select, '<label for="console-list-select">名单类别</label><select id="console-list-select">' + $$2(".rule-menu button").map((b) => `<option value="${escape(b.dataset.ruleTag)}" ${b.dataset.ruleTag === tag ? "selected" : ""}>${escape(b.querySelector("span").textContent)}</option>`).join("") + "</select>");
        $2(".rule-editor").prepend(select);
        $2("select", select).onchange = (e) => {
          var _a2;
          rememberDraft();
          (_a2 = $2(`.rule-menu [data-rule-tag="${e.target.value}"]`)) == null ? void 0 : _a2.click();
        };
      }
    }
    ruleState();
  }
  function ruleSaved(tag, value) {
    if (drafts.get(tag) === value || !drafts.has(tag)) drafts.delete(tag);
    persistDrafts();
    if (activeTag() === tag) {
      const text2 = $2("#rule-text");
      if (text2) text2.dataset.original = value;
      ruleState();
    }
  }
  function displayNumerals() {
    $$2(".console-kpi .sk-val,.tec-big,.ring-center,.service-value[data-display-number]").forEach((el) => {
      if (el.classList.contains("has-display-number")) {
        if (el.querySelector(".display-number")) return;
        el.classList.remove("has-display-number");
      }
      const value = el.textContent.trim(), match = value.match(/^([+\-]?\d[\d,.]*)(\s*(?:%|ms|s|KB|MB|GB|TB|万|亿))?$/);
      if (!match) return;
      el.classList.add("has-display-number");
      el.style.setProperty("--numeral-size", `${Math.min(38, 260 / match[1].length).toFixed(2)}px`);
      const number = document.createElement("span");
      number.className = "display-number";
      number.textContent = match[1];
      el.replaceChildren(number);
      if (match[2]) {
        const unit = document.createElement("span");
        unit.className = "display-unit";
        unit.textContent = match[2];
        el.append(unit);
      }
    });
  }
  function apply3() {
    var _a2;
    observer == null ? void 0 : observer.disconnect();
    try {
      document.body.dataset.consoleRoute = route();
      updateBrand();
      connection();
      if (route() === "overview") {
        overview();
        displayNumerals();
      }
      if (route() === "rules") rules();
      semantics();
      if (route() === "management" && !$2(".console-restart")) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "glass-btn console-restart";
        b.textContent = "重启服务";
        b.onclick = () => $2("#restart-button").click();
        (_a2 = $2("#management-service-controls")) == null ? void 0 : _a2.append(b);
      }
    } finally {
      observer == null ? void 0 : observer.observe($2("#page-content"), { childList: true, subtree: true });
    }
  }
  function drawerOpened() {
    lastFocus = document.activeElement;
    $2(".master-container").inert = true;
    $2("#drawer-close").focus();
  }
  function drawerClosed() {
    $2(".master-container").inert = false;
    if (lastFocus == null ? void 0 : lastFocus.isConnected) lastFocus.focus();
    lastFocus = null;
  }
  function formError(message) {
    let error = $2("#modal-error");
    if (!error) {
      error = document.createElement("div");
      error.id = "modal-error";
      error.className = "form-error";
      error.setAttribute("role", "alert");
      $2("#modal-content").prepend(error);
    }
    error.textContent = message;
  }
  function setup(options = {}) {
    var _a2;
    draftKey = "localdns-drafts-v1:" + (options.apiBase || location.host);
    try {
      for (const item of JSON.parse(sessionPreferences.getItem(draftKey) || "[]")) if (Array.isArray(item) && typeof item[0] === "string" && typeof item[1] === "string") drafts.set(...item);
    } catch {
    }
    const mobileSearch = document.createElement("button");
    mobileSearch.type = "button";
    mobileSearch.className = "icon-action-btn console-search-button";
    mobileSearch.style.display = "none";
    mobileSearch.setAttribute("aria-label", "搜索域名、客户端或页面");
    setHTML(mobileSearch, '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></svg>');
    mobileSearch.onclick = () => {
      const bar = $2(".cmd-search-bar");
      bar.classList.toggle("console-search-open");
      if (bar.classList.contains("console-search-open")) $2("#global-search-input").focus();
    };
    $2(".top-actions-dock").prepend(mobileSearch);
    const status = document.createElement("div");
    status.id = "connection-status";
    status.className = "console-status";
    status.setAttribute("role", "status");
    setHTML(status, '<span class="status-dot"></span><span class="console-status-text"><span class="console-connection-text">连接中</span><small>正在读取运行数据</small></span>');
    $2("#btn-open-bg-customizer").closest(".glass-action-capsule").before(status);
    const brandStatus = document.createElement("span");
    brandStatus.className = "console-brand-status pending";
    brandStatus.setAttribute("role", "status");
    brandStatus.setAttribute("aria-label", "连接中");
    (_a2 = $2(".brand-logo")) == null ? void 0 : _a2.append(brandStatus);
    const drawer = $2("#drawer");
    drawer.setAttribute("role", "dialog");
    drawer.setAttribute("aria-modal", "true");
    drawer.setAttribute("aria-labelledby", "drawer-title");
    document.addEventListener("click", (e) => {
      if (e.target.closest("[data-rule-tag],[data-route],#theme-toggle,#refresh-button")) rememberDraft();
      if (e.target.closest("[data-route]")) $2(".cmd-search-bar").classList.remove("console-search-open");
    }, true);
    window.addEventListener("beforeunload", (e) => {
      rememberDraft();
      if (drafts.size) {
        e.preventDefault();
        e.returnValue = "";
      }
    });
    document.addEventListener("keydown", (e) => {
      if (!drawer.classList.contains("open")) return;
      if (e.key === "Escape") {
        e.preventDefault();
        $2("#drawer-close").click();
      }
      if (e.key === "Tab") {
        const items = $$2('button,a,input,select,textarea,[tabindex="0"]', drawer).filter((x) => x.getClientRects().length);
        if (!items.length) return;
        if (e.shiftKey && document.activeElement === items[0]) {
          e.preventDefault();
          items.at(-1).focus();
        } else if (!e.shiftKey && document.activeElement === items.at(-1)) {
          e.preventDefault();
          items[0].focus();
        }
      }
    });
    observer = new MutationObserver(() => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        observer.disconnect();
        try {
          semantics($2("#page-content"));
          if (route() === "overview") displayNumerals();
          if (route() === "rules") rules();
        } finally {
          observer.observe($2("#page-content"), { childList: true, subtree: true });
        }
      });
    });
    observer.observe($2("#page-content"), { childList: true, subtree: true });
    updateBrand();
    connection();
    semantics();
  }
  shellInterfaceService = { setup, apply: apply3, rememberDraft, recordMetrics, connection, updateBrand, ruleSaved, drawerOpened, drawerClosed, semantics, formError, displayNumerals };
}
let skinService;
function initialize$j() {
  "use strict";
  const STORAGE_KEY = "localdns-skin-v1";
  const CLAUDE_PRESET_LABELS = {
    parchment: "经典羊皮纸",
    terracotta: "暖陶宣纸",
    sage: "鼠尾草笺",
    ivory: "纯粹原白",
    obsidian: "夜读黑曜"
  };
  const defaults = () => ({
    active: "claude",
    claude: {
      preset: "parchment",
      lastLightPreset: "parchment",
      grain: 22,
      warmth: 48,
      theme: "light-glass"
    },
    glass: {
      theme: "cosmos-glass"
    }
  });
  function readPrefs() {
    const base = defaults();
    try {
      const raw = JSON.parse(preferences.getItem(STORAGE_KEY) || "null");
      if (!raw || typeof raw !== "object") return base;
      const active2 = raw.active === "glass" ? "glass" : "claude";
      const claude = { ...base.claude, ...raw.claude || {} };
      if (!Object.hasOwn(CLAUDE_PRESET_LABELS, claude.preset)) claude.preset = "parchment";
      if (!Object.hasOwn(CLAUDE_PRESET_LABELS, claude.lastLightPreset) || claude.lastLightPreset === "obsidian") {
        claude.lastLightPreset = "parchment";
      }
      claude.grain = Math.max(0, Math.min(60, Number.isFinite(+claude.grain) ? +claude.grain : 22));
      claude.warmth = Math.max(0, Math.min(100, Number.isFinite(+claude.warmth) ? +claude.warmth : 48));
      claude.theme = claude.theme === "cosmos-glass" ? "cosmos-glass" : "light-glass";
      const glass = { ...base.glass, ...raw.glass || {} };
      glass.theme = glass.theme === "light-glass" ? "light-glass" : "cosmos-glass";
      return { active: active2, claude, glass };
    } catch {
      return base;
    }
  }
  let prefs = readPrefs();
  const normalizeTheme = (value) => value === "light-glass" ? "light-glass" : "cosmos-glass";
  function savePrefs() {
    try {
      preferences.setItem(STORAGE_KEY, JSON.stringify(prefs));
    } catch {
    }
  }
  function applyRootAttributes() {
    const root = document.documentElement;
    root.dataset.skin = prefs.active;
    root.dataset.claudePreset = prefs.claude.preset;
    root.style.setProperty("--paper-grain", (prefs.claude.grain / 100).toFixed(2));
    root.style.setProperty("--paper-warmth", (prefs.claude.warmth / 100).toFixed(2));
  }
  applyRootAttributes();
  try {
    const existingTheme = preferences.getItem("localdnsTheme");
    const hasSkinPrefs = !!preferences.getItem(STORAGE_KEY);
    const activeTheme = prefs.active === "claude" ? prefs.claude.theme : prefs.glass.theme;
    const initialTheme = hasSkinPrefs ? normalizeTheme(activeTheme) : normalizeTheme(existingTheme || activeTheme);
    document.documentElement.dataset.theme = initialTheme;
    if (!existingTheme) preferences.setItem("localdnsTheme", initialTheme);
  } catch {
    document.documentElement.dataset.theme = prefs.active === "claude" ? prefs.claude.theme : prefs.glass.theme;
  }
  function syncControls() {
    const isClaude = prefs.active === "claude";
    document.querySelectorAll("[data-skin-switch]").forEach((btn) => {
      const match = btn.dataset.skinSwitch === prefs.active;
      btn.classList.toggle("active", match);
      btn.setAttribute("aria-pressed", String(match));
    });
    document.querySelectorAll("[data-skin-select]").forEach((card2) => {
      const match = card2.dataset.skinSelect === prefs.active;
      card2.classList.toggle("active", match);
      card2.setAttribute("aria-checked", String(match));
    });
    document.querySelectorAll(".preset-btn[data-claude-preset]").forEach((sw) => {
      sw.classList.toggle("active", sw.dataset.claudePreset === prefs.claude.preset);
    });
    const presetLabel = document.querySelector("#val-claude-preset");
    if (presetLabel) presetLabel.textContent = CLAUDE_PRESET_LABELS[prefs.claude.preset] || "经典羊皮纸";
    const grainSlider = document.querySelector("#slider-paper-grain");
    const grainVal = document.querySelector("#val-paper-grain");
    if (grainSlider && +grainSlider.value !== prefs.claude.grain) grainSlider.value = String(prefs.claude.grain);
    if (grainVal) grainVal.textContent = `${prefs.claude.grain}%`;
    const warmthSlider = document.querySelector("#slider-paper-warmth");
    const warmthVal = document.querySelector("#val-paper-warmth");
    if (warmthSlider && +warmthSlider.value !== prefs.claude.warmth) warmthSlider.value = String(prefs.claude.warmth);
    if (warmthVal) warmthVal.textContent = `${prefs.claude.warmth}%`;
    const titleSpan = document.querySelector(".bcp-title > span");
    if (titleSpan) {
      titleSpan.textContent = isClaude ? "外观与皮肤 · 人文羊皮纸" : "外观与皮肤 · 流光毛玻璃";
    }
  }
  function applyTheme(nextTheme) {
    var _a2;
    const theme = normalizeTheme(nextTheme);
    prefs[prefs.active].theme = theme;
    if (prefs.active === "claude") {
      if (theme === "cosmos-glass" && prefs.claude.preset !== "obsidian") {
        prefs.claude.lastLightPreset = prefs.claude.preset;
        prefs.claude.preset = "obsidian";
      } else if (theme === "light-glass" && prefs.claude.preset === "obsidian") {
        prefs.claude.preset = prefs.claude.lastLightPreset || "parchment";
      }
      document.documentElement.dataset.claudePreset = prefs.claude.preset;
    }
    document.documentElement.dataset.theme = theme;
    try {
      preferences.setItem("localdnsTheme", theme);
    } catch {
    }
    applyRootAttributes();
    savePrefs();
    syncControls();
    (_a2 = shellInterfaceService == null ? void 0 : shellInterfaceService.updateBrand) == null ? void 0 : _a2.call(shellInterfaceService);
    window.dispatchEvent(new CustomEvent("localdns:themechange", { detail: { skin: prefs.active, theme } }));
  }
  function toggleTheme() {
    const current = normalizeTheme(document.documentElement.dataset.theme);
    applyTheme(current === "light-glass" ? "cosmos-glass" : "light-glass");
  }
  function setSkin(nextSkin) {
    if (nextSkin !== "claude" && nextSkin !== "glass") return;
    const root = document.documentElement;
    const curTheme = root.dataset.theme === "light-glass" ? "light-glass" : "cosmos-glass";
    prefs[prefs.active].theme = curTheme;
    prefs.active = nextSkin;
    const targetTheme = normalizeTheme(prefs[nextSkin].theme || (nextSkin === "claude" ? "light-glass" : "cosmos-glass"));
    applyTheme(targetTheme);
    window.dispatchEvent(new CustomEvent("localdns:skinchange", { detail: { skin: nextSkin, theme: targetTheme } }));
  }
  function setClaudePreset(preset) {
    if (!Object.hasOwn(CLAUDE_PRESET_LABELS, preset)) return;
    prefs.claude.preset = preset;
    if (preset !== "obsidian") {
      prefs.claude.lastLightPreset = preset;
      prefs.claude.theme = "light-glass";
    } else {
      prefs.claude.theme = "cosmos-glass";
    }
    applyTheme(prefs.claude.theme);
    window.dispatchEvent(new CustomEvent("localdns:skinchange", { detail: { skin: prefs.active, theme: prefs.claude.theme } }));
  }
  function init() {
    document.querySelectorAll("[data-skin-switch]").forEach((btn) => {
      btn.addEventListener("click", () => setSkin(btn.dataset.skinSwitch));
    });
    document.querySelectorAll("[data-skin-select]").forEach((card2) => {
      card2.addEventListener("click", () => setSkin(card2.dataset.skinSelect));
    });
    document.querySelectorAll(".preset-btn[data-claude-preset]").forEach((sw) => {
      sw.addEventListener("click", () => setClaudePreset(sw.dataset.claudePreset));
    });
    const grainSlider = document.querySelector("#slider-paper-grain");
    if (grainSlider) {
      grainSlider.addEventListener("input", () => {
        prefs.claude.grain = +grainSlider.value;
        applyRootAttributes();
        syncControls();
        savePrefs();
      });
    }
    const warmthSlider = document.querySelector("#slider-paper-warmth");
    if (warmthSlider) {
      warmthSlider.addEventListener("input", () => {
        prefs.claude.warmth = +warmthSlider.value;
        applyRootAttributes();
        syncControls();
        savePrefs();
      });
    }
    document.addEventListener("click", (event) => {
      var _a2, _b2;
      if ((_b2 = (_a2 = event.target).closest) == null ? void 0 : _b2.call(_a2, "#theme-toggle")) {
        event.preventDefault();
        toggleTheme();
      }
    }, true);
    document.addEventListener("keydown", (event) => {
      var _a2;
      if ((event.key === "Enter" || event.key === " ") && ((_a2 = document.activeElement) == null ? void 0 : _a2.id) === "theme-toggle") {
        event.preventDefault();
        toggleTheme();
      }
    }, true);
    new MutationObserver(() => {
      const theme = normalizeTheme(document.documentElement.dataset.theme);
      prefs[prefs.active].theme = theme;
      if (prefs.active === "claude") {
        if (theme === "cosmos-glass" && prefs.claude.preset !== "obsidian") {
          prefs.claude.preset = "obsidian";
        } else if (theme === "light-glass" && prefs.claude.preset === "obsidian") {
          prefs.claude.preset = prefs.claude.lastLightPreset || "parchment";
        }
        document.documentElement.dataset.claudePreset = prefs.claude.preset;
      }
      savePrefs();
      syncControls();
    }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    syncControls();
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
  skinService = { setSkin, setClaudePreset, toggleTheme, getSkin: () => prefs.active };
}
function initialize$i() {
  "use strict";
  const root = document.documentElement;
  const storageKey = "localdns-navigation-v1";
  let prefs = { mode: "left", collapsed: false };
  try {
    const saved = JSON.parse(preferences.getItem(storageKey) || "null");
    if (saved && typeof saved === "object") {
      prefs.mode = saved.mode === "top" ? "top" : "left";
      prefs.collapsed = saved.collapsed === true;
    }
  } catch {
  }
  const applyPreference = () => {
    root.dataset.nav = prefs.mode === "top" ? "top" : prefs.collapsed ? "collapsed" : "left";
  };
  applyPreference();
  function setup() {
    const sidebar = document.querySelector("#sidebar");
    const nav = document.querySelector("#side-nav");
    const bar = document.querySelector(".navbar-content");
    const shell = document.querySelector(".shell-grid");
    const panel = document.querySelector("#bg-customizer-popover");
    if (!sidebar || !nav || !bar || !shell || !panel) return;
    const desktop = matchMedia("(min-width: 901px)");
    const collapseIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16m5-10-2 2 2 2"/></svg>';
    const tools = document.createElement("div");
    tools.className = "navigation-tools";
    setHTML(tools, `<span>控制台</span><button type="button" id="navigation-collapse" aria-controls="side-nav">${collapseIcon}</button>`);
    sidebar.prepend(tools);
    const collapseButton = tools.querySelector("button");
    const picker = document.querySelector("#navigation-layout-options");
    const entries2 = [...nav.querySelectorAll("[data-route]")];
    entries2.forEach((button) => {
      const label = button.textContent.trim();
      button.setAttribute("aria-label", label);
      button.title = label;
    });
    function syncSelection() {
      entries2.forEach((button) => {
        if (button.classList.contains("active")) button.setAttribute("aria-current", "page");
        else button.removeAttribute("aria-current");
      });
    }
    function syncLayout() {
      const horizontal = desktop.matches && prefs.mode === "top";
      if (horizontal) {
        if (sidebar.parentElement !== bar) bar.insertBefore(sidebar, bar.querySelector(".top-main-bar"));
      } else if (sidebar.parentElement !== shell) shell.prepend(sidebar);
      const collapsed = prefs.mode === "left" && prefs.collapsed;
      collapseButton.setAttribute("aria-expanded", String(!collapsed));
      collapseButton.setAttribute("aria-label", collapsed ? "展开左侧导航" : "折叠左侧导航");
      collapseButton.title = collapseButton.getAttribute("aria-label");
      picker == null ? void 0 : picker.querySelectorAll("[data-navigation-layout]").forEach((button) => {
        button.setAttribute("aria-pressed", String(button.dataset.navigationLayout === prefs.mode));
      });
      window.dispatchEvent(new CustomEvent("localdns:layoutchange"));
    }
    function chooseLayout(mode, collapsed = prefs.collapsed) {
      if (!["left", "top"].includes(mode)) return;
      prefs = { mode, collapsed };
      applyPreference();
      try {
        preferences.setItem(storageKey, JSON.stringify(prefs));
      } catch {
      }
      syncLayout();
    }
    collapseButton.onclick = () => chooseLayout("left", !prefs.collapsed);
    picker == null ? void 0 : picker.querySelectorAll("[data-navigation-layout]").forEach((button) => {
      button.onclick = () => chooseLayout(button.dataset.navigationLayout, false);
    });
    new MutationObserver(syncSelection).observe(nav, { subtree: true, attributes: true, attributeFilter: ["class"] });
    desktop.addEventListener("change", syncLayout);
    document.body.append(panel);
    panel.classList.add("navigation-appearance-panel");
    const appearanceButton = document.querySelector("#btn-open-bg-customizer");
    let wasOpen = false;
    function syncPanel() {
      var _a2;
      const open = panel.classList.contains("open");
      panel.inert = !open;
      appearanceButton == null ? void 0 : appearanceButton.setAttribute("aria-expanded", String(open));
      if (open && !wasOpen) (_a2 = document.querySelector("#btn-close-bg-popover")) == null ? void 0 : _a2.focus({ preventScroll: true });
      else if (!open && wasOpen && !document.querySelector("dialog[open],#drawer.open")) appearanceButton == null ? void 0 : appearanceButton.focus({ preventScroll: true });
      wasOpen = open;
    }
    new MutationObserver(syncPanel).observe(panel, { attributes: true, attributeFilter: ["class"] });
    panel.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        panel.classList.remove("open");
        event.preventDefault();
        event.stopPropagation();
      }
    });
    syncLayout();
    syncSelection();
    syncPanel();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", setup, { once: true });
  else setup();
}
let ruleConversionService;
function initialize$h() {
  "use strict";
  const formats = {
    srs: "SRS",
    dat: "DAT",
    clash_yaml: "YAML",
    singbox_json: "JSON",
    txt: "TXT",
    surge: "Surge",
    dnsmasq: "DNSMasq",
    hosts: "Hosts",
    quantumult_x: "Quantumult X"
  };
  function label(rule) {
    const format = formats[String(rule.detected_format || "").trim().toLowerCase()];
    return format ? format === "SRS" ? "SRS" : format + " → SRS" : "待识别";
  }
  function updated(result) {
    const source = (result == null ? void 0 : result.source) || result;
    return source && typeof source === "object" && typeof source.name === "string" ? source : null;
  }
  function message(result) {
    const source = updated(result);
    if (!source) return "规则更新完成";
    return `${label(source)} · ${Number(source.rule_count || 0).toLocaleString("zh-CN")} 条规则`;
  }
  function withMetadata(rule, original) {
    const result = { ...rule };
    const same = original && ["url", "files", "type", "dataset"].every((k) => String(rule[k] || "").trim() === String(original[k] || "").trim());
    for (const k of ["detected_format", "rule_count", "last_updated"]) {
      if (same && result[k] === void 0 && original[k] !== void 0) result[k] = original[k];
      if (original && !same) delete result[k];
    }
    return result;
  }
  async function finishSave(result, refresh) {
    const source = updated(result);
    if (source == null ? void 0 : source.detected_format) return source;
    const converted = updated(await refresh());
    if (!(converted == null ? void 0 : converted.detected_format)) throw new Error("配置已保存，但来源尚未识别，请检查订阅地址后重试更新。");
    return converted;
  }
  ruleConversionService = { label, updated, message, withMetadata, finishSave };
}
let wallpaperService;
function initialize$g() {
  "use strict";
  const FALLBACK_KEY = "localdns-wallpaper-v4";
  const readLocal = (key) => {
    try {
      return preferences.getItem(key);
    } catch {
      return null;
    }
  };
  function database(mode, value) {
    return mode === "readonly" ? appearanceRepository.read(["wallpaper", "wallpaper-library-v1"]).then((values) => ({ record: values.wallpaper, library: values["wallpaper-library-v1"] })) : appearanceRepository.write("wallpaper", value);
  }
  function asDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(new Error("无法读取图片文件"));
      r.readAsDataURL(blob);
    });
  }
  async function save(record2) {
    try {
      await database("readwrite", record2);
      try {
        preferences.removeItem(FALLBACK_KEY);
      } catch {
      }
    } catch {
      const fallback = record2.type === "image" ? { version: 1, type: "image", dataUrl: await asDataUrl(record2.blob), name: record2.name, savedAt: record2.savedAt } : record2;
      try {
        preferences.setItem(FALLBACK_KEY, JSON.stringify(fallback));
      } catch {
        throw new Error("壁纸未保存：浏览器存储空间不足或权限受限，请使用较小图片、图片 URL，或允许此站点保存数据。");
      }
    }
    try {
      preferences.removeItem("localdns-wallpaper-v3");
      preferences.removeItem("localdns_bg_custom");
      preferences.removeItem("localdns_bg_preset");
    } catch {
    }
  }
  async function normalize(record2) {
    if (!record2 || record2.version !== 1) return null;
    if (record2.type === "image" && !record2.blob && typeof record2.dataUrl === "string") {
      if (!record2.dataUrl.startsWith("data:image/")) return null;
      record2 = { ...record2, blob: await (await assetHttp.fetch(record2.dataUrl)).blob() };
    }
    if (record2.type === "image" && record2.blob instanceof Blob) return record2;
    if (record2.type === "url" && typeof record2.url === "string") return record2;
    if (record2.type === "preset" && typeof record2.preset === "string") return record2;
    return null;
  }
  async function selectedWallpaper(library) {
    if ((library == null ? void 0 : library.version) !== 1 || !Array.isArray(library.items)) throw new Error("旧版壁纸数据无法读取，原数据已保留。");
    const selected = library.selected;
    if ((selected == null ? void 0 : selected.type) === "preset") return normalize({ version: 1, type: "preset", preset: selected.preset });
    const item = (selected == null ? void 0 : selected.type) === "asset" ? library.items.find((item2) => item2.id === selected.id) : null;
    const record2 = await normalize(item ? { ...item, version: 1 } : null);
    if (!record2) throw new Error("旧版当前壁纸无法读取，原数据已保留。");
    return record2;
  }
  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const image = new Image(), timer = setTimeout(() => {
        image.src = "";
        reject(new Error("图片加载超时，请检查地址或换一张图片。"));
      }, 12e3);
      image.onload = () => {
        clearTimeout(timer);
        resolve();
      };
      image.onerror = () => {
        clearTimeout(timer);
        reject(new Error("无法加载图片，请确认地址可直接打开图片，或重新选择图片文件。"));
      };
      image.src = url;
    });
  }
  function setup({ notify = () => {
  } } = {}) {
    const wall = document.querySelector("#wallpaper-layer");
    if (!wall) return Promise.resolve();
    const input = document.querySelector("#bg-url-input"), fileInput = document.querySelector("#bg-file-input"), applyButton = document.querySelector("#btn-apply-bg-url"), resetButton = document.querySelector("#btn-clear-custom-bg"), status = document.querySelector("#wallpaper-save-status");
    const presets = [...document.querySelectorAll("[data-bg-preset]")], allowed = new Set(presets.map((b) => b.dataset.bgPreset));
    const selectButton = document.querySelector("#btn-select-bg-file");
    const controls = [...presets, input, fileInput, applyButton, resetButton, selectButton].filter(Boolean);
    let busy = false, objectUrl = null, currentRecord = null;
    function message(text2, state2 = "") {
      if (status) {
        status.textContent = text2;
        status.dataset.state = state2;
      }
    }
    function setBusy(value) {
      busy = value;
      controls.forEach((c) => {
        c.disabled = value;
      });
      if (applyButton) {
        applyButton.textContent = value ? "保存中…" : "应用";
        applyButton.setAttribute("aria-busy", String(value));
      }
    }
    async function prepare(record2) {
      if (record2.type === "preset") return null;
      const owned = record2.type === "image", url = owned ? URL.createObjectURL(record2.blob) : record2.url;
      try {
        await loadImage(url);
        return { url, owned };
      } catch (error) {
        if (owned) URL.revokeObjectURL(url);
        throw error;
      }
    }
    function render(record2, prepared) {
      const preset = record2.type === "preset" ? allowed.has(record2.preset) ? record2.preset : "cosmos" : "custom";
      wall.dataset.preset = preset;
      wall.style.backgroundImage = prepared ? `url(${JSON.stringify(prepared.url)})` : "";
      presets.forEach((b) => {
        b.classList.toggle("active", b.dataset.bgPreset === preset);
        b.setAttribute("aria-pressed", String(b.dataset.bgPreset === preset));
      });
      if (input) input.value = record2.type === "url" ? record2.url : "";
      currentRecord = record2;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = (prepared == null ? void 0 : prepared.owned) ? prepared.url : null;
    }
    function savedMessage(record2) {
      return record2.type === "image" ? `已保存到当前浏览器：${record2.name || "本地壁纸"}` : record2.type === "url" ? "图片 URL 已保存到当前浏览器" : "背景预设已保存到当前浏览器";
    }
    async function apply3(record2) {
      if (busy) return;
      setBusy(true);
      message("正在验证并保存壁纸…");
      let prepared;
      try {
        prepared = await prepare(record2);
        await save(record2);
        render(record2, prepared);
        prepared = null;
        message(savedMessage(record2), "saved");
        notify("壁纸已保存");
      } catch (error) {
        if (prepared == null ? void 0 : prepared.owned) URL.revokeObjectURL(prepared.url);
        message(error.message, "error");
        notify("壁纸未保存", "error", error.message);
      } finally {
        setBusy(false);
      }
    }
    presets.forEach((b) => {
      b.onclick = () => apply3({ version: 1, type: "preset", preset: b.dataset.bgPreset, savedAt: Date.now() });
    });
    if (resetButton) resetButton.onclick = () => apply3({ version: 1, type: "preset", preset: "cosmos", savedAt: Date.now() });
    if (selectButton) selectButton.onclick = () => fileInput.click();
    if (fileInput) fileInput.onchange = async () => {
      var _a2;
      const file = (_a2 = fileInput.files) == null ? void 0 : _a2[0];
      if (!file) return;
      if (file.type && !file.type.startsWith("image/")) {
        message("请选择图片文件", "error");
        fileInput.value = "";
        return;
      }
      await apply3({ version: 1, type: "image", blob: file, name: file.name, savedAt: Date.now() });
      fileInput.value = "";
    };
    if (applyButton) applyButton.onclick = () => {
      const value = input == null ? void 0 : input.value.trim();
      if (!value) {
        if ((currentRecord == null ? void 0 : currentRecord.type) === "image") {
          message(savedMessage(currentRecord), "saved");
          notify("本地壁纸已保存");
        } else message("请输入在线图片 URL；本地图片在选择后会自动保存。", "error");
        return;
      }
      let url;
      try {
        url = new URL(value);
        if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new Error();
      } catch {
        message("请输入以 http:// 或 https:// 开头的有效图片 URL。", "error");
        return;
      }
      return apply3({ version: 1, type: "url", url: url.href, savedAt: Date.now() });
    };
    if (input) input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        if (!busy) applyButton.click();
      }
    });
    async function restore() {
      setBusy(true);
      message("正在读取已保存壁纸…");
      try {
        let record2, legacy = false, readError;
        try {
          record2 = await normalize(JSON.parse(readLocal(FALLBACK_KEY) || "null"));
        } catch {
        }
        if (!record2) {
          let snapshot;
          try {
            snapshot = await database("readonly");
          } catch (error) {
            readError = error;
          }
          if (snapshot == null ? void 0 : snapshot.record) record2 = await normalize(snapshot.record);
          else if (snapshot == null ? void 0 : snapshot.library) {
            record2 = await selectedWallpaper(snapshot.library);
            legacy = true;
          }
          if (!record2) {
            const library = readLocal("localdns-wallpaper-library-v1");
            if (library) {
              record2 = await selectedWallpaper(JSON.parse(library));
              legacy = true;
            }
          }
        }
        if (!record2) {
          try {
            record2 = await normalize(JSON.parse(readLocal("localdns-wallpaper-v3") || "null"));
            legacy = !!record2;
          } catch {
          }
        }
        if (!record2) {
          const custom = readLocal("localdns_bg_custom"), preset = readLocal("localdns_bg_preset");
          if (custom) record2 = await normalize(custom.startsWith("data:image/") ? { version: 1, type: "image", dataUrl: custom, name: "本地壁纸", savedAt: Date.now() } : { version: 1, type: "url", url: custom, savedAt: Date.now() });
          else if (allowed.has(preset)) record2 = { version: 1, type: "preset", preset, savedAt: Date.now() };
          legacy = !!record2;
        }
        if (record2) {
          if (record2.type === "url" && input) input.value = record2.url;
          render(record2, await prepare(record2));
          if (legacy) {
            try {
              await save(record2);
            } catch {
              message("已恢复旧版壁纸；浏览器暂时无法保存新图片，请检查站点存储权限。", "error");
              return;
            }
          }
          message(savedMessage(record2), "saved");
        } else if (readError) message("浏览器暂时无法读取壁纸存储，请检查此站点的存储权限。", "error");
        else message("壁纸保存在当前浏览器，选择图片后自动保存。");
      } catch (error) {
        message(`已保存的壁纸暂时无法加载：${error.message}`, "error");
      } finally {
        setBusy(false);
      }
    }
    wallpaperService.ready = restore();
    return wallpaperService.ready;
  }
  wallpaperService = { setup };
}
let topologyFlowService;
function initialize$f() {
  "use strict";
  const reduce = matchMedia("(prefers-reduced-motion: reduce)");
  let current = null;
  function stop() {
    current == null ? void 0 : current.dispose();
    current = null;
  }
  function start(wrap, svg2, edges) {
    stop();
    const paths = /* @__PURE__ */ new Map();
    const outgoing = /* @__PURE__ */ new Map();
    edges.forEach((edge, index) => {
      const path = svg2.querySelector(`.topo-edge[data-edge-idx="${index}"]`);
      if (edge.muted || !path) return;
      paths.set(index, path);
      if (!outgoing.has(edge.from)) outgoing.set(edge.from, []);
      outgoing.get(edge.from).push({ ...edge, index });
    });
    const starts = [...outgoing.keys()].filter((id) => /^c\d+$/.test(id));
    if (!starts.length) return;
    const cursor = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    cursor.setAttribute("class", "topo-cursor");
    cursor.setAttribute("r", "3.1");
    cursor.setAttribute("aria-hidden", "true");
    cursor.style.opacity = "0";
    svg2.append(cursor);
    let frame = 0, disposed = false, hops = [], hopIndex = 0, started = null, restUntil = 0;
    let hovering = false, focused = false;
    const observer = new MutationObserver(sync);
    observer.observe(wrap, { attributes: true, attributeFilter: ["class"] });
    const canPlay = () => !disposed && wrap.isConnected && !document.hidden && (!reduce.matches || wrap.classList.contains("motion-override")) && !wrap.classList.contains("no-particles") && !wrap.classList.contains("has-hover") && !hovering && !focused;
    function clear() {
      cursor.style.opacity = "0";
      svg2.querySelectorAll(".is-flow").forEach((el) => el.classList.remove("is-flow"));
      wrap.querySelectorAll(".is-pulse").forEach((el) => el.classList.remove("is-pulse"));
      hops = [];
      hopIndex = 0;
      started = null;
      restUntil = 0;
    }
    function pickPath() {
      let node = starts[Math.floor(Math.random() * starts.length)];
      const visited = /* @__PURE__ */ new Set([node]);
      const result = [];
      for (let count = 0; count < 8; count++) {
        const choices = (outgoing.get(node) || []).filter((edge2) => !visited.has(edge2.to));
        if (!choices.length) break;
        const edge = choices[Math.floor(Math.random() * choices.length)];
        result.push(edge);
        visited.add(edge.to);
        node = edge.to;
      }
      return result;
    }
    function pulse(id) {
      var _a2;
      wrap.querySelectorAll(".is-pulse").forEach((el) => el.classList.remove("is-pulse"));
      (_a2 = wrap.querySelector(`[data-node-id="${id}"]`)) == null ? void 0 : _a2.classList.add("is-pulse");
    }
    function tick(now) {
      frame = 0;
      if (!canPlay()) {
        clear();
        return;
      }
      if (restUntil) {
        if (now < restUntil) {
          frame = requestAnimationFrame(tick);
          return;
        }
        clear();
      }
      if (!hops.length) {
        hops = pickPath();
        if (!hops.length) return;
      }
      const hop = hops[hopIndex], path = paths.get(hop.index);
      if (started === null) {
        started = now;
        pulse(hop.from);
        svg2.querySelectorAll(`[data-edge-idx="${hop.index}"]`).forEach((el) => el.classList.add("is-flow"));
      }
      const progress = Math.min(1, (now - started) / 560);
      const point = path.getPointAtLength(path.getTotalLength() * progress);
      cursor.setAttribute("cx", point.x.toFixed(1));
      cursor.setAttribute("cy", point.y.toFixed(1));
      cursor.style.opacity = "";
      if (progress === 1) {
        started = null;
        hopIndex++;
        if (hopIndex === hops.length) {
          pulse(hop.to);
          cursor.style.opacity = "0";
          restUntil = now + 1400;
        }
      }
      frame = requestAnimationFrame(tick);
    }
    function sync() {
      if (!canPlay()) {
        cancelAnimationFrame(frame);
        frame = 0;
        clear();
      } else if (!frame) frame = requestAnimationFrame(tick);
    }
    const enter = () => {
      hovering = true;
      sync();
    };
    const leave = () => {
      hovering = false;
      sync();
    };
    const focus = () => {
      focused = true;
      sync();
    };
    const blur = (event) => {
      focused = wrap.contains(event.relatedTarget);
      sync();
    };
    wrap.addEventListener("pointerenter", enter);
    wrap.addEventListener("pointerleave", leave);
    wrap.addEventListener("focusin", focus);
    wrap.addEventListener("focusout", blur);
    document.addEventListener("visibilitychange", sync);
    reduce.addEventListener("change", sync);
    current = { sync, dispose() {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      clear();
      cursor.remove();
      wrap.removeEventListener("pointerenter", enter);
      wrap.removeEventListener("pointerleave", leave);
      wrap.removeEventListener("focusin", focus);
      wrap.removeEventListener("focusout", blur);
      document.removeEventListener("visibilitychange", sync);
      reduce.removeEventListener("change", sync);
    } };
    sync();
  }
  topologyFlowService = { start, stop, sync: () => current == null ? void 0 : current.sync() };
}
let queryPathService;
function initialize$e() {
  "use strict";
  const esc2 = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const missing = (value) => value === null || value === void 0 || value === "";
  const elapsed = (value) => missing(value) || !Number.isFinite(Number(value)) ? "未记录" : Number(value).toLocaleString("zh-CN", { maximumFractionDigits: 3 }) + " ms";
  const facts = (rows) => '<dl class="query-path-facts">' + rows.map(([key, value]) => `<div><dt>${esc2(key)}</dt><dd>${esc2(missing(value) ? "未记录" : value)}</dd></div>`).join("") + "</dl>";
  function model(record2, aliases = {}) {
    const answers = Array.isArray(record2.answers) ? record2.answers : [];
    const steps = [{ name: "请求来源", result: aliases[record2.client_ip] || record2.client_ip || "未记录", facts: [["客户端", record2.client_ip], ["查询名称", record2.query_name], ["类型 / 类别", [record2.query_type, record2.query_class].filter(Boolean).join(" / ")]], note: "本条日志记录的查询问题与来源。" }];
    if (typeof record2.cache === "boolean") steps.push({ name: "缓存记录", result: record2.cache ? "缓存命中" : "未标记命中", facts: [["缓存标记", String(record2.cache)], ["最终分流", record2.domain_set]], note: record2.cache ? "此请求标记为缓存命中；命中前的其他执行步骤未记录。" : "cache=false 仅表示未标记缓存命中，不据此推断检查顺序。" });
    if (record2.domain_set) steps.push({ name: "分流结果", result: record2.domain_set, facts: [["最终分流", record2.domain_set], ["学习记录", record2.learning], ["上游尝试", record2.upstream_attempt]], note: "最终分类与日志原文；未将分类推断为具体规则条目或上游节点。" });
    steps.push({ name: "返回应答", result: record2.response_code || "未记录", facts: [["响应码", record2.response_code], ["应答条数", answers.length], ["请求总耗时", elapsed(record2.duration_ms)]], note: "请求总耗时按接口原值显示，阶段耗时没有单独记录。" });
    const cached = record2.cache === true && record2.domain_set === "cache_main";
    const conclusion = cached ? "主缓存命中，返回 " + answers.length + " 条应答。" : [record2.domain_set ? "分流结果：" + record2.domain_set : "分流未记录", record2.response_code || "响应码未记录", answers.length + " 条应答"].join(" · ");
    return { record: record2, answers, steps, conclusion };
  }
  function html2(record2, aliases = {}) {
    const m = model(record2, aliases);
    return `<div class="query-path" data-query-path><div class="query-path-summary"><p>${esc2(m.conclusion)}</p>${facts([["请求总耗时", elapsed(record2.duration_ms)], ["Trace ID", record2.trace_id], ["记录范围", "已有字段摘要"]])}</div><section class="query-path-overview"><header><h3>已记录的路径</h3><span>点击查看依据</span></header><ol class="query-path-nodes">${m.steps.map((s, i) => `<li><button type="button" data-path-step="${i}" aria-pressed="${i === 0}" aria-controls="query-path-step-detail"><strong>${esc2(s.name)}</strong><span>${esc2(s.result)}</span><small>耗时未记录</small></button></li>`).join("")}</ol></section><section id="query-path-step-detail" class="query-path-step" aria-label="所选步骤"></section><p class="query-path-gap">本条缺少逐步执行记录。未记录不代表未执行；不补造规则、上游或分段耗时。</p><section class="query-path-answers"><header><h3>应答记录</h3><span>${m.answers.length} 条</span></header>${m.answers.length ? `<div class="table-wrap"><table><thead><tr><th>类型</th><th>值</th><th>TTL</th></tr></thead><tbody>${m.answers.map((a) => `<tr><td>${esc2(a.type ?? a.record_type ?? "未记录")}</td><td class="mono">${esc2(a.data ?? a.value ?? "未记录")}</td><td>${esc2(a.ttl === void 0 || a.ttl === null ? "—" : a.ttl + " s")}</td></tr>`).join("")}</tbody></table></div>` : '<p class="query-path-note">本条日志没有 Answer 记录。</p>'}</section><details class="workspace-note"><summary>原始日志</summary><pre>${esc2(JSON.stringify(record2, null, 2))}</pre></details></div>`;
  }
  function bind(root, record2, aliases = {}) {
    const m = model(record2, aliases), detail = root.querySelector("#query-path-step-detail");
    const select = (index) => {
      const step = m.steps[index];
      if (!step) return;
      root.querySelectorAll("[data-path-step]").forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.pathStep) === index)));
      setHTML(detail, `<h3>${esc2(step.name)}</h3><p class="query-path-note">${esc2(step.note)}</p>${facts(step.facts)}`);
    };
    root.querySelectorAll("[data-path-step]").forEach((b) => b.onclick = () => select(Number(b.dataset.pathStep)));
    select(0);
  }
  queryPathService = { model, html: html2, bind };
}
let rankLatencyService;
function initialize$d() {
  "use strict";
  const limit = 1e3;
  function params(kind, key) {
    if (kind === "domain") return { q: key, exact: true };
    if (kind === "client") return { q: key, exact: true, client_contains: key };
    if (kind === "set") return { domain_set: key };
    throw new Error("未知排行类型");
  }
  function summarize(kind, key, response) {
    var _a2;
    const field = { domain: "query_name", client: "client_ip", set: "domain_set" }[kind];
    const logs = Array.isArray(response == null ? void 0 : response.logs) ? response.logs : [];
    const matching = logs.filter((row) => row[field] === key);
    const durations = matching.filter((row) => row.duration_ms !== null && row.duration_ms !== void 0 && row.duration_ms !== "" && Number.isFinite(Number(row.duration_ms)) && Number(row.duration_ms) >= 0).map((row) => Number(row.duration_ms));
    const total = Number((_a2 = response == null ? void 0 : response.pagination) == null ? void 0 : _a2.total_items);
    return {
      average: durations.length ? durations.reduce((sum, value) => sum + value, 0) / durations.length : null,
      samples: durations.length,
      total: Number.isFinite(total) ? total : logs.length,
      partial: total > logs.length || durations.length < matching.length
    };
  }
  function create2(loadLogs, now = Date.now) {
    const cache = /* @__PURE__ */ new Map(), queue = [];
    let active2 = 0;
    function pump() {
      while (active2 < 4 && queue.length) {
        const job = queue.shift();
        if (!job.current()) {
          job.reject(new DOMException("页面已切换", "AbortError"));
          continue;
        }
        active2++;
        Promise.resolve().then(job.run).then(job.resolve, job.reject).finally(() => {
          active2--;
          pump();
        });
      }
    }
    function get(kind, key, current = () => true) {
      const id = JSON.stringify([kind, key]), saved = cache.get(id);
      if (saved && now() - saved.time < 6e4) return saved.promise;
      const entry = { time: now() };
      entry.promise = new Promise((resolve, reject) => {
        queue.push({ resolve, reject, current, run: async () => summarize(
          kind,
          key,
          await loadLogs({ page: 1, limit, ...params(kind, key) })
        ) });
      }).catch((error) => {
        if (cache.get(id) === entry) cache.delete(id);
        throw error;
      });
      cache.delete(id);
      cache.set(id, entry);
      if (cache.size > 256) cache.delete(cache.keys().next().value);
      pump();
      return entry.promise;
    }
    return { get };
  }
  rankLatencyService = { create: create2, summarize, params };
}
const overviewInsightsService = (() => {
  "use strict";
  const names = {
    cache_main: "主缓存命中",
    cache_domestic: "国内缓存命中",
    cache_foreign: "国外缓存命中",
    cache_foreign_ecs: "国外 ECS 缓存命中",
    blocked_qtype: "查询类型屏蔽",
    blocked_nodata: "无结果请求屏蔽",
    client_direct: "客户端直连",
    geosite_non_cn: "非国内规则命中",
    whitelist: "白名单命中",
    greylist: "灰名单命中",
    blocked: "请求屏蔽",
    learned_realip: "已学习 RealIP",
    learned_fakeip: "已学习 FakeIP",
    geosite_cn: "国内规则命中",
    custom_cn: "自定义国内规则",
    custom_non_cn: "自定义非国内规则",
    unknown_fakeip: "未知域名 FakeIP",
    geosite_cn_nodata: "国内规则无记录",
    geosite_cn_unverified: "国内规则待验证",
    geosite_cn_conflict_fakeip: "国内规则冲突 FakeIP",
    client_direct_upstream_error: "客户端直连上游错误",
    unknown_noaddr: "未知域名无地址",
    foreign_other: "其他国外结果"
  };
  const tones = {
    cache_main: 0,
    blocked_qtype: 2,
    blocked_nodata: 4,
    client_direct: 1,
    geosite_non_cn: 3,
    geosite_cn: 1,
    whitelist: 1,
    greylist: 3,
    blocked: 4,
    learned_realip: 1,
    learned_fakeip: 3,
    __other__: 5
  };
  const palettes = {
    glass: ["#2563eb", "#10b981", "#f59e0b", "#8b5cf6", "#ef4444", "#64748b"],
    claude: ["#3b6d9b", "#2d6a4f", "#b45309", "#87619e", "#b91c1c", "#857f74"]
  };
  const pools = {
    cache_main: { code: "MAIN", short: "全部缓存", shortLabel: "全部缓存", sub: "最终结果主缓存池", tag: "cache_main", full: "全部缓存 (cache_main)", tone: "main" },
    cache_domestic: { code: "CN", short: "国内缓存", shortLabel: "国内缓存", sub: "大陆域名直连缓存", tag: "cache_domestic", full: "国内缓存 (cache_domestic)", tone: "domestic" },
    cache_foreign: { code: "GL", short: "国外缓存", shortLabel: "国外缓存", sub: "海外无污染缓存", tag: "cache_foreign", full: "国外缓存 (cache_foreign)", tone: "foreign" },
    cache_foreign_ecs: { code: "ECS", short: "国外 ECS", shortLabel: "国外 ECS", sub: "EDNS 子网缓存", tag: "cache_foreign_ecs", full: "国外 ECS (cache_foreign_ecs)", tone: "ecs" }
  };
  const label = (key) => names[key] || String(key || "未分类");
  function color(key, skin) {
    const hash = [...String(key)].reduce((value, ch) => value * 31 + ch.charCodeAt(0) >>> 0, 0);
    return (palettes[skin] || palettes.glass)[tones[key] ?? hash % 5];
  }
  function distribution(items, visible = 6) {
    const counts = /* @__PURE__ */ new Map();
    for (const row of Array.isArray(items) ? items : []) {
      const count = Number(row == null ? void 0 : row.count), key = String((row == null ? void 0 : row.key) || "");
      if (Number.isFinite(count) && count > 0) counts.set(key, (counts.get(key) || 0) + count);
    }
    const all = [...counts].map(([key, count]) => ({ key, count, label: label(key) })).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
    const total = all.reduce((sum, row) => sum + row.count, 0);
    const shown = all.length > visible ? [...all.slice(0, visible - 1), {
      key: "__other__",
      label: "其他",
      count: all.slice(visible - 1).reduce((sum, row) => sum + row.count, 0),
      members: all.slice(visible - 1)
    }] : all;
    return { all, total, shown };
  }
  function latencyTier(durationMs) {
    const v = Number(durationMs) || 0;
    if (v > 500) return "critical";
    if (v >= 300) return "warn";
    if (v >= 150) return "moderate";
    return "fast";
  }
  function poolInfo(tag) {
    const t = String(tag || "缓存池");
    return pools[tag] || { code: "POOL", short: t, shortLabel: t, sub: t, tag: t, full: t, tone: "main" };
  }
  return { label, color, distribution, latencyTier, poolInfo };
})();
function initialize$c() {
}
function parts(value) {
  var _a2;
  return (_a2 = /^(\d{4}\.\d+\.\d+\.\d+)(?:-local[\w.-]*)?$/.exec(value)) == null ? void 0 : _a2[1].split(".").map(Number);
}
function upgradeTarget(installed, release) {
  var _a2;
  if (!installed || !release) return { reason: "先检查更新，获取可安装的正式版本。" };
  if (release.backend !== ((_a2 = installed.backendVersion) == null ? void 0 : _a2.toUpperCase())) return { reason: "此发行版需要不同的 DNS 核心，请先查看发布说明。" };
  const current = parts(installed.uiVersion), target = parts(release.version);
  if (!current || !target) return { reason: "版本信息无效，请重新检查更新。" };
  const different = target.findIndex((value, index) => value !== current[index]);
  if (different < 0 || target[different] < current[different]) return { reason: "暂无比当前 UI 更新的正式版。" };
  if (!release.packages.includes("UI 升级包")) return { reason: "该发行版没有提供 UI 升级包。" };
  if (!/^fjg[a-z0-9]+-ui-v\d{4}\.\d+\.\d+\.\d+$/i.test(release.tag)) return { reason: "发行版标签无效，请查看发布说明。" };
  return { tag: release.tag, reason: "仅更新界面，保留配置、Logo 和字体；无需重启 DNS。" };
}
class UIUpdateClient {
  constructor(base, pageURL = document.baseURI, fetcher) {
    const address = new URL(base || new URL(pageURL).origin, pageURL);
    if (!["http:", "https:"].includes(address.protocol) || address.username || address.password || address.search || address.hash) {
      throw new Error("网页升级地址无效，请检查服务器配置。");
    }
    if (new URL(pageURL).protocol === "https:" && address.protocol !== "https:") {
      throw new Error("HTTPS 网页需要配置 HTTPS 升级入口，请查看安装说明。");
    }
    this.http = new HttpClient({ base: address.href.replace(/\/$/, ""), timeout: 1e4, fetch: fetcher });
  }
  async request(path, data) {
    const headers = { Accept: "application/json" };
    if (data) headers["Content-Type"] = "application/json";
    return this.http.request(path, {
      method: data ? "POST" : "GET",
      credentials: "omit",
      cache: "no-store",
      headers,
      ...data ? { body: JSON.stringify(data) } : {}
    });
  }
  async discover() {
    const result = await this.request("/upgrade/ui");
    if ((result == null ? void 0 : result.protocol) !== "localdns-ui-updater/v1" || result.repository !== "https://github.com/yyhoworks/LocalDNS") {
      throw new Error("服务器未提供兼容的 LocalDNS UI 升级接口。");
    }
  }
  validate(value) {
    const result = value;
    if (!result || !["idle", "queued", "running", "succeeded", "failed"].includes(result.state) || typeof result.canRollback !== "boolean") throw new Error("升级任务状态无效，请重试连接。");
    return result;
  }
  async status() {
    return this.validate(await this.request("/upgrade/ui/status"));
  }
  async upgrade(releaseTag) {
    return this.validate(await this.request("/upgrade/ui", { releaseTag }));
  }
  async rollback() {
    return this.validate(await this.request("/upgrade/ui/rollback", {}));
  }
}
function createUIUpdatePanel(container) {
  setHTML(container, `<h3>在线升级 UI</h3>
    <p class="version-note" data-update-connection>正在连接服务器升级入口…</p>
    <p class="version-note" data-update-target></p>
    <div class="version-update-progress" hidden><progress aria-label="UI 升级正在进行"></progress></div>
    <p class="version-update-result" role="status" aria-live="polite" hidden></p>
    <p class="version-error" role="alert" data-update-error hidden></p>
    <div class="version-actions version-update-actions">
      <button class="button primary" type="button" data-update-start disabled>升级 UI</button>
      <button class="button" type="button" data-update-refresh hidden>刷新使用新版</button>
      <button class="button" type="button" data-update-rollback hidden>恢复上一版 UI</button>
      <button class="button" type="button" data-update-retry>重试连接</button>
      <a class="button" href="https://github.com/yyhoworks/LocalDNS/blob/main/docs/WEB_UPDATE.md" target="_blank" rel="noopener noreferrer" data-update-help>安装说明</a>
    </div>`);
  container.classList.add("version-ui-update");
  const get = (selector) => container.querySelector(selector);
  const connection = get("[data-update-connection]");
  const start = get("[data-update-start]"), refresh = get("[data-update-refresh]");
  const rollback = get("[data-update-rollback]"), retry = get("[data-update-retry]");
  const help = get("[data-update-help]"), errorNode = get("[data-update-error]");
  const message = get(".version-update-result"), progress = get(".version-update-progress");
  let client, available = false, busy = false, reading = false, error = "";
  let installed = null, latest = null;
  let task = { state: "idle", canRollback: false }, timer;
  const running = () => task.state === "queued" || task.state === "running";
  const currentUI = () => installed && task.installedVersion ? { ...installed, uiVersion: task.installedVersion } : installed;
  const describe = (failure) => failure instanceof Error ? failure.message : "连接失败，请重试。";
  function paint() {
    const target = upgradeTarget(currentUI(), latest);
    start.disabled = !available || !target.tag || busy || running();
    start.textContent = running() ? "正在更新…" : latest && target.tag ? "升级至 " + latest.version : "升级 UI";
    rollback.hidden = !available || !task.canRollback;
    rollback.disabled = busy || running();
    const needsRefresh = task.state === "succeeded" && task.installedVersion !== (installed == null ? void 0 : installed.uiVersion);
    refresh.hidden = !needsRefresh;
    refresh.classList.toggle("primary", needsRefresh);
    start.hidden = task.state === "succeeded" && !target.tag;
    retry.disabled = busy;
    retry.textContent = available ? "刷新状态" : "重试连接";
    help.hidden = available;
    connection.textContent = available ? "已连接，升级任务由服务器执行。" : busy ? "正在连接服务器升级入口…" : "此服务器尚未启用网页升级。完成一次安装后即可在这里操作。";
    get("[data-update-target]").textContent = needsRefresh ? `当前页面 UI 为 ${(installed == null ? void 0 : installed.uiVersion) || "旧版"}；刷新后使用服务器上的 ${task.installedVersion}。` : target.reason;
    progress.hidden = !running();
    message.hidden = !task.message;
    message.textContent = task.message || "";
    errorNode.hidden = !error;
    errorNode.textContent = error;
  }
  function schedule() {
    clearTimeout(timer);
    if (running() && available) timer = setTimeout(() => void readStatus(), 1500);
  }
  async function readStatus() {
    if (!client || !available || busy || reading) return;
    reading = true;
    try {
      task = await client.status();
      error = "";
    } catch (failure) {
      error = describe(failure);
    } finally {
      reading = false;
    }
    paint();
    schedule();
  }
  async function connect() {
    if (busy) return;
    if (client && available) {
      await readStatus();
      return;
    }
    busy = true;
    error = "";
    paint();
    try {
      const config = window.LOCALDNS_UI_CONFIG;
      client = new UIUpdateClient((config == null ? void 0 : config.uiUpdaterBase) || (config == null ? void 0 : config.apiBase) || "");
      await client.discover();
      task = await client.status();
      available = true;
    } catch (failure) {
      available = false;
      error = failure instanceof ApiError && failure.status === 404 ? "" : describe(failure);
    } finally {
      busy = false;
      paint();
      schedule();
    }
  }
  async function execute(restore) {
    const target = upgradeTarget(currentUI(), latest);
    if (!client || !available || busy || running() || !restore && !target.tag) return;
    if (!window.confirm(restore ? "恢复上一版 UI？当前 Logo、字体和站点配置会保留。" : "开始升级 UI？请先保存未提交的修改。升级完成后由你手动刷新，DNS 服务继续运行。")) return;
    busy = true;
    error = "";
    paint();
    try {
      task = restore ? await client.rollback() : await client.upgrade(target.tag);
    } catch (failure) {
      error = describe(failure);
      try {
        task = await client.status();
      } catch {
        error += " 请刷新状态核对服务器任务，避免重复提交。";
      }
    } finally {
      busy = false;
      paint();
      schedule();
    }
  }
  start.addEventListener("click", () => void execute(false));
  rollback.addEventListener("click", () => void execute(true));
  retry.addEventListener("click", () => void connect());
  refresh.addEventListener("click", () => window.location.reload());
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && available) void readStatus();
  });
  paint();
  return {
    connect,
    setRelease(current, release) {
      installed = current;
      latest = release;
      paint();
    }
  };
}
const versionService = (() => {
  "use strict";
  const REPO = "https://github.com/yyhoworks/LocalDNS";
  const ENDPOINT = "https://api.github.com/repos/yyhoworks/LocalDNS/releases/latest";
  const TTL = 6 * 60 * 60 * 1e3;
  function versionParts(value) {
    const match = String(value || "").match(/(?:^|ui-v|^v)(\d{4}\.\d+\.\d+\.\d+)(?=$|[-+])/i);
    return match ? match[1].split(".").map(Number) : null;
  }
  function compareVersions(a, b) {
    const aa = versionParts(a), bb = versionParts(b);
    if (!aa || !bb) return null;
    for (let i = 0; i < 4; i++) if (aa[i] !== bb[i]) return aa[i] > bb[i] ? 1 : -1;
    return 0;
  }
  function releaseInfo(value) {
    var _a2, _b2;
    if (!value || value.draft || value.prerelease || !versionParts(value.tag_name))
      throw new Error("GitHub 返回的正式版信息无法识别，请稍后重试。");
    const tag = String(value.tag_name);
    const files = (Array.isArray(value.assets) ? value.assets : []).map((item) => String(item.name || ""));
    return {
      tag,
      version: versionParts(tag).join("."),
      backend: ((_b2 = (_a2 = tag.match(/^([a-z0-9]+)-ui-v/i)) == null ? void 0 : _a2[1]) == null ? void 0 : _b2.toUpperCase()) || "",
      url: REPO + "/releases/tag/" + encodeURIComponent(tag),
      assetNames: files,
      packages: [
        files.some((x) => /_Update\.zip$/i.test(x)) && "UI 升级包",
        files.some((x) => /_Full\.zip$/i.test(x)) && "含核心完整包",
        files.some((x) => /_Service\.zip$/i.test(x)) && "配套服务包"
      ].filter(Boolean)
    };
  }
  function assess(installed, latest) {
    const baseline = installed.channel === "local" ? installed.baseUiVersion : installed.uiVersion;
    const comparison = compareVersions(latest.version, baseline);
    const sameVersionNewCore = comparison === 0 && latest.backend && latest.backend !== String(installed.backendVersion || "").toUpperCase();
    return {
      available: comparison > 0 || sameVersionNewCore,
      comparison,
      local: installed.channel === "local",
      baseline
    };
  }
  function setup() {
    const start = async () => {
      var _a2;
      const button = document.querySelector("#version-button");
      if (!button) return;
      const dialog2 = document.createElement("dialog");
      dialog2.id = "version-dialog";
      dialog2.className = "version-dialog";
      dialog2.setAttribute("aria-labelledby", "version-dialog-title");
      setHTML(dialog2, '<div class="version-dialog-head"><h2 id="version-dialog-title">版本与更新</h2><form method="dialog"><button type="submit" class="glass-btn" aria-label="关闭版本信息">关闭</button></form></div><div id="version-content" aria-live="polite"></div><div class="version-actions"><button type="button" class="button" id="version-check-now">检查更新</button><a class="button" href="' + REPO + '/releases" target="_blank" rel="noopener noreferrer" id="version-release-link">查看 GitHub 发布</a></div>');
      document.body.append(dialog2);
      const content = dialog2.querySelector("#version-content"), manual = dialog2.querySelector("#version-check-now");
      const cacheKey = "localdns-release-check-v1:" + location.origin + ":" + String(((_a2 = window.LOCALDNS_UI_CONFIG) == null ? void 0 : _a2.apiBase) || "");
      let installed = null, latest = null, checkedAt = 0, lastAttemptAt = 0, error = "", metadataError = "", checking = false, pending;
      const updateSection = document.createElement("section");
      dialog2.querySelector(".version-actions").before(updateSection);
      const updater = createUIUpdatePanel(updateSection);
      const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
      const date = (value) => value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "尚未检查";
      function paint() {
        var _a3;
        const status = installed && latest ? assess(installed, latest) : null;
        const text2 = checking ? "检查中" : error ? "检查失败" : !installed ? "版本未读取" : !latest ? "尚未检查" : status.available ? "有新版本" : status.comparison === null ? "版本待核对" : status.local ? "本地测试版" : status.comparison < 0 ? "当前版本较新" : "已是最新";
        button.dataset.status = error ? "error" : (status == null ? void 0 : status.available) ? "update" : "normal";
        const displayVersion = String((installed == null ? void 0 : installed.uiVersion) || "").replace(/-local.*$/, "");
        button.querySelector("[data-version-number]").textContent = displayVersion ? "UI " + displayVersion : "版本";
        button.querySelector("[data-version-status]").textContent = text2;
        button.title = `版本与更新：${(installed == null ? void 0 : installed.uiVersion) || "未读取"}，${text2}`;
        button.setAttribute("aria-label", button.title);
        manual.disabled = checking;
        manual.textContent = checking ? "正在检查…" : "检查更新";
        const fact = (name, value) => `<div><dt>${name}</dt><dd>${escape(value)}</dd></div>`;
        const backend = ((_a3 = document.querySelector("#brand-version-tag")) == null ? void 0 : _a3.dataset.backendVersion) || (installed == null ? void 0 : installed.backendVersion);
        setHTML(content, `<dl class="version-facts">${fact("当前 UI", (installed == null ? void 0 : installed.uiVersion) || "未能读取")}${fact("DNS 核心", backend || "尚未读取")}${fact("GitHub 最新正式版", latest ? latest.version + (latest.backend ? " / " + latest.backend : "") : "尚未读取")}${fact("上次成功检查", date(checkedAt))}</dl><p class="version-result">${escape(checking ? "正在获取 GitHub 最新正式版…" : error ? "更新检查失败，当前版本信息仍可查看。" : (status == null ? void 0 : status.available) ? "GitHub 已发布新版本，可查看更新说明与安装包。" : (status == null ? void 0 : status.local) ? "当前为本地测试版，基于正式版 " + status.baseline + "；" + (status.comparison === null ? "请在 GitHub 核对版本。" : "基准之后暂无新正式版。") : (status == null ? void 0 : status.comparison) === 0 ? "当前 UI 已是最新正式版。" : (status == null ? void 0 : status.comparison) < 0 ? "当前 UI 版本高于 GitHub 最新正式版。" : "点击“检查更新”获取 GitHub 最新正式版。")}</p>${(latest == null ? void 0 : latest.packages.length) ? `<p class="version-note">发布包：${escape(latest.packages.join("、"))}。UI 升级包仅更新界面；更换 DNS 核心需使用完整包。</p>` : ""}${metadataError ? `<p class="version-error" role="alert">${escape(metadataError)}</p>` : ""}${error ? `<p class="version-error" role="alert">${escape(error)} 可点击“检查更新”重试，或打开 GitHub 发布页。</p>` : ""}<p class="version-note">自动检查间隔为 6 小时；手动检查立即重新请求。</p>`);
        dialog2.querySelector("#version-release-link").href = (latest == null ? void 0 : latest.url) || REPO + "/releases";
        updater.setRelease(installed, latest);
      }
      async function fetchJSON(url) {
        const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 1e4);
        try {
          const response = await assetHttp.fetch(url, { signal: controller.signal, cache: "no-store", credentials: "omit", headers: { Accept: "application/json" } });
          if (!response.ok) throw new Error(response.status === 403 || response.status === 429 ? "GitHub 请求受限，请稍后重试。" : "请求失败（HTTP " + response.status + "）。");
          return await response.json();
        } finally {
          clearTimeout(timeout);
        }
      }
      async function loadInstalled() {
        try {
          const value = await fetchJSON(new URL("version.json", document.baseURI));
          if (!versionParts(value.uiVersion)) throw new Error("当前 UI 版本格式无法识别。");
          installed = value;
          metadataError = "";
        } catch {
          metadataError = "当前 UI 版本信息读取失败，请刷新页面后重试。";
        }
      }
      function check(force = false) {
        if (pending) return pending;
        if (!force && error && Date.now() - lastAttemptAt < 15 * 60 * 1e3) return Promise.resolve();
        if (!force && latest && Date.now() - checkedAt >= 0 && Date.now() - checkedAt < TTL) {
          paint();
          return Promise.resolve();
        }
        checking = true;
        error = "";
        lastAttemptAt = Date.now();
        paint();
        pending = (async () => {
          try {
            if (!installed) await loadInstalled();
            latest = releaseInfo(await fetchJSON(ENDPOINT));
            checkedAt = Date.now();
            try {
              preferences.setItem(cacheKey, JSON.stringify({ checkedAt, release: {
                tag_name: latest.tag,
                assets: latest.assetNames.map((name) => ({ name }))
              } }));
            } catch {
            }
          } catch (failure) {
            error = failure.name === "AbortError" ? "连接 GitHub 超时。" : failure.message || "无法连接 GitHub。";
          } finally {
            checking = false;
            pending = null;
            paint();
          }
        })();
        return pending;
      }
      button.onclick = () => {
        paint();
        dialog2.showModal();
        updater.connect();
      };
      manual.onclick = () => check(true);
      let backdrop = false;
      dialog2.addEventListener("pointerdown", (event) => {
        backdrop = event.target === dialog2;
      });
      dialog2.addEventListener("click", (event) => {
        if (backdrop && event.target === dialog2) dialog2.close();
        backdrop = false;
      });
      await loadInstalled();
      try {
        const saved = JSON.parse(preferences.getItem(cacheKey) || "null");
        if (saved && Number.isFinite(saved.checkedAt) && saved.checkedAt <= Date.now()) {
          latest = releaseInfo(saved.release);
          checkedAt = saved.checkedAt;
        }
      } catch {
      }
      paint();
      check();
      setInterval(() => {
        if (!document.hidden) check();
      }, TTL);
      document.addEventListener("visibilitychange", () => {
        if (!document.hidden) check();
      });
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
    else start();
  }
  return { versionParts, compareVersions, releaseInfo, assess, setup };
})();
function initialize$b() {
  versionService.setup();
}
let workspaceService;
function initialize$a() {
  "use strict";
  const esc2 = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const number = (value) => Number(value || 0).toLocaleString("zh-CN");
  const percent = (n, d) => Number(d) > 0 ? (Number(n || 0) / Number(d) * 100).toFixed(1) + "%" : "—";
  const badge = (text2, cls = "") => `<span class="badge ${cls}">${esc2(text2)}</span>`;
  const keyFields = ["q", "type", "set", "code", "client", "exact"];
  let ctx, ruleFilter = { q: "", group: "全部" }, modalController;
  const store = {
    get(key, fallback) {
      try {
        const v = JSON.parse(preferences.getItem("localdns-workspace:" + ((ctx == null ? void 0 : ctx.apiBase) || location.host) + ":" + key));
        return v ?? fallback;
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        preferences.setItem("localdns-workspace:" + ((ctx == null ? void 0 : ctx.apiBase) || location.host) + ":" + key, JSON.stringify(value));
        return true;
      } catch {
        return false;
      }
    }
  };
  function cleanFilter(value = {}) {
    return Object.fromEntries(keyFields.map((key) => [key, key === "exact" ? value[key] === true : typeof value[key] === "string" ? value[key].slice(0, 2e3) : ""]));
  }
  function views() {
    const saved = store.get("query-views", null);
    return Array.isArray(saved) ? saved.filter((v) => v && typeof v.name === "string" && v.filter && typeof v.filter === "object").slice(0, 12).map((v) => ({ name: v.name.slice(0, 40), filter: cleanFilter(v.filter) })) : [{ name: "SERVFAIL", filter: cleanFilter({ code: "SERVFAIL" }) }, { name: "AAAA 请求", filter: cleanFilter({ type: "AAAA" }) }];
  }
  function columns() {
    const value = store.get("query-columns", {});
    return Object.fromEntries(["type", "set", "client", "code"].map((k) => [k, (value == null ? void 0 : value[k]) !== false]));
  }
  function applyColumns(root) {
    const cols = columns(), mapping = { type: 2, set: 3, client: 5, code: 6 };
    root.querySelectorAll(".workspace-log-table tr").forEach((row) => Object.entries(mapping).forEach(([key, index]) => {
      if (row.children[index] && row.children.length === 8) row.children[index].hidden = !cols[key];
    }));
  }
  function logTools(filter) {
    const labels = { q: "搜索", type: "类型", set: "分流", code: "响应码", client: "客户端包含", exact: "精确匹配" }, cols = columns();
    return `<details class="workspace-log-extras" ${matchMedia("(max-width:600px)").matches ? "" : "open"}><summary>常用筛选与显示设置</summary><div class="workspace-saved"><span>常用筛选</span>${views().map((v, i) => `<button type="button" class="glass-btn" data-query-view="${i}">${esc2(v.name)}</button>`).join("")}<button type="button" class="glass-btn" id="log-save-view">保存当前条件</button></div><div class="workspace-log-tools"><span id="log-live-state">${ctx.state.logsPaused ? "刷新已暂停" : "自动刷新已开启"}</span><div><details class="workspace-columns"><summary>显示列</summary><div>${Object.entries({ type: "类型", set: "分流", client: "客户端", code: "响应码" }).map(([k, name]) => `<label><input type="checkbox" data-query-column="${k}" ${cols[k] ? "checked" : ""}>${name}</label>`).join("")}</div></details><button type="button" class="glass-btn" id="log-export">导出当前页</button></div></div></details><div class="workspace-filter-chips">${keyFields.filter((k) => filter[k]).map((k) => `<button type="button" data-clear-query="${k}" aria-label="移除${labels[k]}筛选">${labels[k]}${k === "exact" ? "" : "：" + esc2(filter[k])}<span aria-hidden="true"> ×</span></button>`).join("")}</div>`;
  }
  function bindLogs(root, rows) {
    applyColumns(root);
    root.querySelectorAll("[data-query-view]").forEach((b) => b.onclick = () => {
      Object.assign(ctx.state.logs, { page: 1, ...views()[Number(b.dataset.queryView)].filter });
      ctx.renderRoute(true);
    });
    root.querySelectorAll("[data-clear-query]").forEach((b) => b.onclick = () => {
      ctx.state.logs[b.dataset.clearQuery] = b.dataset.clearQuery === "exact" ? false : "";
      ctx.state.logs.page = 1;
      ctx.renderRoute(true);
    });
    root.querySelectorAll("[data-query-column]").forEach((input) => input.onchange = () => {
      const next = columns();
      next[input.dataset.queryColumn] = input.checked;
      if (!store.set("query-columns", next)) ctx.toast("显示列偏好无法保存", "error");
      applyColumns(root);
    });
    root.querySelector("#log-save-view").onclick = () => ctx.modalOpen("保存筛选", "仅保存在当前浏览器", `<div class="field"><label for="query-view-name">名称</label><input id="query-view-name" maxlength="40" placeholder="例如：工作电脑的失败查询"></div>`, async () => {
      const name = document.querySelector("#query-view-name").value.trim();
      if (!name) throw new Error("请填写筛选名称");
      const saved = [{ name, filter: cleanFilter(ctx.state.logs) }, ...views().filter((v) => v.name !== name)].slice(0, 12);
      if (!store.set("query-views", saved)) throw new Error("浏览器无法保存，请检查存储空间");
      ctx.toast("筛选已保存");
      ctx.renderRoute(true);
    });
    root.querySelector("#log-export").onclick = () => ctx.downloadText("LocalDNS-query-page-" + ctx.state.logs.page + ".json", JSON.stringify(rows, null, 2));
    root.querySelector("#log-pause").onclick = () => {
      ctx.state.logsPaused = !ctx.state.logsPaused;
      root.querySelector("#log-pause").textContent = ctx.state.logsPaused ? "继续刷新" : "暂停刷新";
      root.querySelector("#log-pause").setAttribute("aria-pressed", String(ctx.state.logsPaused));
      root.querySelector("#log-live-state").textContent = ctx.state.logsPaused ? "刷新已暂停" : "自动刷新已开启";
    };
  }
  let rankLatency;
  const latency = (row) => row.average_duration_ms !== void 0 && row.average_duration_ms !== null && row.average_duration_ms !== "" && Number.isFinite(Number(row.average_duration_ms)) ? ctx.ms(row.average_duration_ms) : null;
  function latencyCell(kind, item) {
    const provided = latency(item);
    return `<td data-rank-latency-kind="${kind}" data-rank-latency-key="${esc2(item.key)}"${provided ? ' data-latency-ready="true" title="后端排行统计"' : ""}>${provided || '<button type="button" class="workspace-text-button" data-load-rank-latency>查看延时</button>'}</td>`;
  }
  function hydrateRankLatency(root) {
    const cells = [...root.querySelectorAll("[data-rank-latency-kind]:not([data-latency-ready])")];
    if (!cells.length) return;
    rankLatency || (rankLatency = rankLatencyService.create((options) => ctx.loadLogs(options)));
    const observer = new IntersectionObserver((entries2) => entries2.forEach((entry) => {
      if (entry.isIntersecting) {
        observer.unobserve(entry.target);
        load(entry.target);
      }
    }), { rootMargin: "120px" });
    async function load(cell) {
      if (cell.dataset.latencyReady || cell.dataset.latencyLoading) return;
      cell.dataset.latencyLoading = "true";
      cell.textContent = "统计中…";
      try {
        const result = await rankLatency.get(cell.dataset.rankLatencyKind, cell.dataset.rankLatencyKey, () => cell.isConnected);
        if (!cell.isConnected) return;
        cell.dataset.latencyReady = "true";
        cell.textContent = result.average === null ? "暂无样本" : ctx.ms(result.average);
        cell.title = result.average === null ? "该分类暂无有效请求耗时，未用 0 代替缺失数据" : `${result.partial ? "近期" : "当前保留"} ${number(result.samples)} 条有效请求的平均耗时；含缓存与本地应答`;
        if (result.partial && result.samples) {
          const note = document.createElement("span");
          note.className = "workspace-subline";
          note.textContent = `近 ${number(result.samples)} 条`;
          cell.append(note);
        }
      } catch (error) {
        if (cell.isConnected && error.name !== "AbortError") {
          setHTML(cell, '<button type="button" class="workspace-text-button" data-load-rank-latency>重试</button>');
          cell.title = "请求耗时读取失败，点击重试";
        }
      } finally {
        delete cell.dataset.latencyLoading;
      }
    }
    cells.forEach((cell) => {
      observer.observe(cell);
      cell.onclick = (event) => {
        if (event.target.closest("[data-load-rank-latency]")) load(cell);
      };
    });
    ctx.trackRouteCleanup(() => observer.disconnect());
  }
  function rankTable(kind, items, aliases = {}, limit = 8) {
    const label = (item) => kind === "client" ? aliases[item.key] || item.key : kind === "set" ? overviewInsightsService.label(item.key) : item.key;
    return `<div class="table-wrap"><table class="workspace-rank-table"><thead><tr><th scope="col">${{ domain: "域名", client: "客户端", set: "解析去向" }[kind]}</th><th scope="col">请求数</th><th scope="col">平均延时</th></tr></thead><tbody>${items.slice(0, limit).map((item) => `<tr><td><button type="button" class="workspace-text-button" data-rank-kind="${kind}" data-rank-key="${esc2(item.key)}" title="${esc2(item.key)}">${esc2(label(item))}</button>${kind === "client" && aliases[item.key] ? `<span class="workspace-subline mono">${esc2(item.key)}</span>` : ""}</td><td>${number(item.count)}</td>${latencyCell(kind, item)}</tr>`).join("") || '<tr><td colspan="3" class="table-empty">暂无记录</td></tr>'}</tbody></table></div>`;
  }
  function rankings({ domains, clients, sets, total, aliases }) {
    const limit = matchMedia("(max-width:600px)").matches ? 5 : 8;
    return `<div class="workspace-rank-period"><span>当前审计保留记录</span><span>总请求 ${number(total)}</span></div><div class="workspace-rank-grid">${[["domain", "TOP 域名", domains], ["client", "TOP 客户端", clients], ["set", "解析去向", sets]].map(([kind, name, items]) => `<section class="glass-card workspace-rank-card"><header class="gc-head"><div><h2 class="gc-title">${name}</h2><p class="workspace-subline">显示前 ${Math.min(limit, items.length)} · ${percent(items.slice(0, limit).reduce((n, r) => n + Number(r.count || 0), 0), total)}</p></div><button type="button" class="workspace-text-button" data-rank-all="${kind}">更多</button></header>${rankTable(kind, items, aliases, limit)}</section>`).join("")}</div><details class="workspace-note"><summary>统计口径</summary><p>请求数来自当前审计保留记录。平均延时优先使用后端统计；未提供时，按每项最近最多 1,000 条请求日志计算，超过范围时标注样本数，结果缓存 60 秒。含缓存命中与本地应答的真实请求耗时，不等同于上游响应时间；0.00 ms 表示请求日志记录为 0 毫秒。</p></details>`;
  }
  function rankNavigate(kind, key) {
    Object.assign(ctx.state.logs, { page: 1, q: "", client: "", set: "", code: "", type: "", exact: false }, kind === "client" ? { client: key, q: key, exact: true } : kind === "set" ? { set: key } : { q: key, exact: true });
    ctx.navigate("logs");
  }
  function bindRanks(root, data) {
    hydrateRankLatency(root);
    root.querySelectorAll("[data-rank-kind]").forEach((b) => b.onclick = () => rankNavigate(b.dataset.rankKind, b.dataset.rankKey));
    root.querySelectorAll("[data-rank-all]").forEach((b) => b.onclick = () => {
      const kind = b.dataset.rankAll, items = { domain: data.domains, client: data.clients, set: data.sets }[kind];
      ctx.openDrawer({ domain: "域名排行", client: "客户端排行", set: "解析去向" }[kind], "当前审计保留记录 · 最多 " + items.length + " 项", rankTable(kind, items, data.aliases, items.length));
      hydrateRankLatency(document.querySelector("#drawer"));
      document.querySelectorAll("#drawer [data-rank-kind]").forEach((button) => button.onclick = () => {
        ctx.closeDrawer();
        rankNavigate(button.dataset.rankKind, button.dataset.rankKey);
      });
    });
  }
  function upstreams(rows, groups) {
    const total = rows.reduce((n, r) => n + Number(r.m.q || 0), 0);
    return `<div class="workspace-upstream-groups">${groups.map((group) => {
      const items = rows.filter((r) => r.g === group), q = items.reduce((n, r) => n + Number(r.m.q || 0), 0);
      return `<section class="glass-card workspace-upstream-group"><header class="gc-head"><div><h2 class="gc-title">${esc2(ctx.groupName(group))}</h2><span class="workspace-subline">${items.filter((r) => r.u.enabled !== false).length} 个启用节点</span></div><span class="workspace-upstream-total">${number(q)} 次 · ${percent(q, total)}</span></header><div class="table-wrap"><table class="workspace-upstream-table"><thead><tr><th>启用</th><th>节点 / 协议 / 地址</th><th>请求数</th><th>平均响应</th><th>采纳率</th><th>错误</th><th>成功率</th><th>操作</th></tr></thead><tbody>${items.map(({ g, u, i, m }) => `<tr data-group="${esc2(g)}" data-index="${i}"><td><label class="switch"><input class="up-toggle" type="checkbox" aria-label="启用 ${esc2(u.tag)}" ${u.enabled !== false ? "checked" : ""}><span class="switch-track"><span class="switch-thumb"></span></span></label></td><td><strong>${esc2(u.tag)}</strong> ${badge(u.protocol)}<span class="workspace-subline mono">${esc2(u.addr || u.server_addr || "—")}</span></td><td>${number(m.q)}<span class="workspace-subline">${percent(m.q, total)}</span></td><td>${m.latencySamples > 0 ? ctx.ms(m.latency) : "—"}</td><td>${percent(m.win, m.q)}</td><td>${m.err ? `<button type="button" class="up-error-detail-trigger" data-group="${esc2(g)}" data-index="${i}" aria-label="查看 ${esc2(u.tag)} 错误详情">${number(m.err)}</button>` : "0"}</td><td>${m.q > 0 && m.success !== null ? ctx.pct(m.success) : "—"}</td><td><div class="workspace-actions"><button type="button" class="button small up-edit">编辑</button><button type="button" class="button small danger up-delete">删除</button></div></td></tr>`).join("") || '<tr><td colspan="8" class="table-empty">暂无上游节点</td></tr>'}</tbody></table></div></section>`;
    }).join("")}</div><details class="workspace-note"><summary>统计口径</summary><p>份额按节点请求总数计算，并发可能计入多个节点。采纳率 = 采纳数 / 节点请求数；成功率与采纳率分别统计。无样本时显示“—”。</p></details>`;
  }
  const purpose = (r) => ["custom_cn", "geosite_cn", "geoip_cn"].includes(r.tag) ? "国内解析" : "海外解析";
  function diversionList(rows, format) {
    return `<div class="table-wrap collection-diversion-wrap"><table class="collection-diversion-table"><thead><tr>${["启用", "类型", "名称", "格式", "订阅地址", "规则数", "自动更新", "上次更新", "操作"].map((name) => `<th scope="col">${name}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr class="collection-diversion-row" data-tag="${esc2(r.tag)}" data-name="${esc2(r.name)}" data-purpose="${purpose(r)}" data-search="${esc2([r.name, r.group, r.url, r.files].join(" ").toLowerCase())}"><td><label class="switch"><input class="div-enable" type="checkbox" aria-label="启用 ${esc2(r.name)}" ${r.enabled ? "checked" : ""}><span class="switch-track"><span class="switch-thumb"></span></span></label></td><td>${esc2(r.group)}</td><td><strong>${esc2(r.name)}</strong></td><td>${esc2(format(r))}</td><td><div class="collection-source" title="${esc2(r.url || r.files || "")}">${esc2(r.url || r.files || "未配置来源")}</div></td><td>${r.rule_count !== void 0 ? number(r.rule_count) : "—"}</td><td>${r.auto_update ? "是" : "否"}</td><td>${esc2(ctx.fmtDate(r.last_updated || r.updated_at))}</td><td><div class="workspace-actions"><button type="button" class="button small div-detail">详情</button><button type="button" class="button small div-update">更新</button><button type="button" class="button small div-edit">编辑</button><button type="button" class="button small danger div-delete">删除</button></div></td></tr>`).join("")}</tbody></table></div>`;
  }
  function diversion(rows, errors, format) {
    return `${errors.length ? `<div class="error-panel">${errors.map((x) => {
      var _a2;
      return esc2(x.def.label) + "：" + esc2(((_a2 = x.error) == null ? void 0 : _a2.message) || "读取失败");
    }).join("；")}</div>` : ""}<div class="workspace-rule-filter"><input id="div-search" aria-label="搜索在线规则" placeholder="搜索名称、类型或来源" value="${esc2(ruleFilter.q)}"><div class="workspace-filter-buttons" role="group" aria-label="规则用途">${["全部", "国内解析", "海外解析"].map((g) => `<button type="button" class="glass-btn" data-div-purpose="${g}" aria-pressed="${ruleFilter.group === g}">${g}</button>`).join("")}</div></div><div data-collection-view="cards">${["国内解析", "海外解析"].map((group) => `<section class="workspace-rule-group" data-purpose-group="${group}"><header><h3>${group}</h3><span>${rows.filter((r) => purpose(r) === group).length} 个来源</span></header><div class="workspace-rule-grid">${rows.filter((r) => purpose(r) === group).map((r) => `<article class="workspace-rule-card" data-tag="${esc2(r.tag)}" data-name="${esc2(r.name)}" data-purpose="${group}" data-search="${esc2([r.name, r.group, r.url, r.files].join(" ").toLowerCase())}"><header><div><h3>${esc2(r.name)}</h3><span class="workspace-subline">${esc2(r.group)}</span></div><label class="switch"><input class="div-enable" type="checkbox" aria-label="启用 ${esc2(r.name)}" ${r.enabled ? "checked" : ""}><span class="switch-track"><span class="switch-thumb"></span></span></label></header><p class="workspace-rule-source" title="${esc2(r.url || r.files || "")}">${esc2(r.url || r.files || "未配置来源")}</p><div class="workspace-rule-facts">${badge(format(r))}<span>${r.rule_count !== void 0 ? number(r.rule_count) + " 条" : "数量未记录"}</span>${badge(r.enabled ? "已启用" : "已关闭", r.enabled ? "success" : "")}</div><footer><span>${r.last_error ? esc2(r.last_error) : esc2(ctx.fmtDate(r.last_updated || r.updated_at))}</span><button type="button" class="button small div-detail">查看详情</button></footer><div class="workspace-rule-actions"><button type="button" class="button small div-update">更新</button><button type="button" class="button small div-edit">编辑</button><button type="button" class="button small danger div-delete">删除</button></div></article>`).join("")}</div></section>`).join("")}</div><div data-collection-view="list">${diversionList(rows, format)}</div><p id="div-empty" class="workspace-empty" hidden>没有匹配的规则，试试其他名称或用途。</p>`;
  }
  function bindDiversion(root) {
    const apply3 = () => {
      let total = 0;
      root.querySelectorAll(".workspace-rule-card,.collection-diversion-row").forEach((card2) => {
        card2.hidden = !!(ruleFilter.group !== "全部" && card2.dataset.purpose !== ruleFilter.group || ruleFilter.q && !card2.dataset.search.includes(ruleFilter.q.toLowerCase()));
        if (!card2.hidden) total++;
      });
      root.querySelectorAll("[data-purpose-group]").forEach((group) => group.hidden = ![...group.querySelectorAll(".workspace-rule-card")].some((c) => !c.hidden));
      root.querySelector("#div-empty").hidden = total > 0;
      root.querySelector(".collection-diversion-wrap").hidden = total === 0;
      root.querySelectorAll("[data-div-purpose]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.divPurpose === ruleFilter.group)));
    };
    root.querySelector("#div-search").oninput = (e) => {
      ruleFilter.q = e.target.value.trim();
      apply3();
    };
    root.querySelectorAll("[data-div-purpose]").forEach((b) => b.onclick = () => {
      ruleFilter.group = b.dataset.divPurpose;
      apply3();
    });
    apply3();
  }
  function ruleDetails(rule, edit, format) {
    const draw = (tab) => {
      var _a2;
      const values = tab === "content" ? [["格式", format(rule)], ["规则数量", rule.rule_count === void 0 ? "未记录" : number(rule.rule_count)], ["源缓存文件", rule.files || rule.path || "未记录"]] : tab === "source" ? [["订阅地址", rule.url || "未配置"], ["用途", purpose(rule)], ["类型", rule.group]] : tab === "update" ? [["上次更新", ctx.fmtDate(rule.last_updated || rule.updated_at)], ["自动更新", rule.auto_update ? "已开启" : "已关闭"], ["更新间隔", rule.update_interval_hours + " 小时"], ["上次错误", rule.last_error || "未记录"]] : [["名称", rule.name], ["启用状态", rule.enabled ? "已启用" : "已关闭"], ["数据集", rule.dataset || "自动识别"]];
      ctx.openDrawer(rule.name, "在线分流规则", `<div class="workspace-detail-tabs" role="group" aria-label="规则详情">${[["content", "内容"], ["source", "来源"], ["update", "更新"], ["advanced", "高级"]].map(([id, name]) => `<button type="button" class="glass-btn" data-rule-detail-tab="${id}" aria-pressed="${tab === id}">${name}</button>`).join("")}</div><dl class="workspace-facts">${values.map(([k, v]) => `<div><dt>${esc2(k)}</dt><dd>${esc2(v)}</dd></div>`).join("")}</dl>${tab === "content" ? '<p class="workspace-note-text">编译后的规则由订阅生成；修改内容请编辑订阅来源或本地名单。</p>' : ""}<button type="button" class="button primary" id="rule-detail-edit">编辑订阅</button>`);
      document.querySelectorAll("[data-rule-detail-tab]").forEach((b) => b.onclick = () => draw(b.dataset.ruleDetailTab));
      document.querySelector("#rule-detail-edit").onclick = () => {
        ctx.closeDrawer();
        edit();
      };
      (_a2 = document.querySelector('[data-rule-detail-tab="' + tab + '"]')) == null ? void 0 : _a2.focus({ preventScroll: true });
    };
    draw("content");
  }
  const draftKey = (rule) => "localdns-subscription-draft:" + ((ctx == null ? void 0 : ctx.apiBase) || location.host) + ":" + (rule ? rule.tag + ":" + rule.name : "new");
  function clearRuleDraft(rule) {
    try {
      sessionPreferences.removeItem(draftKey(rule));
    } catch {
    }
  }
  function trackRuleDraft(rule) {
    modalController == null ? void 0 : modalController.abort();
    modalController = new AbortController();
    const root = document.querySelector("#modal-content"), fields = ["name", "type", "url", "files", "enabled", "auto", "hours"];
    const snapshot = () => Object.fromEntries(fields.map((k) => {
      const el = root.querySelector("#div-" + k);
      return [k, el.type === "checkbox" ? el.checked : el.value];
    }));
    const baseline = JSON.stringify(snapshot()), key = draftKey(rule);
    try {
      const saved = JSON.parse(sessionPreferences.getItem(key));
      if (saved) fields.forEach((k) => {
        const el = root.querySelector("#div-" + k);
        if (typeof saved[k] === (el.type === "checkbox" ? "boolean" : "string")) {
          if (el.type === "checkbox") el.checked = saved[k];
          else el.value = saved[k];
        }
      });
    } catch {
    }
    const status = document.createElement("p");
    status.className = "workspace-draft-state";
    status.setAttribute("role", "status");
    root.prepend(status);
    const save = () => {
      if (!fields.every((k) => root.querySelector("#div-" + k))) {
        modalController == null ? void 0 : modalController.abort();
        return;
      }
      const next = snapshot(), dirty = JSON.stringify(next) !== baseline;
      try {
        if (dirty) sessionPreferences.setItem(key, JSON.stringify(next));
        else sessionPreferences.removeItem(key);
        status.textContent = dirty ? "未保存草稿 · 本次浏览器会话中保留" : "未修改";
      } catch {
        status.textContent = dirty ? "未保存修改 · 浏览器无法保留草稿" : "未修改";
      }
    };
    root.addEventListener("input", save, { signal: modalController.signal });
    root.addEventListener("change", save, { signal: modalController.signal });
    save();
  }
  function finish(root) {
    const title = root.querySelector(".view-title-row");
    if (title) {
      title.classList.add("workspace-page-tools");
      title.hidden = ctx.state.route === "overview" || !title.querySelector("h1") && !title.querySelector("button");
    }
    root.querySelectorAll(".workspace-upstream-table,.workspace-rank-table").forEach((t) => t.classList.remove("mobile-records"));
  }
  function topology(root, redraw, sets) {
    const wrap = root.querySelector("#topo-stage-wrap");
    if (!wrap) return;
    let toolbar = root.querySelector(".workspace-topology-tools");
    if (!toolbar) {
      toolbar = document.createElement("div");
      toolbar.className = "workspace-topology-tools";
      wrap.closest(".topology-glass-card").prepend(toolbar);
    }
    const choices = [["r1", "国内解析"], ["r3", "海外解析"], ["r4", "FakeIP"], ["r6", "本地拦截"]];
    const patterns = { r1: /^(domestic|geosite_cn|custom_cn)$|国内/i, r2: /^(whitelist|custom_cn)$|白名单/i, r3: /foreign|non_cn|海外|国外/i, r4: /fakeip|grey|灰/i, r5: /adguard|广告/i, r6: /block|black|拦截/i, g1: /^domestic$|国内/i, g2: /^foreign$|海外|国外/i, g3: /foreign_ecs/i, g4: /proxy|fakeip/i, g5: /block|adguard|拦截/i };
    const update = () => {
      var _a2;
      const id = ctx.state.overviewTopoLock, keys = patterns[id] ? (sets || []).filter((x) => patterns[id].test(x.key)).map((x) => x.key) : [];
      setHTML(toolbar, `<div class="workspace-filter-buttons" role="group" aria-label="锁定解析分支">${choices.map(([key, name]) => `<button type="button" class="glass-btn" data-topology-lock="${key}" aria-pressed="${id === key}">${name}</button>`).join("")}<button type="button" class="glass-btn" data-topology-clear aria-pressed="${!id}">全部路径</button></div><div class="workspace-topology-status"><span>${id ? "已锁定：" + esc2(((_a2 = root.querySelector('[data-node-id="' + id + '"] .tn-name')) == null ? void 0 : _a2.textContent) || id) : "选择分支或节点锁定路径"}</span><div class="workspace-actions"><button type="button" class="glass-btn" data-topology-node ${id ? "" : "disabled"}>节点详情</button><button type="button" class="glass-btn" data-topology-queries ${keys.length ? "" : "disabled"} title="${keys.length ? "查看对应分类" : "当前没有可对应的日志分类"}">相关查询</button></div></div>`);
      toolbar.querySelectorAll("[data-topology-lock]").forEach((b) => b.onclick = () => {
        ctx.state.overviewTopoLock = id === b.dataset.topologyLock ? null : b.dataset.topologyLock;
        redraw();
        update();
      });
      toolbar.querySelector("[data-topology-clear]").onclick = () => {
        ctx.state.overviewTopoLock = null;
        redraw();
        update();
      };
      toolbar.querySelector("[data-topology-node]").onclick = () => {
        const node = root.querySelector('[data-node-id="' + id + '"]');
        if (!node) return;
        const handler = node.onclick;
        node.onclick = node._workspaceOriginalClick || null;
        node.click();
        node.onclick = handler;
      };
      toolbar.querySelector("[data-topology-queries]").onclick = () => {
        if (keys.length === 1) rankNavigate("set", keys[0]);
        else {
          ctx.openDrawer("相关查询", "选择已记录的分流分类", keys.map((key) => `<button type="button" class="button" data-topology-set="${esc2(key)}">${esc2(key)}</button>`).join(""));
          document.querySelectorAll("[data-topology-set]").forEach((b) => b.onclick = () => {
            ctx.closeDrawer();
            rankNavigate("set", b.dataset.topologySet);
          });
        }
      };
    };
    root.querySelectorAll(".t-node").forEach((node) => {
      node._workspaceOriginalClick = node.onclick;
      node.onclick = (e) => {
        e.stopPropagation();
        ctx.state.overviewTopoLock = ctx.state.overviewTopoLock === node.dataset.nodeId ? null : node.dataset.nodeId;
        redraw();
        update();
      };
    });
    const onKey = (e) => {
      if (e.key === "Escape" && !document.querySelector(".drawer.open,dialog[open]")) {
        ctx.state.overviewTopoLock = null;
        redraw();
        update();
      }
    };
    root.addEventListener("keydown", onKey);
    ctx.trackRouteCleanup(() => root.removeEventListener("keydown", onKey));
    update();
  }
  workspaceService = { setup: (options) => {
    ctx = options;
  }, logTools, bindLogs, rankings, bindRanks, upstreams, diversion, bindDiversion, ruleDetails, trackRuleDraft, clearRuleDraft, modalChanging: () => modalController == null ? void 0 : modalController.abort(), finish, topology };
}
let collectionsService;
function initialize$9() {
  "use strict";
  const definitions = [
    { key: "diversion", name: "在线分流规则", selector: ".workspace-rule-filter", fallback: "cards" },
    { key: "adguard", name: "广告订阅", selector: ".adguard-rules-table", fallback: "list" },
    { key: "logs", name: "查询日志", selector: ".workspace-log-table", fallback: "list" },
    { key: "upstreams", name: "DNS 上游", selector: ".workspace-upstream-groups", fallback: "list" },
    { key: "caches", name: "缓存管理", selector: ".management-cache-grid,.data-cache-grid", fallback: "cards" },
    { key: "features", name: "功能开关", selector: ".management-feature-grid", fallback: "cards" }
  ];
  const paths = { cards: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>', list: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M3 14h18M9 4v16"/>' };
  const mobile = window.matchMedia("(max-width:600px)");
  let preferences$1 = {}, storageKey, toast2, observer, scheduled = false;
  function apply3(root, definition, controls) {
    const layout = preferences$1[definition.key] || (mobile.matches ? "cards" : definition.fallback);
    root.dataset.collectionLayout = layout;
    root.querySelectorAll("[data-collection-view]").forEach((view) => {
      view.hidden = view.dataset.collectionView !== layout;
    });
    controls.querySelectorAll("button").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.layout === layout));
    });
  }
  function scan() {
    const page2 = document.querySelector("#page-content");
    if (!page2) return;
    definitions.forEach((definition) => {
      const target = page2.querySelector(definition.selector);
      if (!target) return;
      const root = definition.key === "upstreams" ? target.parentElement : target.closest(".card");
      if (!root || root.dataset.collectionKind) return;
      const header = definition.key === "upstreams" ? page2.querySelector(".view-title-row") : root.querySelector(".card-header");
      if (!header) return;
      root.classList.add("collection-surface");
      root.dataset.collectionKind = definition.key;
      const controls = document.createElement("div");
      controls.className = "collection-switch";
      controls.dataset.collectionControl = definition.key;
      controls.setAttribute("role", "group");
      controls.setAttribute("aria-label", definition.name + "排列");
      setHTML(controls, ["cards", "list"].map((layout) => '<button type="button" data-layout="' + layout + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths[layout] + "</svg><span>" + (definition.key === "diversion" ? layout === "cards" ? "分组卡片" : "表格列表" : layout === "cards" ? "卡片" : "列表") + "</span></button>").join(""));
      let actions = header.querySelector(".card-actions,.cache-header-actions");
      if (!actions && definition.key !== "upstreams") {
        actions = document.createElement("div");
        actions.className = "card-actions";
        header.append(actions);
      }
      if (actions) actions.prepend(controls);
      else header.prepend(controls);
      root.querySelectorAll("table").forEach((table) => {
        table.classList.add("collection-table");
        table.setAttribute("role", "table");
        const labels = [...table.querySelectorAll("thead th")].map((cell) => cell.textContent.trim());
        table.querySelectorAll("tbody tr").forEach((row) => {
          row.setAttribute("role", "row");
          if (row.children.length === 1 && row.firstElementChild.colSpan > 1) row.classList.add("collection-empty-row");
          [...row.children].forEach((cell, index) => {
            cell.dataset.label = labels[index] || "";
            cell.setAttribute("role", "cell");
          });
        });
      });
      controls.addEventListener("click", (event) => {
        const button = event.target.closest("button[data-layout]");
        if (!button || !controls.contains(button)) return;
        preferences$1[definition.key] = button.dataset.layout;
        apply3(root, definition, controls);
        try {
          preferences.setItem(storageKey, JSON.stringify(preferences$1));
        } catch {
          toast2 == null ? void 0 : toast2("排列已切换，浏览器无法保存偏好", "error");
        }
        window.dispatchEvent(new Event("localdns:collectionlayoutchange"));
      });
      apply3(root, definition, controls);
    });
  }
  function setup(options) {
    storageKey = "localdns-collection-layouts-v1:" + (options.apiBase || location.host);
    toast2 = options.toast;
    try {
      const saved = JSON.parse(preferences.getItem(storageKey) || "{}");
      definitions.forEach(({ key }) => {
        if (saved && ["cards", "list"].includes(saved[key])) preferences$1[key] = saved[key];
      });
    } catch {
    }
    const page2 = document.querySelector("#page-content");
    observer == null ? void 0 : observer.disconnect();
    observer = new MutationObserver(() => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        scan();
      });
    });
    observer.observe(page2, { childList: true, subtree: true });
    mobile.addEventListener("change", () => definitions.forEach((definition) => {
      if (preferences$1[definition.key]) return;
      const root = page2.querySelector('[data-collection-kind="' + definition.key + '"]');
      const controls = page2.querySelector('[data-collection-control="' + definition.key + '"]');
      if (root && controls) apply3(root, definition, controls);
    }));
    scan();
  }
  collectionsService = { setup };
}
const clientsService = (() => {
  "use strict";
  const esc2 = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const own = (map, key) => Object.hasOwn(map, key);
  function aliases(value) {
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.values(value).some((v) => typeof v !== "string")) {
      throw new Error("客户端别名读取不完整，暂时无法保存。请关闭后重试。");
    }
    return { ...value };
  }
  function normalizeIP(value) {
    const text2 = String(value || "").trim();
    if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(text2)) {
      const parts2 = text2.split(".");
      if (parts2.every((part) => +part <= 255 && String(+part) === part)) return text2;
    } else if (text2.includes(":") && /^[0-9a-f:.]+$/i.test(text2)) {
      try {
        return new URL("http://[" + text2 + "]/").hostname.slice(1, -1);
      } catch {
      }
    }
    throw new Error("请输入有效的 IPv4 或 IPv6 地址。");
  }
  function mergeEdits(baseline, latest, edits) {
    const next = aliases(latest);
    for (const [ip, name] of edits) {
      if (own(latest, ip) !== own(baseline, ip) || latest[ip] !== baseline[ip]) {
        throw new Error(ip + " 的别名已被其他设备修改。请关闭后重新打开，避免覆盖新内容。");
      }
      if (name === null || !name.trim()) delete next[ip];
      else Object.defineProperty(next, ip, { value: name.trim(), enumerable: true, writable: true, configurable: true });
    }
    return next;
  }
  function topology(clients, names, total, compact = String) {
    const observed = (Array.isArray(clients) ? clients : []).filter((c) => typeof c.key === "string" && Number.isFinite(+c.count) && +c.count > 0);
    const denominator = Math.max(1, +total || 0);
    const result = observed.slice(0, 4).map((client, i) => ({
      id: "c" + (i + 1),
      ip: client.key,
      muted: false,
      name: names[client.key] || client.key,
      sub: client.key + " · " + compact(client.count) + " 次",
      val: Math.round(+client.count / denominator * 100) + "%",
      valColor: i === 0 ? "#93C5FD" : "var(--text-1)",
      icon: "monitor"
    }));
    const rest = observed.slice(4), count = rest.reduce((sum, c) => sum + +c.count, 0);
    if (rest.length) result.push({ id: "c5", ip: "", muted: false, name: "其余 " + rest.length + " 个来源", sub: "查询来源汇总 · " + compact(count) + " 次", val: Math.round(count / denominator * 100) + "%", valColor: "var(--text-2)", icon: "dots" });
    if (!result.length) result.push({ id: "c_empty", ip: "", muted: true, name: "暂无客户端请求", sub: "当前保留记录中没有查询来源", val: "暂无记录", valColor: "var(--text-3)", icon: "monitor" });
    return result;
  }
  async function open({ request: request2, rank, modal, notify, onSaved }) {
    const baseline = aliases(await request2("/plugins/client_name"));
    let observed = [], rankUnavailable = false;
    try {
      const value = await rank("client", 200);
      if (!Array.isArray(value)) throw new Error();
      observed = value;
    } catch {
      rankUnavailable = true;
    }
    const recorded = new Map(observed.map((c) => [String(c.key), +c.count || 0]));
    const rows = new Map([...recorded.keys(), ...Object.keys(baseline)].map((ip) => [ip, { ip, name: baseline[ip] || "", removed: false }]));
    const edits = /* @__PURE__ */ new Map();
    let host, busy = false;
    const current = () => [...rows.values()].filter((row) => !row.removed);
    const html2 = '<div class="client-manager"><p class="client-manager-note">名称保存在服务器，其他设备刷新后可见。移除别名只清除名称，不删除查询记录或改变设备联网。</p>' + (rankUnavailable ? '<p class="client-manager-note">查询来源暂时不可用，已保存的别名仍可管理。</p>' : "") + '<div class="client-manager-toolbar"><label class="field">搜索 IP 或别名<input type="search" id="client-alias-search" autocomplete="off"></label><span id="client-alias-count"></span></div><div id="client-alias-list" class="client-alias-list"></div><div class="client-alias-add"><label class="field">客户端 IP<input id="client-alias-new-ip" placeholder="192.168.8.100 或 IPv6" autocomplete="off"></label><label class="field">别名<input id="client-alias-new-name" maxlength="100" placeholder="例如：书房电脑" autocomplete="off"></label><button type="button" class="glass-btn" id="client-alias-add">添加</button></div><p id="client-alias-feedback" class="client-manager-note" role="status" aria-live="polite">更改后点击下方“保存”；取消不会写入服务器。</p></div>';
    function feedback(text2) {
      host.querySelector("#client-alias-feedback").textContent = text2;
    }
    function updateCount() {
      host.querySelector("#client-alias-count").textContent = current().length + " 个来源 · " + edits.size + " 项待保存";
    }
    function setEdit(row, value) {
      if (value === baseline[row.ip] || value === null && !own(baseline, row.ip)) edits.delete(row.ip);
      else edits.set(row.ip, value);
      updateCount();
    }
    function renderList() {
      const query = host.querySelector("#client-alias-search").value.trim().toLowerCase();
      const visible = current().filter((row) => (row.ip + " " + row.name).toLowerCase().includes(query));
      setHTML(host.querySelector("#client-alias-list"), visible.map((row, i) => '<div class="client-alias-row"><div class="client-alias-identity"><strong>' + esc2(row.ip) + "</strong><small>" + (recorded.has(row.ip) ? recorded.get(row.ip).toLocaleString("zh-CN") + " 次查询 · 当前保留记录" : own(baseline, row.ip) ? "已保存别名 · 当前保留记录中未出现" : "新增别名 · 尚未保存") + '</small></div><label class="field"><span class="client-alias-label">设备别名</span><input data-client-name="' + esc2(row.ip) + '" aria-label="' + esc2(row.ip) + ' 的别名" value="' + esc2(row.name) + '" maxlength="100" autocomplete="off"></label><button type="button" class="glass-btn client-alias-remove" data-client-remove="' + esc2(row.ip) + '" aria-label="移除 ' + esc2(row.ip) + ' 的别名" ' + (!row.name ? "disabled" : "") + ">移除别名</button></div>").join("") || '<p class="client-manager-note">没有匹配的来源或别名。</p>');
      updateCount();
    }
    modal("客户端管理", "全部已保存别名与最近最多 200 个查询来源", html2, async () => {
      var _a2, _b2;
      if (busy || !host.isConnected || !((_a2 = host.closest("dialog")) == null ? void 0 : _a2.open)) throw new Error("窗口已关闭，请重新打开客户端管理。");
      if (host.querySelector("#client-alias-new-ip").value.trim() || host.querySelector("#client-alias-new-name").value.trim()) throw new Error("新增项尚未添加，请先点击“添加”或清空输入。");
      if (!edits.size) return;
      busy = true;
      const submitted = new Map(edits), controls = [...host.querySelectorAll("input,button")].map((el) => [el, el.disabled]);
      controls.forEach(([el]) => {
        el.disabled = true;
      });
      try {
        const latest = aliases(await request2("/plugins/client_name"));
        const next = mergeEdits(baseline, latest, submitted);
        if (!host.isConnected || !((_b2 = host.closest("dialog")) == null ? void 0 : _b2.open)) throw new Error("窗口已关闭，未提交更改。");
        await request2("/plugins/client_name", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(next) });
        onSaved(next);
        notify("客户端别名已保存到服务器");
      } finally {
        busy = false;
        controls.forEach(([el, disabled]) => {
          el.disabled = disabled;
        });
      }
    });
    host = document.querySelector("#modal-content .client-manager");
    host.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.target.tagName !== "INPUT") return;
      event.preventDefault();
      if (["client-alias-new-ip", "client-alias-new-name"].includes(event.target.id)) host.querySelector("#client-alias-add").click();
    });
    host.querySelector("#client-alias-search").oninput = renderList;
    host.querySelector("#client-alias-list").oninput = (event) => {
      const ip = event.target.dataset.clientName;
      if (!ip || busy) return;
      const row = rows.get(ip);
      row.name = event.target.value;
      setEdit(row, row.name.trim() || null);
      event.target.closest(".client-alias-row").querySelector("[data-client-remove]").disabled = !row.name.trim();
    };
    host.querySelector("#client-alias-list").onclick = (event) => {
      const button = event.target.closest("[data-client-remove]");
      if (!button || busy) return;
      const row = rows.get(button.dataset.clientRemove);
      row.name = "";
      row.removed = !recorded.has(row.ip);
      setEdit(row, null);
      renderList();
      feedback(row.ip + " 的别名已标记移除，点击“保存”后生效；取消可放弃。");
    };
    host.querySelector("#client-alias-add").onclick = () => {
      if (busy) return;
      const ipInput = host.querySelector("#client-alias-new-ip"), nameInput = host.querySelector("#client-alias-new-name");
      try {
        const ip = normalizeIP(ipInput.value), name = nameInput.value.trim();
        if (!name) throw new Error("请输入设备别名。");
        const duplicate = [...rows.values()].find((row) => {
          try {
            return normalizeIP(row.ip) === ip && !row.removed;
          } catch {
            return row.ip === ip && !row.removed;
          }
        });
        if (duplicate) throw new Error("这个 IP 已在列表中，请直接修改它的别名。");
        rows.set(ip, { ip, name, removed: false });
        setEdit(rows.get(ip), name);
        ipInput.value = "";
        nameInput.value = "";
        host.querySelector("#client-alias-search").value = "";
        renderList();
        feedback(ip + " 已添加，点击“保存”后生效。");
      } catch (error) {
        feedback(error.message);
      }
    };
    renderList();
  }
  return { aliases, normalizeIP, mergeEdits, topology, open };
})();
function initialize$8() {
}
let ruleSaveService;
function initialize$7() {
  "use strict";
  const running = /* @__PURE__ */ new Set();
  const normalize = (value) => String(value).split("\n").map((line) => line.trim()).filter(Boolean).join("\n");
  async function save(tag, value, baseline, read, write) {
    if (running.has(tag)) throw new Error("这份名单正在保存，请稍候。");
    if (typeof baseline !== "string") throw new Error("名单尚未完整读取，请重新打开后保存。");
    running.add(tag);
    try {
      const current = String(await read());
      if (normalize(current) !== normalize(baseline)) throw new Error("服务器上的名单已有变化。当前编辑已保留为草稿，请重新读取后核对，避免覆盖其他修改。");
      const latest = String(await read());
      if (normalize(latest) !== normalize(current)) throw new Error("名单已被其他设备修改，请重新读取后保存。");
      await write(normalize(value).split("\n").filter(Boolean));
    } finally {
      running.delete(tag);
    }
  }
  ruleSaveService = { save, isSaving: (tag) => running.has(tag) };
}
const routeIds = ["overview", "logs", "upstreams", "rules", "management", "proxy-config"];
function resolveRoute(value) {
  let id = value.replace(/^#\/?/, "").split("?")[0];
  if (id === "data" || id === "features") id = "management";
  return routeIds.includes(id) ? id : "overview";
}
const icons$1 = {
  overview: '<path d="M4 13h6V3H4v10Zm0 8h6v-6H4v6Zm10 0h6V11h-6v10Zm0-18v6h6V3h-6Z"/>',
  logs: '<path d="M5 4h14v2H5V4Zm0 5h14v2H5V9Zm0 5h9v2H5v-2Zm0 5h7v2H5v-2Z"/>',
  upstream: '<path d="M12 3a5 5 0 0 1 5 5v1h1a3 3 0 1 1 0 6h-1v1a5 5 0 0 1-10 0v-1H6a3 3 0 1 1 0-6h1V8a5 5 0 0 1 5-5Zm-3 6h6V8a3 3 0 1 0-6 0v1Zm0 6v1a3 3 0 1 0 6 0v-1H9Z"/>',
  rules: '<path d="M4 4h7v7H4V4Zm2 2v3h3V6H6Zm7-2h7v7h-7V4Zm2 2v3h3V6h-3ZM4 13h7v7H4v-7Zm2 2v3h3v-3H6Zm7-2h2v2h-2v-2Zm3 0h4v2h-4v-2Zm-3 3h7v2h-7v-2Zm0 3h5v2h-5v-2Z"/>',
  data: '<path d="M12 3c-4.42 0-8 1.34-8 3v12c0 1.66 3.58 3 8 3s8-1.34 8-3V6c0-1.66-3.58-3-8-3Zm0 2c3.48 0 5.65.82 5.98 1-.33.18-2.5 1-5.98 1s-5.65-.82-5.98-1c.33-.18 2.5-1 5.98-1ZM6 8.45C7.47 8.82 9.55 9 12 9s4.53-.18 6-.55V11c0 .35-2.1 1-6 1s-6-.65-6-1V8.45Zm0 5C7.47 13.82 9.55 14 12 14s4.53-.18 6-.55V16c0 .35-2.1 1-6 1s-6-.65-6-1v-2.55Zm6 5.55c-3.9 0-6-.65-6-1v-.55c1.47.37 3.55.55 6 .55s4.53-.18 6-.55V18c0 .35-2.1 1-6 1Z"/>',
  settings: '<path d="M19.43 12.98c.04-.32.07-.65.07-.98s-.03-.66-.08-.98l2.11-1.65-2-3.46-2.49 1a7.54 7.54 0 0 0-1.7-.99L15 3.25h-4l-.35 2.67c-.61.25-1.18.58-1.7.99l-2.49-1-2 3.46 2.11 1.65c-.05.32-.08.65-.08.98s.03.66.08.98l-2.11 1.65 2 3.46 2.49-1c.52.41 1.09.74 1.7.99L11 20.75h4l.35-2.67c.61-.25 1.18-.58 1.7-.99l2.49 1 2-3.46-2.11-1.65ZM13 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8Z"/>',
  features: '<path d="M7 2h2v3h6V2h2v3h2a2 2 0 0 1 2 2v3h-2V7H5v10h5v2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2V2Zm8 10h2v3h3v2h-3v3h-2v-3h-3v-2h3v-3Z"/>',
  management: '<path d="M4 5h8v2H4V5Zm12-2h2v2h2v2h-2v2h-2V7h-2V5h2V3ZM4 11h2v2H4v-2Zm6-2h2v2h8v2h-8v2h-2v-2H8v-2h2V9ZM4 17h10v2H4v-2Zm14-2h2v2h2v2h-2v2h-2v-2h-2v-2h2v-2Z"/>',
  system: '<path d="M4 4h16v12H4V4Zm2 2v8h12V6H6Zm3 12h6v2H9v-2Z"/>',
  power: '<path d="M13 3h-2v10h2V3Zm4.83 2.17-1.42 1.42A6.92 6.92 0 0 1 19 12c0 3.87-3.13 7-7 7A6.995 6.995 0 0 1 7.58 6.58L6.17 5.17A8.93 8.93 0 0 0 3 12a9 9 0 0 0 18 0c0-2.74-1.23-5.18-3.17-6.83Z"/>',
  refresh: '<path d="M17.65 6.35A8 8 0 1 0 20 12h-2a6 6 0 1 1-1.76-4.24L13 11h8V3l-3.35 3.35Z"/>',
  theme: '<path d="M12 3a9 9 0 1 0 9 9c0-.46-.04-.91-.1-1.35A7 7 0 0 1 12 3Z"/>',
  menu: '<path d="M4 6h16v2H4V6Zm0 5h16v2H4v-2Zm0 5h16v2H4v-2Z"/>',
  close: '<path d="m6.4 5 5.6 5.6L17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6l5.6-5.6L5 6.4 6.4 5Z"/>',
  chevron: '<path d="m8.6 4.6 7.4 7.4-7.4 7.4L7.2 18l6-6-6-6 1.4-1.4Z"/>',
  search: '<path d="M10 4a6 6 0 1 0 3.87 10.59L19.28 20 20.7 18.6l-5.41-5.41A6 6 0 0 0 10 4Zm0 2a4 4 0 1 1 0 8 4 4 0 0 1 0-8Z"/>',
  plus: '<path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6V5Z"/>',
  edit: '<path d="m14.69 4.86 4.45 4.45L8.45 20H4v-4.45L14.69 4.86Zm0 2.83L6 16.38V18h1.62l8.69-8.69-1.62-1.62ZM17.5 2 22 6.5l-1.45 1.45-4.5-4.5L17.5 2Z"/>',
  trash: '<path d="M8 3h8l1 2h4v2H3V5h4l1-2Zm-2 6h12l-1 12H7L6 9Zm3 2 .5 8h2L11 11H9Zm4 0-.5 8h2l.5-8h-2Z"/>',
  save: '<path d="M4 3h14l2 2v16H4V3Zm2 2v14h12V6.83L17.17 5H16v5H8V5H6Zm4 0v3h4V5h-4Zm-1 8h6v4H9v-4Z"/>',
  info: '<path d="M11 10h2v7h-2v-7Zm0-4h2v2h-2V6Zm1-4a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 2a8 8 0 1 1 0 16 8 8 0 0 1 0-16Z"/>',
  check: '<path d="m9.2 16.2-4.4-4.4L3.4 13.2 9.2 19 21 7.2 19.6 5.8 9.2 16.2Z"/>',
  warning: '<path d="M12 3 2 21h20L12 3Zm0 4.1L18.6 19H5.4L12 7.1ZM11 10h2v5h-2v-5Zm0 6h2v2h-2v-2Z"/>',
  download: '<path d="M11 3h2v9l3-3 1.4 1.4L12 15.8l-5.4-5.4L8 9l3 3V3ZM4 18h16v3H4v-3Z"/>',
  clock: '<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 2a8 8 0 1 1 0 16 8 8 0 0 1 0-16Zm-1 3h2v4.59l3.2 3.2-1.4 1.42L11 12.41V7Z"/>',
  uptime: '<path d="M9 2h6v2H9V2Zm2 4h2v2.08A7 7 0 1 1 11 8.08V6Zm1 4a5 5 0 1 0 0 10 5 5 0 0 0 0-10Zm-1 1h2v3.59l2.2 2.2-1.4 1.42L11 15.41V11Z"/>',
  cpu: '<path d="M9 2h2v3h2V2h2v3h1a3 3 0 0 1 3 3v1h3v2h-3v2h3v2h-3v1a3 3 0 0 1-3 3h-1v3h-2v-3h-2v3H9v-3H8a3 3 0 0 1-3-3v-1H2v-2h3v-2H2V9h3V8a3 3 0 0 1 3-3h1V2Zm-1 5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1H8Zm2 3h4v4h-4v-4Z"/>',
  memory: '<path d="M4 5h16v12H4V5Zm2 2v8h12V7H6Zm2 2h2v4H8V9Zm3 0h2v4h-2V9Zm3 0h2v4h-2V9ZM6 19h2v3H6v-3Zm5 0h2v3h-2v-3Zm5 0h2v3h-2v-3Z"/>',
  latency: '<path d="M13 2 5 13h6l-1 9 9-12h-6l0-8Zm-2.1 9L12 9.5v4.5h3l-2.1 2.8.35-4.8h-2.35Z"/>',
  shield: '<path d="M12 2 4 5v6c0 5.25 3.44 9.74 8 11 4.56-1.26 8-5.75 8-11V5l-8-3Zm0 2.16 6 2.25V11c0 4.11-2.49 7.8-6 8.86C8.49 18.8 6 15.11 6 11V6.41l6-2.25Z"/>',
  clients: '<path d="M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm7-1a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM9 13c-4.42 0-7 2.18-7 5v2h14v-2c0-2.82-2.58-5-7-5Zm7.5-.5c-.76 0-1.47.08-2.12.22 2.27 1.1 3.62 2.98 3.62 5.28v2h4v-2c0-3.03-2.21-5.5-5.5-5.5Z"/>',
  globe: '<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm5.93 6h-3.08a15.9 15.9 0 0 0-1.3-3.38A8.04 8.04 0 0 1 17.93 8ZM12 4c.83 1.2 1.46 2.55 1.8 4h-3.6A13.2 13.2 0 0 1 12 4ZM4.26 14A8.23 8.23 0 0 1 4 12c0-.69.09-1.36.26-2h3.43a17.6 17.6 0 0 0 0 4H4.26Zm1.81 2h3.08c.3 1.2.74 2.33 1.3 3.38A8.04 8.04 0 0 1 6.07 16Zm3.08-8H6.07a8.04 8.04 0 0 1 4.38-3.38A15.9 15.9 0 0 0 9.15 8ZM12 20a13.2 13.2 0 0 1-1.8-4h3.6A13.2 13.2 0 0 1 12 20Zm2.15-6h-4.3a15.7 15.7 0 0 1 0-4h4.3a15.7 15.7 0 0 1 0 4Zm-.6 5.38c.56-1.05 1-2.18 1.3-3.38h3.08a8.04 8.04 0 0 1-4.38 3.38ZM16.31 14a17.6 17.6 0 0 0 0-4h3.43c.17.64.26 1.31.26 2s-.09 1.36-.26 2h-3.43Z"/>',
  requestCount: '<path d="M5 4h14v16H5V4Zm2 2v12h10V6H7Zm2 2h6v2H9V8Zm0 4h6v2H9v-2Zm0 4h4v2H9v-2Z"/>',
  cacheHit: '<path d="M12 3C7.58 3 4 4.34 4 6v10c0 1.66 3.58 3 8 3 1.16 0 2.26-.09 3.25-.25A5 5 0 0 1 15 17c0-.7.14-1.36.4-1.97-.98.15-2.12.22-3.4.22-3.9 0-6-.65-6-1v-2.55c1.47.37 3.55.55 6 .55 1.92 0 3.63-.11 5-.33v-2.07c-1.3.26-3.04.4-5 .4-3.9 0-6-.65-6-1V7.7c1.47.37 3.55.55 6 .55s4.53-.18 6-.55v2.8c.75.16 1.43.48 2 .91V6c0-1.66-3.58-3-8-3Zm0 2c3.48 0 5.65.82 5.98 1-.33.18-2.5 1-5.98 1s-5.65-.82-5.98-1c.33-.18 2.5-1 5.98-1Zm7.3 8.3-2.55 2.55-1.05-1.05-1.4 1.4 2.45 2.45 3.95-3.95-1.4-1.4Z"/>',
  responseTime: '<path d="M12 4a9 9 0 0 0-9 9h2a7 7 0 1 1 14 0h2a9 9 0 0 0-9-9Zm0 3a6 6 0 0 0-6 6h2a4 4 0 0 1 7.07-2.57L11 14.5l1.41 1.41 4.08-4.08A6 6 0 0 0 12 7Zm-8 8v2h16v-2H4Z"/>',
  blockedRequest: '<path d="M12 2 4 5v6c0 5.25 3.44 9.74 8 11 4.56-1.26 8-5.75 8-11V5l-8-3Zm0 2.16 6 2.25V11c0 4.11-2.49 7.8-6 8.86C8.49 18.8 6 15.11 6 11V6.41l6-2.25Zm-3.3 4.13L7.29 9.7 9.59 12l-2.3 2.3 1.42 1.41 2.29-2.3 2.3 2.3 1.41-1.42-2.3-2.29 2.3-2.3-1.42-1.41-2.29 2.3-2.3-2.3Z"/>',
  clientCount: '<path d="M8.5 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm7-1a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM8.5 13C4.7 13 2 14.9 2 17.5V20h13v-2.5C15 14.9 12.3 13 8.5 13Zm7.2-.5c-.72 0-1.4.08-2.02.23 2.07 1.08 3.32 2.78 3.32 4.77V20h5v-2.1c0-3.08-2.32-5.4-6.3-5.4Z"/>',
  domainStats: '<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm6.92 9h-3.01a15.9 15.9 0 0 0-1.02-4.1A8.03 8.03 0 0 1 18.92 11ZM12 4c.9 1.26 1.56 3.02 1.85 5h-3.7C10.44 7.02 11.1 5.26 12 4ZM5.08 13h3.01c.13 1.48.48 2.9 1.02 4.1A8.03 8.03 0 0 1 5.08 13Zm3.01-2H5.08a8.03 8.03 0 0 1 4.03-4.1A15.9 15.9 0 0 0 8.09 11ZM12 20c-.9-1.26-1.56-3.02-1.85-5h3.7c-.29 1.98-.95 3.74-1.85 5Zm2.07-7H9.93a13.9 13.9 0 0 1 0-2h4.14a13.9 13.9 0 0 1 0 2Zm.82 4.1c.54-1.2.89-2.62 1.02-4.1h3.01a8.03 8.03 0 0 1-4.03 4.1Z"/>',
  more: '<path d="M5 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm7 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm7 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z"/>'
};
const icon$1 = (name, cls = "") => `<svg class="${cls}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${icons$1[name] || icons$1.info}</svg>`;
const esc$1 = (v = "") => String(v).replace(/[&<>'"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[c]);
const num = (v) => Number.isFinite(+v) ? (+v).toLocaleString("zh-CN") : "—";
const pct = (v) => Number.isFinite(+v) ? `${(+v).toFixed(2)}%` : "—";
const compactNum = (v) => {
  const n = +v;
  if (!Number.isFinite(n)) return "—";
  if (Math.abs(n) < 1e4) return n.toLocaleString("zh-CN");
  return new Intl.NumberFormat("zh-CN", { notation: "compact", compactDisplay: "short", maximumFractionDigits: 1 }).format(n);
};
const fullNum = (v) => Number.isFinite(+v) ? Math.max(0, Math.floor(+v)).toLocaleString("zh-CN") : "—";
const compactPct = (v) => {
  const n = +v;
  if (!Number.isFinite(n)) return "—";
  return `${Number.isInteger(n) ? n.toFixed(0) : n.toFixed(1)}%`;
};
const ms = (v) => Number.isFinite(+v) ? `${(+v).toFixed(2)} ms` : "—";
const fmtBytesBrief = (v) => {
  const n = +v;
  if (!Number.isFinite(n)) return "—";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0, x = n;
  while (x >= 1024 && i < u.length - 1) {
    x /= 1024;
    i++;
  }
  const d = i === 0 ? 0 : x >= 100 ? 0 : x >= 10 ? 1 : 2;
  return `${x.toFixed(d)} ${u[i]}`;
};
const rankCount = (items, limit = 1e3) => !Array.isArray(items) ? "—" : items.length >= limit ? `${num(limit)}+` : num(items.length);
const startTimeMarkup = (seconds) => {
  const n = +seconds;
  if (!Number.isFinite(n) || n <= 0) return '<span class="overview-start-datetime">—</span>';
  const d = new Date(n * 1e3);
  if (Number.isNaN(d.getTime())) return '<span class="overview-start-datetime">—</span>';
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), day = String(d.getDate()).padStart(2, "0"), hh = String(d.getHours()).padStart(2, "0"), mm = String(d.getMinutes()).padStart(2, "0");
  return `<span class="overview-start-datetime">${y}-${m}-${day} ${hh}:${mm}</span>`;
};
const fmtDate = (v) => {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  if (d.getUTCFullYear() <= 1) return "—";
  return d.toLocaleString("zh-CN", { hour12: false });
};
const duration = (seconds) => {
  let s = Math.max(0, Math.floor(+seconds || 0));
  const d = Math.floor(s / 86400);
  s %= 86400;
  const h = Math.floor(s / 3600);
  s %= 3600;
  const m = Math.floor(s / 60);
  return `${d ? d + "天 " : ""}${h ? h + "小时 " : ""}${m}分钟`;
};
const overviewUptimeMarkup = (seconds) => {
  const s = Math.max(0, Math.floor(+seconds || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor(s % 3600 / 60);
  const sec = s % 60;
  const part = (n, u) => `<span class="overview-duration-part"><span class="overview-duration-num">${n}</span><span class="overview-duration-unit">${u}</span></span>`;
  if (h) return `${part(h, "小时")}${part(m, "分钟")}`;
  if (m) return part(m, "分钟");
  return part(sec, "秒");
};
function createLogQuery(mobile) {
  return { page: 1, limit: mobile ? 25 : 50, q: "", exact: false, type: "", set: "", code: "", client: "" };
}
function logQueryParams(query) {
  return {
    page: query.page,
    limit: query.limit,
    q: query.q,
    exact: query.exact,
    query_type: query.type,
    domain_set: query.set,
    response_code: query.code,
    client_contains: query.client
  };
}
const CONFIG = Object.assign({
  apiBase: "",
  title: "LocalDNS 控制台",
  refreshInterval: 30,
  requestTimeout: 1e4,
  demoOnApiFailure: false
}, window.LOCALDNS_UI_CONFIG || {});
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
const API_BASE = String(CONFIG.apiBase || "").replace(/\/$/, "");
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const page = $("#page-content");
const storage = { get(k) {
  try {
    return preferences.getItem(k);
  } catch {
    return null;
  }
}, set(k, v) {
  try {
    preferences.setItem(k, String(v));
  } catch {
  }
} };
const state = {
  route: "overview",
  logs: createLogQuery(matchMedia("(max-width:600px)").matches),
  ruleTag: "whitelist",
  mobileMoreOpen: false,
  renderSeq: 0,
  overviewSlowPage: 0,
  overviewDomainPage: 0,
  overviewSlowLimit: [5, 10, 20].includes(Number(storage.get("localdns-overview-slow-limit:" + (API_BASE || location.host)))) ? Number(storage.get("localdns-overview-slow-limit:" + (API_BASE || location.host))) : 10
};
function toast(message, type = "success", detail = "") {
  const el = document.createElement("div");
  el.className = `toast ${type} toast-enter`;
  setHTML(el, `<span>${icon$1(type === "error" ? "warning" : type === "success" ? "check" : "info")}</span><div><strong>${esc$1(message)}</strong>${detail ? `<div class="toast-info">${esc$1(detail)}</div>` : ""}</div>`);
  $("#toast-stack").appendChild(el);
  void el.offsetWidth;
  el.classList.remove("toast-enter");
  setTimeout(() => {
    el.classList.add("toast-leave");
    setTimeout(() => el.remove(), 280);
  }, 3920);
}
function openDrawer(title, subtitle, html2) {
  const wasOpen = $("#drawer").classList.contains("open");
  $("#drawer-title").textContent = title;
  $("#drawer-subtitle").textContent = subtitle;
  setHTML($("#drawer-content"), html2);
  $("#drawer").classList.add("open");
  $("#drawer").setAttribute("aria-hidden", "false");
  $("#drawer-backdrop").classList.add("open");
  if (!wasOpen) shellInterfaceService == null ? void 0 : shellInterfaceService.drawerOpened();
}
function closeDrawer() {
  $("#drawer").classList.remove("open");
  $("#drawer").setAttribute("aria-hidden", "true");
  $("#drawer-backdrop").classList.remove("open");
  shellInterfaceService == null ? void 0 : shellInterfaceService.drawerClosed();
}
function modalOpen(title, subtitle, html2, onSave, showActions = true) {
  workspaceService.modalChanging();
  $("#modal-title").textContent = title;
  $("#modal-subtitle").textContent = subtitle || "";
  setHTML($("#modal-content"), html2);
  setHTML($("#modal-actions"), showActions ? `<button class="button" id="modal-cancel" type="button" value="cancel">取消</button><button class="button primary" id="modal-save" type="button">保存</button>` : "");
  const scope = currentScope(), d = $("#modal");
  shellInterfaceService == null ? void 0 : shellInterfaceService.semantics(d);
  d.showModal();
  const cancel = $("#modal-cancel");
  if (cancel) cancel.onclick = modalClose;
  if (onSave && showActions) $("#modal-save").onclick = async () => {
    var _a2;
    if (!$("#modal-form").reportValidity()) return;
    const b = $("#modal-save");
    b.disabled = true;
    (_a2 = $("#modal-error")) == null ? void 0 : _a2.remove();
    try {
      const next = await onSave();
      if (scope.signal.aborted) return;
      modalClose();
      if (typeof next === "function") next();
    } catch (e) {
      if (scope.signal.aborted) return;
      shellInterfaceService == null ? void 0 : shellInterfaceService.formError(e.message);
      toast("操作失败", "error", e.message);
    } finally {
      b.disabled = false;
    }
  };
}
function modalClose() {
  workspaceService.modalChanging();
  const d = $("#modal");
  d.classList.remove("overview-detail-modal");
  if (d.open) d.close();
}
function record(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ApiError(`${name} 返回格式无效。`, 0, value, "contract");
  return value;
}
function array(value, name) {
  if (!Array.isArray(value)) throw new ApiError(`${name} 返回格式无效。`, 0, value, "contract");
  return value;
}
function normalizeResponse(path, value) {
  const endpoint = path.split("?")[0];
  if (endpoint === "/metrics") {
    if (typeof value !== "string") throw new ApiError("指标必须为文本。", 0, value, "contract");
  } else if (endpoint === "/api/v2/audit/logs") {
    const data = record(value, "查询日志");
    const logs = data.logs === void 0 ? [] : array(data.logs, "查询日志");
    logs.forEach((log) => {
      const item = record(log, "查询记录");
      for (const key of ["query_name", "query_type", "client_ip", "response_code"]) {
        if (item[key] !== void 0 && typeof item[key] !== "string") throw new ApiError(`查询记录 ${key} 类型无效。`, 0, item, "contract");
      }
      if (item.answers !== void 0) array(item.answers, "DNS 应答").forEach((answer) => record(answer, "DNS 应答"));
    });
    const filters = data.filters === void 0 ? {} : record(data.filters, "日志筛选");
    for (const key of ["query_types", "domain_sets", "response_codes"]) {
      if (filters[key] !== void 0 && !array(filters[key], "日志筛选").every((item) => typeof item === "string")) throw new ApiError("日志筛选类型无效。", 0, filters, "contract");
    }
    const pagination = data.pagination === void 0 ? {} : record(data.pagination, "分页");
    for (const key of ["current_page", "total_pages", "total_items"]) {
      if (pagination[key] !== void 0 && (!Number.isFinite(pagination[key]) || Number(pagination[key]) < 0)) throw new ApiError("分页数据无效。", 0, pagination, "contract");
    }
    return { ...data, logs, filters, pagination };
  } else if (endpoint === "/api/v1/upstream/tags") {
    if (!array(value, "上游分组").every((tag) => typeof tag === "string")) throw new ApiError("上游分组类型无效。", 0, value, "contract");
  } else if (endpoint === "/api/v1/upstream/ecs") {
    const data = record(value, "ECS");
    if (data.ecs !== void 0 && typeof data.ecs !== "string") throw new ApiError("ECS 类型无效。", 0, value, "contract");
  } else if (endpoint.startsWith("/api/v2/audit/rank/")) {
    array(value, "排行").forEach((item) => record(item, "排行项目"));
  } else if (["/api/v2/audit/stats", "/api/v1/audit/status", "/api/v1/audit/capacity", "/api/v1/upstream/config", "/api/v1/status", "/plugins/client_name"].includes(endpoint)) {
    const data = record(value, endpoint);
    if (endpoint === "/api/v1/upstream/config") {
      for (const group of Object.values(data)) array(group, "上游配置").forEach((item) => {
        const upstream = record(item, "上游");
        for (const key of ["tag", "addr", "server_addr", "protocol", "dial_addr", "socks5"]) {
          if (upstream[key] !== void 0 && typeof upstream[key] !== "string") throw new ApiError(`上游 ${key} 类型无效。`, 0, item, "contract");
        }
        if (upstream.enabled !== void 0 && typeof upstream.enabled !== "boolean") throw new ApiError("上游启用状态类型无效。", 0, item, "contract");
      });
    }
    if (endpoint === "/plugins/client_name" && !Object.values(data).every((alias) => typeof alias === "string")) {
      throw new ApiError("客户端别名类型无效。", 0, data, "contract");
    }
    if (endpoint === "/api/v2/audit/stats") {
      for (const key of ["total_queries", "average_duration_ms", "client_count", "domain_count"]) if (data[key] !== void 0 && !Number.isFinite(data[key])) throw new ApiError(`统计 ${key} 类型无效。`, 0, data, "contract");
    }
  }
  return value;
}
const api = {
  url: (path) => backendHttp.url(path),
  async request(path, options = {}) {
    const value = await backendHttp.request(path, options);
    return String(options.method || "GET").toUpperCase() === "GET" ? normalizeResponse(path, value) : value;
  },
  json(path, method = "GET", body) {
    return this.request(path, { method, headers: { "Content-Type": "application/json" }, body: body === void 0 ? void 0 : JSON.stringify(body) });
  },
  metrics() {
    return this.request("/metrics");
  },
  status() {
    return this.request("/api/v1/audit/status");
  },
  capacity() {
    return this.request("/api/v1/audit/capacity");
  },
  stats() {
    return this.request("/api/v2/audit/stats");
  },
  rank(type, limit = 10) {
    return this.request(`/api/v2/audit/rank/${type}?limit=${limit}`);
  },
  logs(params = {}) {
    const query = new URLSearchParams({ page: 1, limit: 50, ...params });
    for (const [key, value] of query) if (value === "" || value == null) query.delete(key);
    return this.request(`/api/v2/audit/logs?${query}`);
  }
};
let clientAliases = {};
async function loadAliases(scope = currentScope()) {
  try {
    clientAliases = await scope.guard(api.request("/plugins/client_name")) || {};
  } catch (error) {
    if (scope.signal.aborted) throw error;
    clientAliases = {};
  }
  scope.add(() => {
    clientAliases = {};
  });
  return clientAliases;
}
async function openAliasModal() {
  const scope = currentScope();
  try {
    await clientsService.open({
      request: (...args) => api.request(...args),
      rank: (...args) => api.rank(...args),
      modal: modalOpen,
      notify: toast,
      onSaved: (next) => {
        if (scope.signal.aborted) return;
        clientAliases = next;
        renderRoute(true);
      }
    });
  } catch (error) {
    if (scope.signal.aborted) return;
    toast("客户端管理读取失败", "error", error.message);
  }
}
const loadingPage = () => `<div class="grid grid-4 metrics-grid-mobile">${[1, 2, 3, 4].map(() => `<div class="metric-card skeleton" style="height:112px"></div>`).join("")}</div><div class="card skeleton" style="height:340px;margin-top:16px"></div>`;
function overviewMetricCard(label, value, iconName, tone = "primary") {
  return `<div class="metric-card overview-kpi-card tone-${tone}"><span class="metric-icon">${icon$1(iconName)}</span><div class="overview-kpi-body"><span class="overview-kpi-label">${esc$1(label)}</span><div class="metric-value">${value}</div></div></div>`;
}
function card(title, body, { iconName = "overview", subtitle = "", actions = "", className = "" } = {}) {
  return `<section class="card ${className}"><div class="card-header"><div class="card-title"><span class="icon">${icon$1(iconName)}</span><div><h2>${esc$1(title)}</h2>${subtitle ? `<p>${esc$1(subtitle)}</p>` : ""}</div></div><div class="card-actions">${actions}</div></div><div class="card-body">${body}</div></section>`;
}
const empty = (text2 = "暂无数据") => `<div class="empty-state"><div><div class="empty-icon">${icon$1("info")}</div><strong>${esc$1(text2)}</strong></div></div>`;
function rankRows(items, formatter = (x) => x.key, limit = 10) {
  if (!(items == null ? void 0 : items.length)) return empty();
  const list = Number.isFinite(limit) ? items.slice(0, Math.max(0, limit)) : items.slice();
  const max = Math.max(1, ...list.map((x) => +x.count || 0));
  return `<div class="rank-list">${list.map((x, i) => {
    const width = Math.max(4, Math.min(100, (+x.count || 0) / max * 100));
    return `<div class="rank-row" style="--rank:${width.toFixed(2)}%"><span class="rank-meter"></span><span class="rank-index">${i + 1}</span><span class="rank-name" title="${esc$1(formatter(x))}">${esc$1(formatter(x))}</span><span class="rank-value">${num(x.count)}</span></div>`;
  }).join("")}</div>`;
}
function slowTypeLabel(v) {
  const raw = String(v ?? "—").trim().toUpperCase();
  if (raw === "65") return "HTTPS";
  if (raw === "64") return "SVCB";
  return raw || "—";
}
function slowTypeSort(a, b) {
  const order = { A: 0, AAAA: 1, HTTPS: 2, SVCB: 3 };
  const aa = order[a] ?? 50, bb = order[b] ?? 50;
  return aa - bb || a.localeCompare(b);
}
function aggregateSlowest(items, limit = 10) {
  const groups = /* @__PURE__ */ new Map();
  for (const x of items || []) {
    const domain = String((x == null ? void 0 : x.query_name) || "—");
    const client = String((x == null ? void 0 : x.client_ip) || "—");
    const key = `${domain.toLowerCase()}\0${client}`;
    const duration2 = Number.isFinite(+(x == null ? void 0 : x.duration_ms)) ? +x.duration_ms : 0;
    const type = slowTypeLabel(x == null ? void 0 : x.query_type);
    let g = groups.get(key);
    if (!g) {
      g = { query_name: domain, client_ip: client, duration_ms: duration2, types: /* @__PURE__ */ new Map() };
      groups.set(key, g);
    }
    if (duration2 > g.duration_ms) {
      g.duration_ms = duration2;
      g.query_name = domain;
    }
    const prev = g.types.get(type);
    if (!prev || duration2 > prev.duration_ms) g.types.set(type, { type, duration_ms: duration2 });
  }
  return [...groups.values()].sort((a, b) => b.duration_ms - a.duration_ms || a.query_name.localeCompare(b.query_name)).slice(0, limit);
}
function slowTypeSummaryHtml(g, index) {
  const types = [...g.types.keys()].sort(slowTypeSort), shown = types.slice(0, 2);
  const label = shown.map(esc$1).join(" · ");
  if (types.length <= 1) return `<span class="slow-type-single">${label}</span>`;
  return `<button type="button" class="slow-type-detail-trigger" data-slow-group="${index}" aria-haspopup="dialog" title="点击查看全部类型耗时">${label}</button>`;
}
function slowTypeDetailRows(g) {
  return [...g.types.values()].sort((a, b) => b.duration_ms - a.duration_ms || slowTypeSort(a.type, b.type));
}
const OVERVIEW_SLOW_PAGE_SIZE = 10;
const OVERVIEW_DOMAIN_PAGE_SIZE = 10;
function slowPageRowsHtml(groups, page2) {
  const totalPages = Math.max(1, Math.ceil(((groups == null ? void 0 : groups.length) || 0) / OVERVIEW_SLOW_PAGE_SIZE));
  const safe2 = Math.max(0, Math.min(totalPages - 1, page2 || 0));
  const start = safe2 * OVERVIEW_SLOW_PAGE_SIZE;
  return (groups || []).slice(start, start + OVERVIEW_SLOW_PAGE_SIZE).map((g, local) => {
    const i = start + local;
    return `<tr class="slow-main-row" data-slow-group="${i}"><td>${esc$1(g.query_name)}</td><td>${slowTypeSummaryHtml(g, i)}</td><td>${esc$1(clientAliases[g.client_ip] || g.client_ip)}</td><td><span class="latency-chip ${+g.duration_ms > 500 ? "bad" : ""}">${ms(g.duration_ms)}</span></td></tr>`;
  }).join("");
}
function domainPageRowsHtml(items, page2, formatter = (x) => x.key) {
  if (!(items == null ? void 0 : items.length)) return "";
  const totalPages = Math.max(1, Math.ceil(items.length / OVERVIEW_DOMAIN_PAGE_SIZE));
  const safe2 = Math.max(0, Math.min(totalPages - 1, page2 || 0));
  const start = safe2 * OVERVIEW_DOMAIN_PAGE_SIZE;
  const max = Math.max(1, ...items.map((x) => +x.count || 0));
  return items.slice(start, start + OVERVIEW_DOMAIN_PAGE_SIZE).map((x, local) => {
    const width = Math.max(4, Math.min(100, (+x.count || 0) / max * 100));
    return `<div class="rank-row" style="--rank:${width.toFixed(2)}%"><span class="rank-meter"></span><span class="rank-index">${start + local + 1}</span><span class="rank-name" title="${esc$1(formatter(x))}">${esc$1(formatter(x))}</span><span class="rank-value">${num(x.count)}</span></div>`;
  }).join("");
}
function closeSlowTypePopover() {
  const pop = $("#slow-type-popover");
  if (pop) pop.remove();
  document.removeEventListener("click", slowTypeOutsideClick, true);
  document.removeEventListener("keydown", slowTypeKeydown, true);
}
function slowTypeOutsideClick(e) {
  const pop = $("#slow-type-popover");
  if (pop && !pop.contains(e.target) && !e.target.closest(".slow-type-detail-trigger")) closeSlowTypePopover();
}
function slowTypeKeydown(e) {
  if (e.key === "Escape") closeSlowTypePopover();
}
function openSlowTypePopover(trigger, g) {
  closeSlowTypePopover();
  const rows = slowTypeDetailRows(g);
  const pop = document.createElement("div");
  pop.id = "slow-type-popover";
  pop.className = "slow-type-popover";
  pop.setAttribute("role", "dialog");
  pop.setAttribute("aria-label", `${g.query_name} 查询类型耗时`);
  setHTML(pop, `<div class="slow-type-popover-head"><strong>类型耗时</strong><button type="button" class="slow-type-popover-close" aria-label="关闭">×</button></div><div class="slow-type-popover-list">${rows.map((x) => `<div class="slow-type-popover-row"><span>${esc$1(x.type)}</span><strong>${ms(x.duration_ms)}</strong></div>`).join("")}</div>`);
  document.body.appendChild(pop);
  pop.querySelector(".slow-type-popover-close").onclick = closeSlowTypePopover;
  const r = trigger.getBoundingClientRect(), gap = 7, pad = 12, w = Math.min(220, window.innerWidth - pad * 2);
  pop.style.width = `${w}px`;
  const ph = pop.offsetHeight;
  let left = Math.min(Math.max(pad, r.left + r.width / 2 - w / 2), window.innerWidth - w - pad), top = r.bottom + gap;
  if (top + ph > window.innerHeight - pad) top = Math.max(pad, r.top - gap - ph);
  pop.style.left = `${Math.round(left)}px`;
  pop.style.top = `${Math.round(top)}px`;
  const scope = currentScope();
  scope.listen($("#modal"), "close", closeSlowTypePopover);
  scope.timeout(() => {
    scope.listen(document, "click", slowTypeOutsideClick, { capture: true });
    scope.listen(document, "keydown", slowTypeKeydown, { capture: true });
  }, 0);
}
const OVERVIEW_DETAIL_PAGE_SIZE = 20;
function detailPagerHtml(page2, totalItems, pageSize = OVERVIEW_DETAIL_PAGE_SIZE) {
  const totalPages = Math.max(1, Math.ceil((totalItems || 0) / pageSize));
  const cur = Math.max(0, Math.min(totalPages - 1, page2 || 0));
  const pages = [];
  const start = Math.max(0, Math.min(totalPages - 5, cur - 2));
  for (let i = start; i < Math.min(totalPages, start + 5); i++) pages.push(i);
  return `<div class="overview-detail-footer"><span class="overview-detail-count">第 ${cur + 1} / ${totalPages} 页 · 共 ${num(totalItems || 0)} 条</span><div class="overview-detail-pagination"><button type="button" data-detail-page="${cur - 1}" ${cur <= 0 ? "disabled" : ""}>‹</button>${pages.map((i) => `<button type="button" data-detail-page="${i}" class="${i === cur ? "active" : ""}">${i + 1}</button>`).join("")}<button type="button" data-detail-page="${cur + 1}" ${cur >= totalPages - 1 ? "disabled" : ""}>›</button></div></div>`;
}
function slowDetailRowsHtml(groups, page2, pageSize = OVERVIEW_DETAIL_PAGE_SIZE) {
  const totalPages = Math.max(1, Math.ceil(((groups == null ? void 0 : groups.length) || 0) / pageSize));
  const safe2 = Math.max(0, Math.min(totalPages - 1, page2 || 0));
  const start = safe2 * pageSize;
  return (groups || []).slice(start, start + pageSize).map((g, local) => {
    const i = start + local;
    const types = [...g.types.keys()].sort(slowTypeSort).map(esc$1).join(" · ") || "—";
    return `<tr><td class="overview-detail-rank">${i + 1}</td><td class="overview-detail-domain" title="${esc$1(g.query_name)}">${esc$1(g.query_name)}</td><td class="overview-detail-types" title="${types}">${types}</td><td class="overview-detail-client" title="${esc$1(clientAliases[g.client_ip] || g.client_ip)}">${esc$1(clientAliases[g.client_ip] || g.client_ip)}</td><td class="overview-detail-latency"><span class="latency-chip ${+g.duration_ms > 500 ? "bad" : ""}">${ms(g.duration_ms)}</span></td></tr>`;
  }).join("");
}
function slowOverviewRowsHtml(groups, limit = state.overviewSlowLimit) {
  const shown = (groups || []).slice(0, limit);
  const maxDur = Math.max(1, ...shown.map((g) => +g.duration_ms || 0));
  return shown.map((g, index) => {
    const typeList = [...g.types.keys()].sort(slowTypeSort);
    const types = typeList.join(" · ") || "—";
    const typePills = typeList.length ? typeList.map((t) => `<span class="slow-qtype-pill mono" data-qtype="${esc$1(t)}">${esc$1(t)}</span>`).join("") : '<span class="slow-qtype-pill mono">—</span>';
    const alias = clientAliases[g.client_ip];
    const client = alias || g.client_ip || "—";
    const dur = +g.duration_ms || 0;
    const ratio = Math.max(4, Math.min(100, dur / maxDur * 100)).toFixed(1);
    const tier = (overviewInsightsService == null ? void 0 : overviewInsightsService.latencyTier) ? overviewInsightsService.latencyTier(dur) : dur > 500 ? "critical" : "fast";
    const rankCls = index < 3 ? `is-top is-top-${index + 1}` : "";
    return `<tr style="--slow-ratio:${ratio}%" data-latency-tier="${tier}"><td class="overview-slow-index"><span class="slow-rank-badge ${rankCls}">${index + 1}</span></td><td class="overview-slow-domain"><div class="slow-domain-main"><button type="button" class="workspace-text-button mono" data-slow-record="${index}" title="查看 ${esc$1(g.query_name)} 的查询日志">${esc$1(g.query_name)}</button></div><span class="overview-slow-mobile-meta">${esc$1(types)} · ${esc$1(client)}${alias && g.client_ip && alias !== g.client_ip ? ` (${esc$1(g.client_ip)})` : ""}</span></td><td class="overview-slow-type"><div class="slow-qtype-group">${typePills}</div></td><td class="overview-slow-client" title="${esc$1(g.client_ip)}"><div class="slow-client-stack"><span class="slow-client-name">${esc$1(client)}</span>${alias && g.client_ip && alias !== g.client_ip ? `<small class="slow-client-ip mono">${esc$1(g.client_ip)}</small>` : ""}</div></td><td class="overview-slow-duration"><div class="slow-duration-cell"><div class="slow-duration-bar" aria-hidden="true"><span class="slow-duration-fill tier-${tier}" style="width:${ratio}%"></span></div><span class="latency-chip tier-${tier} ${dur > 500 ? "bad" : ""}">${ms(dur)}</span></div></td></tr>`;
  }).join("") || '<tr><td colspan="5" class="table-empty">暂无查询记录，记录查询后将在这里显示耗时排行。</td></tr>';
}
function openOutcomeDetail(rows, total, otherOnly = false) {
  const content = `<p class="overview-outcome-note">当前审计保留日志的最终处理结果。主缓存命中不会展开原本的国内或国外去向；占比以本次返回分类的查询总数为基准。</p><div class="overview-outcome-detail-list">${rows.map((row) => `<button type="button" class="overview-outcome-detail-row" data-outcome-filter="${esc$1(row.key)}"><span><strong>${esc$1(row.label)}</strong><small class="mono">${esc$1(row.key || "未分类")}</small></span><span>${num(row.count)} 次<small>${total ? (row.count / total * 100).toFixed(1) : "0.0"}%</small></span></button>`).join("") || "<p>暂无分类统计。</p>"}</div>`;
  openDrawer(otherOnly ? "其他处理结果" : "全部处理结果", `当前保留日志 · ${rows.length} 类 · ${num(rows.reduce((n, row) => n + row.count, 0))} 次查询`, content);
  $$("#drawer [data-outcome-filter]").forEach((button) => button.onclick = () => {
    Object.assign(state.logs, { page: 1, q: "", exact: false, type: "", set: button.dataset.outcomeFilter, code: "", client: "" });
    closeDrawer();
    navigate("logs");
  });
}
function domainDetailRowsHtml(items, page2, pageSize = OVERVIEW_DETAIL_PAGE_SIZE) {
  const totalPages = Math.max(1, Math.ceil(((items == null ? void 0 : items.length) || 0) / pageSize));
  const safe2 = Math.max(0, Math.min(totalPages - 1, page2 || 0));
  const start = safe2 * pageSize;
  const max = Math.max(1, ...(items || []).map((x) => +x.count || 0));
  return (items || []).slice(start, start + pageSize).map((x, local) => {
    const rank = start + local + 1, count = +x.count || 0, width = Math.max(3, Math.min(100, count / max * 100));
    return `<tr><td class="overview-detail-rank">${rank}</td><td class="overview-detail-domain" title="${esc$1(x.key || "—")}">${esc$1(x.key || "—")}</td><td class="overview-detail-count-cell"><span>${num(count)}</span><i style="--detail-rank:${width.toFixed(2)}%"></i></td></tr>`;
  }).join("");
}
function openSlowDetailModal(groups) {
  let current = 0;
  const render = () => {
    const body = (groups == null ? void 0 : groups.length) ? `<div class="overview-detail-table-wrap"><table class="overview-detail-table overview-detail-slow-table"><thead><tr><th>#</th><th>域名</th><th>类型</th><th>客户端</th><th>耗时</th></tr></thead><tbody>${slowDetailRowsHtml(groups, current)}</tbody></table></div>${detailPagerHtml(current, groups.length)}` : empty("暂无最慢查询数据");
    setHTML($("#modal-content"), body);
    $$("#modal-content [data-detail-page]").forEach((btn) => btn.onclick = () => {
      const next = +btn.dataset.detailPage;
      if (Number.isFinite(next) && next !== current) {
        current = next;
        render();
        $("#modal-content").scrollTop = 0;
      }
    });
  };
  modalOpen("最慢查询详情", `每页 ${OVERVIEW_DETAIL_PAGE_SIZE} 条，整页翻页`, "", null, false);
  $("#modal").classList.add("overview-detail-modal");
  render();
}
function openDomainDetailModal(items) {
  let current = 0;
  const render = () => {
    const body = (items == null ? void 0 : items.length) ? `<div class="overview-detail-table-wrap"><table class="overview-detail-table overview-detail-domain-table"><thead><tr><th>#</th><th>域名</th><th>查询次数</th></tr></thead><tbody>${domainDetailRowsHtml(items, current)}</tbody></table></div>${detailPagerHtml(current, items.length)}` : empty("暂无域名排行数据");
    setHTML($("#modal-content"), body);
    $$("#modal-content [data-detail-page]").forEach((btn) => btn.onclick = () => {
      const next = +btn.dataset.detailPage;
      if (Number.isFinite(next) && next !== current) {
        current = next;
        render();
        $("#modal-content").scrollTop = 0;
      }
    });
  };
  modalOpen("域名排行详情", `每页 ${OVERVIEW_DETAIL_PAGE_SIZE} 条，整页翻页`, "", null, false);
  $("#modal").classList.add("overview-detail-modal");
  render();
}
const routeDefs = [
  { section: "监控", id: "overview", label: "运行概览", icon: "overview", subtitle: "实时查看 DNS 运行状态与关键指标" },
  { section: "监控", id: "logs", label: "查询日志", icon: "logs", subtitle: "搜索、筛选并分析 DNS 请求记录" },
  { section: "配置", id: "upstreams", label: "DNS管理", icon: "upstream", subtitle: "管理上游 DNS 服务器并查看请求、采纳与错误统计" },
  { section: "配置", id: "rules", label: "规则管理", icon: "rules", subtitle: "统一维护名单、广告拦截与在线分流规则" },
  { section: "配置", id: "management", label: "系统管理", icon: "management", subtitle: "功能开关、缓存与运行数据管理" },
  { section: "配置", id: "proxy-config", label: "代理配置", icon: "rules", subtitle: "管理 Mihomo / sing-box 配置，支持 HTTP 获取与保存应用" }
];
const groupName = (g) => ({ domestic: "国内", foreign: "国外", foreign_ecs: "国外 ECS", proxy: "代理" })[g] || g;
const upstreamErrorReasonLabels = {
  timeout: "Timeout",
  upstream_timeout: "Timeout",
  deadline: "Timeout",
  tls: "TLS",
  tls_handshake: "TLS",
  certificate: "TLS",
  socks5: "SOCKS5",
  socks: "SOCKS5",
  proxy: "SOCKS5",
  eof_reset: "EOF / Reset",
  eof: "EOF / Reset",
  reset: "EOF / Reset",
  broken_pipe: "EOF / Reset",
  dial_connect: "Dial / Connect",
  dial: "Dial / Connect",
  connect: "Dial / Connect",
  refused_unreachable: "Refused / Unreachable",
  refused: "Refused / Unreachable",
  unreachable: "Refused / Unreachable",
  http: "HTTP",
  protocol: "Protocol",
  unpack: "Protocol",
  other: "Other"
};
function upstreamErrorReasonName(reason) {
  return upstreamErrorReasonLabels[String(reason || "").toLowerCase()] || String(reason || "Other").replace(/_/g, " ");
}
function upstreamMetrics(metrics, group, tag) {
  const labels = { metrics_tag: group, tag };
  const q = metricFind(metrics, "localdns_upstream_query_total", labels), err = metricFind(metrics, "localdns_upstream_error_total", labels), win = metricFind(metrics, "localdns_upstream_upstream_winner_total", labels), sum = metricFind(metrics, "localdns_upstream_response_latency_millisecond_sum", labels), count = metricFind(metrics, "localdns_upstream_response_latency_millisecond_count", labels);
  const reasonMetricNames = /* @__PURE__ */ new Set(["localdns_upstream_upstream_error_reason_total"]);
  const reasonRows = metrics.filter((x) => reasonMetricNames.has(x.name) && x.labels.metrics_tag === group && x.labels.tag === tag && x.labels.reason);
  const reasonMap = {};
  reasonRows.forEach((x) => {
    const key = String(x.labels.reason || "other").toLowerCase();
    reasonMap[key] = (reasonMap[key] || 0) + (Number(x.value) || 0);
  });
  const reasons = Object.entries(reasonMap).map(([reason, value]) => ({ reason, label: upstreamErrorReasonName(reason), value })).filter((x) => x.value > 0).sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
  const lastErrorNames = ["localdns_upstream_upstream_last_error_unixtime_seconds"];
  let lastError = 0;
  for (const name of lastErrorNames) {
    lastError = metricFind(metrics, name, labels);
    if (lastError) break;
  }
  const ok = metricFind(metrics, "localdns_upstream_success_total", labels);
  return { q, err, win, latencySamples: count, latency: count ? sum / count : 0, success: ok + err ? ok / (ok + err) * 100 : null, adoption: q ? win / q * 100 : 0, reasons, lastError, reasonSupported: reasonRows.length > 0 };
}
function upstreamErrorTime(ts) {
  if (!ts) return "";
  const d = new Date(Number(ts) * 1e3);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("zh-CN", { hour12: false, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
function closeUpstreamErrorPopover() {
  const pop = $("#upstream-error-popover");
  if (pop) pop.remove();
  document.removeEventListener("click", upstreamErrorOutsideClick, true);
  document.removeEventListener("keydown", upstreamErrorKeydown, true);
}
function upstreamErrorOutsideClick(e) {
  const pop = $("#upstream-error-popover");
  if (pop && !pop.contains(e.target) && !e.target.closest(".up-error-detail-trigger")) closeUpstreamErrorPopover();
}
function upstreamErrorKeydown(e) {
  if (e.key === "Escape") closeUpstreamErrorPopover();
}
function openUpstreamErrorPopover(trigger, row) {
  closeUpstreamErrorPopover();
  const { g, u, m } = row;
  const reasonTotal = (m.reasons || []).reduce((n, x) => n + (Number(x.value) || 0), 0);
  const detail = m.reasonSupported ? m.reasons.length ? `<div class="up-error-reason-list">${m.reasons.map((x) => `<div class="up-error-reason-row"><span>${esc$1(x.label)}</span><strong>${num(x.value)}</strong></div>`).join("")}</div>` : `<div class="up-error-compat"><strong>分类计数异常</strong><span>当前错误总数大于 0，但分类计数均为 0。请检查当前二进制是否提供完整的错误分类指标。</span></div>` : `<div class="up-error-compat"><strong>等待错误分类数据</strong><span>当前错误分类指标不可用；当二进制提供分类指标后，这里会自动显示 Timeout、TLS、SOCKS5、EOF / Reset 等分类。</span></div>`;
  const totalMismatch = m.reasonSupported && reasonTotal !== Number(m.err || 0) ? `<div class="up-error-warning">分类合计 ${num(reasonTotal)} 与错误总数 ${num(m.err)} 不一致，请检查后端统计口径。</div>` : "";
  const last = m.lastError ? `<div class="up-error-meta-row"><span>最近错误</span><strong>${esc$1(upstreamErrorTime(m.lastError))}</strong></div>` : "";
  const pop = document.createElement("div");
  pop.id = "upstream-error-popover";
  pop.className = "up-error-popover";
  pop.setAttribute("role", "dialog");
  pop.setAttribute("aria-label", `${u.tag} 错误详情`);
  setHTML(pop, `<div class="up-error-popover-head"><div><strong>${esc$1(u.tag)} · 错误详情</strong><span>${esc$1(groupName(g))} · ${esc$1(u.protocol || "")}</span></div><button type="button" class="up-error-popover-close" aria-label="关闭">×</button></div>${detail}${totalMismatch}<div class="up-error-popover-meta"><div class="up-error-meta-row"><span>总计</span><strong>${num(m.err)}</strong></div>${last}</div><div class="up-error-recent"></div>`);
  document.body.appendChild(pop);
  pop.querySelector(".up-error-popover-close").onclick = closeUpstreamErrorPopover;
  const recentBox = pop.querySelector(".up-error-recent");
  if (Number(m.err || 0) > 0) api.json("/api/v1/status").then((st) => {
    const s = (st.upstream_stats || []).find((x) => x.group === g && x.tag === u.tag);
    const list = s && s.recent_errors || [];
    if (!list.length) return;
    setHTML(recentBox, `<div class="up-error-recent-title">最近错误原因</div>${list.map((x) => `<div class="up-error-recent-row"><span>${esc$1(upstreamErrorTime(x.time))}</span><em>${esc$1(x.error)}</em></div>`).join("")}`);
  }).catch(() => {
  });
  const r = trigger.getBoundingClientRect(), gap = 8, pad = 12, w = Math.min(340, window.innerWidth - pad * 2);
  pop.style.width = `${w}px`;
  const ph = pop.offsetHeight;
  let left = Math.min(Math.max(pad, r.left + r.width / 2 - w / 2), window.innerWidth - w - pad);
  let top = r.bottom + gap;
  if (top + ph > window.innerHeight - pad) top = Math.max(pad, r.top - gap - ph);
  pop.style.left = `${Math.round(left)}px`;
  pop.style.top = `${Math.round(top)}px`;
  setTimeout(() => {
    document.addEventListener("click", upstreamErrorOutsideClick, true);
    document.addEventListener("keydown", upstreamErrorKeydown, true);
  }, 0);
}
let charts = [];
function takeCharts() {
  return charts.splice(0);
}
function restoreCharts(previous) {
  charts = previous.concat(charts);
}
function destroyCharts() {
  charts.forEach((c) => {
    try {
      c.destroy();
    } catch {
    }
  });
  charts = [];
}
function chart(el, cfg) {
  if (!window.Chart || !el) return null;
  const c = new window.Chart(el, cfg);
  charts.push(c);
  return c;
}
function chartColors() {
  const css = getComputedStyle(document.documentElement);
  return { primary: css.getPropertyValue("--primary").trim(), green: css.getPropertyValue("--green").trim(), orange: css.getPropertyValue("--orange").trim(), pink: css.getPropertyValue("--pink").trim(), cyan: css.getPropertyValue("--cyan").trim(), muted: css.getPropertyValue("--muted").trim(), border: css.getPropertyValue("--border").trim(), text: css.getPropertyValue("--text-2").trim(), surface: css.getPropertyValue("--surface-2").trim() };
}
async function safeResult(fn) {
  try {
    return { ok: true, data: await fn() };
  } catch (error) {
    return { ok: false, error };
  }
}
async function safe(fn, fallback) {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}
function parseSystem(metrics) {
  var _a2, _b2, _c;
  const start = metricFind(metrics, "process_start_time_seconds");
  const info = metrics.find((x) => x.name === "localdns_runtime_info");
  const ver = metrics.find((x) => x.name === "localdns_info");
  return {
    version: ((_a2 = ver == null ? void 0 : ver.labels) == null ? void 0 : _a2.version) || "",
    platform: ((_b2 = info == null ? void 0 : info.labels) == null ? void 0 : _b2.platform) || "",
    start,
    uptime: start ? Date.now() / 1e3 - start : 0,
    cpu: metricFind(metrics, "process_cpu_seconds_total"),
    rss: metricFind(metrics, "process_resident_memory_bytes"),
    heapIdle: metricFind(metrics, "localdns_heap_free_bytes"),
    runtime: info ? `Rust ${String(((_c = info.labels) == null ? void 0 : _c.runtime) || "").replace("rust-", "")}` : "—",
    threads: metricFind(metrics, "localdns_threads"),
    goroutines: metricFind(metrics, "localdns_tasks"),
    fds: metricFind(metrics, "process_open_fds")
  };
}
function parseCaches(metrics) {
  const tags = ["cache_main", "cache_domestic", "cache_foreign", "cache_foreign_ecs"];
  return tags.map((tag) => {
    const q = metricFind(metrics, "localdns_cache_query_total", { tag }), h = metricFind(metrics, "localdns_cache_hit_total", { tag }), l = metricFind(metrics, "localdns_cache_lazy_hit_total", { tag }), size = metricFind(metrics, "localdns_cache_size_current", { tag });
    return { tag, q, h, l, size, hit: q ? h / q * 100 : 0, lazy: q ? l / q * 100 : 0 };
  });
}
function getNodeIcon(type, color = "currentColor") {
  const map = {
    monitor: `<svg viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.8" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>`,
    server: `<svg viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.8" aria-hidden="true"><rect x="3" y="4" width="18" height="6" rx="1.5"/><rect x="3" y="14" width="18" height="6" rx="1.5"/><circle cx="7" cy="7" r="1" fill="${color}"/><circle cx="7" cy="17" r="1" fill="${color}"/></svg>`,
    dots: `<svg viewBox="0 0 24 24" fill="${color}" aria-hidden="true"><circle cx="6" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="18" cy="12" r="1.6"/></svg>`,
    globe: `<svg viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.9" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3.6 9h16.8M3.6 15h16.8M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>`,
    check: `<svg viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2.2" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>`,
    split: `<svg viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.9" aria-hidden="true"><circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M8.5 6h7M6 8.5V12a6 6 0 0 0 6 6h3.5"/></svg>`,
    spark: `<svg viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.9" aria-hidden="true"><path d="m12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4L12 3Z"/></svg>`,
    shield: `<svg viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.9" aria-hidden="true"><path d="M12 3 4 7v5c0 5 3.4 9.3 8 10 4.6-.7 8-5 8-10V7l-8-4Z"/></svg>`,
    shieldRed: `<svg viewBox="0 0 24 24" fill="none" stroke="#EF4444" stroke-width="1.9" aria-hidden="true"><path d="M12 3 4 7v5c0 5 3.4 9.3 8 10 4.6-.7 8-5 8-10V7l-8-4Z"/></svg>`,
    sliders: `<svg viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.9" aria-hidden="true"><path d="M4 8h9m4 0h3M13 6v4M4 16h3m4 0h9M7 14v4"/></svg>`
  };
  return map[type] || map.monitor;
}
function drawTopoCurves(edges) {
  var _a2;
  const wrap = document.getElementById("topo-stage-wrap");
  const svg2 = document.getElementById("topo-svg");
  if (!wrap || !svg2) return;
  topologyFlowService == null ? void 0 : topologyFlowService.stop();
  const wrapRect = wrap.getBoundingClientRect();
  if (!wrapRect.width || !wrapRect.height) return;
  svg2.setAttribute("viewBox", `0 0 ${wrapRect.width} ${wrapRect.height}`);
  let pathsHtml = "", dotsHtml = "";
  const dotSet = /* @__PURE__ */ new Set();
  const addDot = (x, y, color) => {
    const key = `${Math.round(x)},${Math.round(y)}`;
    if (dotSet.has(key)) return;
    dotSet.add(key);
    dotsHtml += `<circle class="topo-dot-halo" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4" fill="${color}" /><circle class="topo-dot" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.8" fill="${color}" />`;
  };
  edges.forEach((edge, i) => {
    const fromEl = wrap.querySelector(`[data-node-id="${edge.from}"]`);
    const toEl = wrap.querySelector(`[data-node-id="${edge.to}"]`);
    if (!fromEl || !toEl) return;
    const r1 = fromEl.getBoundingClientRect(), r2 = toEl.getBoundingClientRect();
    const x1 = r1.right - wrapRect.left, y1 = r1.top + r1.height / 2 - wrapRect.top;
    const x2 = r2.left - wrapRect.left, y2 = r2.top + r2.height / 2 - wrapRect.top;
    const dx = (x2 - x1) * 0.54;
    const d = `M ${x1.toFixed(1)} ${y1.toFixed(1)} C ${(x1 + dx).toFixed(1)} ${y1.toFixed(1)}, ${(x2 - dx).toFixed(1)} ${y2.toFixed(1)}, ${x2.toFixed(1)} ${y2.toFixed(1)}`;
    if (!edge.muted) {
      pathsHtml += `<path class="topo-halo" data-edge-idx="${i}" d="${d}" stroke="${edge.color}" /><path class="topo-glow" data-edge-idx="${i}" d="${d}" stroke="${edge.color}" />`;
      pathsHtml += `<path class="topo-particle" data-part-idx="${i}" d="${d}" stroke="${edge.color}" />`;
    }
    pathsHtml += `<path class="topo-edge ${edge.muted ? "is-muted" : ""}" data-edge-idx="${i}" d="${d}" stroke="${edge.color}" />`;
    addDot(x1, y1, edge.color);
    addDot(x2, y2, edge.color);
  });
  setHTML(svg2, pathsHtml + dotsHtml);
  const nodes = wrap.querySelectorAll(".t-node");
  const applyTraceState = (startId = null) => {
    startId = state.overviewTopoLock || startId;
    const activeNodes = new Set(startId ? [startId] : []);
    const activeEdges = /* @__PURE__ */ new Set();
    for (const upstream of [true, false]) {
      const queue = startId ? [startId] : [];
      while (queue.length) {
        const cur = queue.shift();
        edges.forEach((edge, idx) => {
          if ((upstream ? edge.to : edge.from) !== cur) return;
          const next = upstream ? edge.from : edge.to;
          activeEdges.add(idx);
          if (!activeNodes.has(next)) {
            activeNodes.add(next);
            queue.push(next);
          }
        });
      }
    }
    wrap.classList.toggle("has-hover", Boolean(startId));
    nodes.forEach((n) => n.classList.toggle("is-active", activeNodes.has(n.dataset.nodeId)));
    svg2.querySelectorAll("[data-edge-idx]").forEach((el) => el.classList.toggle("is-active", activeEdges.has(+el.dataset.edgeIdx)));
    svg2.querySelectorAll("[data-part-idx]").forEach((el) => el.classList.toggle("is-active", activeEdges.has(+el.dataset.partIdx)));
  };
  const focusedId = () => {
    var _a3;
    return wrap.contains(document.activeElement) ? (_a3 = document.activeElement.closest(".t-node")) == null ? void 0 : _a3.dataset.nodeId : null;
  };
  nodes.forEach((node) => {
    node.onmouseenter = () => applyTraceState(node.dataset.nodeId);
    node.onmouseleave = () => applyTraceState(focusedId());
    node.onfocus = () => applyTraceState(node.dataset.nodeId);
    node.onblur = (event) => {
      var _a3, _b2, _c;
      return applyTraceState(((_b2 = (_a3 = event.relatedTarget) == null ? void 0 : _a3.closest(".t-node")) == null ? void 0 : _b2.dataset.nodeId) || ((_c = wrap.querySelector(".t-node:hover")) == null ? void 0 : _c.dataset.nodeId));
    };
  });
  applyTraceState(focusedId() || ((_a2 = wrap.querySelector(".t-node:hover")) == null ? void 0 : _a2.dataset.nodeId));
  topologyFlowService == null ? void 0 : topologyFlowService.start(wrap, svg2, edges);
}
const cacheName = (t) => ({ cache_main: "全部缓存", cache_domestic: "国内缓存", cache_foreign: "国外缓存", cache_foreign_ecs: "国外 ECS 缓存" })[t] || t;
function requeryHtml(s, c) {
  var _a2, _b2, _c, _d, _e;
  if (!s) return { actions: "", body: empty("Requery 插件不可用") };
  const taskState = String(s.task_state || s.status || "idle").toLowerCase();
  const running = s.running === true || ["running", "processing", "cancelling"].includes(taskState);
  const stateText = { idle: "空闲", running: "运行中", processing: "运行中", cancelling: "正在取消", failed: "运行失败", error: "运行失败" }[taskState] || (running ? "运行中" : "空闲");
  const stateClass = ["failed", "error"].includes(taskState) ? "danger" : running ? "primary" : "success";
  const pr = s.progress || {};
  const hasProgress = pr.processed !== void 0 || pr.total !== void 0;
  const lastRun = s.last_run_end_time || s.last_run_start_time || ((_a2 = s.last_run) == null ? void 0 : _a2.finished_at) || ((_b2 = s.last_run) == null ? void 0 : _b2.started_at);
  const lastCount = s.last_run_domain_count;
  const tile = (k, v) => `<div class="mg-tile"><span>${k}</span><strong>${v}</strong></div>`;
  const statusRow = `<div class="rq-status"><span class="mg-chip"><span class="mg-lab">当前状态</span><span class="badge ${stateClass}">${stateText}</span></span><span class="mg-chip"><span class="mg-lab">定时任务</span><span class="badge ${((_c = c == null ? void 0 : c.scheduler) == null ? void 0 : _c.enabled) ? "success" : ""}">${((_d = c == null ? void 0 : c.scheduler) == null ? void 0 : _d.enabled) ? "已启用" : "未启用"}</span></span></div>`;
  const actions = `<button class="button small" id="requery-scheduler" title="定时任务设置"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 8h9M18 8h2M4 16h4M13 16h7"/><circle cx="15.5" cy="8" r="2"/><circle cx="10.5" cy="16" r="2"/></svg>定时设置</button>${running ? '<button class="button small danger" id="requery-cancel">取消任务</button>' : '<button class="button small primary" id="requery-trigger" title="开始全新任务"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M7 4.5 19 12 7 19.5Z"/></svg>全新任务</button>'}`;
  const body = statusRow + `<div class="mg-tiles">${tile("进度", hasProgress ? `${num(pr.processed ?? 0)} / ${num(pr.total ?? 0)}` : "—")}${tile("上次处理域名", lastCount === void 0 || lastCount === null ? "—" : num(lastCount) + " 条")}${tile("上次运行", fmtDate(lastRun))}${tile("下次执行", fmtDate(s.next_run_time))}${tile("间隔", ((_e = c == null ? void 0 : c.scheduler) == null ? void 0 : _e.interval_minutes) ? num(c.scheduler.interval_minutes) + " 分钟" : "—")}</div>`;
  return { actions, body };
}
function openRequeryScheduler(c) {
  var _a2;
  c = c || {};
  const sc = c.scheduler || {};
  const dateDays = sc.date_range_days || ((_a2 = c.execution_settings) == null ? void 0 : _a2.date_range_days) || 30;
  let local = "";
  if (sc.start_datetime) {
    const d = new Date(sc.start_datetime);
    if (!Number.isNaN(d.getTime())) {
      const n = new Date(d.getTime() - d.getTimezoneOffset() * 6e4);
      local = n.toISOString().slice(0, 16);
    }
  }
  modalOpen("分流刷新定时任务", "定期扫描近期查询域名并刷新自动分流缓存", `<div class="stack"><label class="switch"><input id="rq-enabled" type="checkbox" ${sc.enabled ? "checked" : ""}><span class="switch-track"><span class="switch-thumb"></span></span><span class="switch-label">启用定时任务</span></label><div class="grid grid-2"><div class="field"><label>执行间隔（分钟）</label><input id="rq-interval" type="number" min="1" value="${esc$1(sc.interval_minutes || 10080)}"></div><div class="field"><label>域名刷新天数</label><input id="rq-days" type="number" min="1" value="${esc$1(dateDays)}"></div></div><div class="field"><label>首次执行时间</label><input id="rq-start" type="datetime-local" value="${esc$1(local)}"></div><p class="form-note">10080 分钟等于 7 天。首次执行时间留空且启用时，后端会以保存时刻作为调度锚点并返回真实下次执行时间。</p></div>`, async () => {
    const enabled = $("#rq-enabled").checked;
    const interval = +$("#rq-interval").value || 0;
    const days = +$("#rq-days").value || 0;
    if (enabled && interval <= 0) throw new Error("启用定时任务时，执行间隔必须大于 0");
    if (days < 1) throw new Error("域名刷新天数必须大于 0");
    const raw = $("#rq-start").value;
    const payload = { enabled, interval_minutes: interval, start_datetime: raw ? new Date(raw).toISOString() : "", date_range_days: days };
    await api.json("/plugins/requery/scheduler/config", "POST", payload);
    toast("定时任务配置已更新");
    renderRoute(true);
  });
}
function countsHtml(c) {
  var _a2;
  if (c && c.ok === false) {
    const detail = ((_a2 = c.error) == null ? void 0 : _a2.message) ? `<div class="muted" style="margin-top:8px">${esc$1(c.error.message)}</div>` : "";
    return empty("统计读取失败") + detail;
  }
  if (c && c.ok === true) c = c.data;
  if (!c) return empty("暂无统计");
  let raw = c;
  if (raw && typeof raw === "object" && !Array.isArray(raw) && Object.prototype.hasOwnProperty.call(raw, "data")) raw = raw.data;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    if (Array.isArray(raw.items)) raw = raw.items;
    else if (Array.isArray(raw.counts)) raw = raw.counts;
    else if (Array.isArray(raw.source_file_counts)) raw = raw.source_file_counts;
  }
  const entries2 = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? Object.entries(raw).map(([name, value]) => value && typeof value === "object" ? { name, ...value } : { name, count: value }) : [];
  if (!entries2.length) return empty("暂无统计");
  return `<div class="table-wrap"><table><thead><tr><th>列表</th><th>条目数</th></tr></thead><tbody>${entries2.map((x) => `<tr><td>${esc$1(x.alias || x.name || x.file || x.path || "未知")}</td><td>${num(x.count ?? x.rule_count ?? x.entries ?? x.value ?? 0)}</td></tr>`).join("")}</tbody></table></div>`;
}
async function multiPluginAction(paths, msg) {
  await Promise.all(paths.map((p) => api.request(`/plugins/${p}`)));
  toast(msg);
  renderRoute(true);
}
async function clearShuntData() {
  const warning = "确定完全清空自动分流数据？\n\n将清空：\n• 域名全集及 A/AAAA Activity\n• 自动生成的 FakeIP / RealIP / NODATA 分流记忆\n• 刷新分流缓存的历史进度与统计\n\n定时任务设置不会改变。\n清空后将从零重新收集域名并生成分流规则。";
  if (!confirm(warning)) return;
  try {
    await api.request("/plugins/requery/reset", { method: "POST" });
    toast("自动分流数据已完全清空，将从零重新收集");
    renderRoute(true);
  } catch (e) {
    toast("清空自动分流数据失败", "error", e.message);
    renderRoute(true);
  }
}
const switchProfiles = [
  { tag: "switch1", name: "请求屏蔽", desc: "对无解析结果的请求进行屏蔽" },
  { tag: "switch5", name: "类型屏蔽", desc: "屏蔽 SOA、PTR、HTTPS 等请求" },
  { tag: "switch7", name: "广告屏蔽", desc: "启用 AdGuard 在线规则" },
  { tag: "switch6", name: "IPv6 屏蔽", desc: "屏蔽 AAAA 请求类型" },
  { tag: "switch13", name: "核心缓存", desc: "启用最终结果的全部缓存" },
  { tag: "switch4", name: "过期缓存", desc: "启用国内及国外缓存的过期响应" },
  { tag: "switch2", name: "指定 Client FakeIP", desc: "只允许指定客户端科学" },
  { tag: "switch12", name: "指定 Client RealIP", desc: "指定客户端不允许科学" }
];
async function renderManagement(container, context) {
  const renderScope = context.scope, page2 = container;
  const renderSeq = state.renderSeq;
  const isCurrent = () => state.route === "management" && state.renderSeq === renderSeq;
  const tags = switchProfiles.map((x) => x.tag);
  const skeletonBlock = (height = 150) => `<div class="skeleton" style="height:${height}px;border-radius:12px"></div>`;
  setHTML(page2, `
    <div class="view-title-row">
      <div style="display:flex;align-items:baseline;gap:12px"><h1>系统管理</h1><span class="gc-sub">多级缓存池、核心功能开关与 Requery 自动分流刷新管理</span></div>
    </div>
    <div class="management-stack">
      <section class="proxy-panel-management" aria-label="代理面板设置">
        <div><h2 data-proxy-panel-name>代理面板</h2><code data-proxy-panel-address></code></div>
        <a class="button small" data-proxy-panel-link target="_blank" rel="noopener noreferrer">打开面板</a>
        <button type="button" class="button small" data-proxy-panel-settings>面板设置</button>
        <button type="button" class="button small" data-route="proxy-config">编辑配置</button>
      </section>
      <div id="management-cache-slot" style="display:contents">${card("缓存管理", skeletonBlock(130), { iconName: "data", className: "data-cache-panel" })}</div>
      <div id="management-feature-slot" style="display:contents">${card("功能开关", skeletonBlock(300), { iconName: "features", subtitle: "常用运行功能集中管理", className: "management-feature-panel" })}</div>
      <div class="management-bottom">
        <div id="management-counts-slot" style="display:contents">${card("域名列表统计", skeletonBlock(150), { iconName: "rules", subtitle: "查看自动分流列表的当前条目数", className: "data-counts-card" })}</div>
        <div id="management-requery-slot" style="display:contents">${card("刷新分流缓存", skeletonBlock(270), { iconName: "refresh", subtitle: "重新扫描域名并更新自动生成的分流列表", className: "data-requery-card" })}</div>
      </div>
      <section class="management-service-actions" aria-label="DNS 服务操作"><div><h2>DNS 服务</h2><p>管理当前 DNS 核心进程</p></div><div id="management-service-controls"></div></section>
    </div>`);
  proxyPanelService == null ? void 0 : proxyPanelService.sync();
  const switchPromise = Promise.all(tags.map((t) => safe(() => api.request(`/plugins/${t}/show`), "error"))).then((results) => Object.fromEntries(tags.map((t, i) => [t, String(results[i]).trim()])));
  const metricsPromise = api.metrics();
  const reqStatusPromise = safe(() => api.request("/plugins/requery/status"), null);
  const reqCfgPromise = safe(() => api.request("/plugins/requery/scheduler/config"), null);
  const countsPromise = safeResult(() => api.request("/plugins/requery/stats/source_file_counts"));
  switchPromise.then((status) => {
    if (!isCurrent()) return;
    const featureHtml = `<div class="feature-grid management-feature-grid">${switchProfiles.map((p) => `<div class="feature-card management-feature-card"><div><h3>${esc$1(p.name)}</h3><p>${esc$1(p.desc)}</p></div><div class="feature-footer"><span class="badge ${status[p.tag] === "A" ? "success" : ""}">${status[p.tag] === "A" ? "已启用" : "已关闭"}</span><label class="switch"><input data-switch="${p.tag}" type="checkbox" ${status[p.tag] === "A" ? "checked" : ""} ${status[p.tag] === "error" ? "disabled" : ""}><span class="switch-track"><span class="switch-thumb"></span></span></label></div></div>`).join("")}</div>`;
    const featureSlot = $("#management-feature-slot");
    if (featureSlot) setHTML(featureSlot, card("功能开关", featureHtml, { iconName: "features", subtitle: "常用运行功能集中管理", className: "management-feature-panel" }));
    $$("[data-switch]").forEach((x) => x.onchange = async () => {
      try {
        const tag = x.dataset.switch, val = x.checked ? "A" : "B";
        await api.json(`/plugins/${tag}/post`, "POST", { value: val });
        if (x.checked && (tag === "switch2" || tag === "switch12")) {
          const other = tag === "switch2" ? "switch12" : "switch2";
          await api.json(`/plugins/${other}/post`, "POST", { value: "B" });
        }
        toast("功能状态已保存");
        renderRoute(true);
      } catch (e) {
        x.checked = !x.checked;
        toast("切换失败", "error", e.message);
      }
    });
  });
  Promise.all([switchPromise, metricsPromise]).then(([status, metricsRaw]) => {
    var _a2;
    if (!isCurrent()) return;
    const metrics = parseProm(metricsRaw), caches = parseCaches(metrics);
    const cacheEnabled = String(status.switch13 || "").trim().toUpperCase() === "A";
    const activeCacheTag = "cache_main";
    const activeCacheLabel = cacheName(activeCacheTag), activeForeignTag = "cache_foreign_ecs";
    const visibleCacheTags = [activeCacheTag, "cache_domestic", "cache_foreign", activeForeignTag];
    const visibleCaches = visibleCacheTags.map((tag) => caches.find((c) => c.tag === tag)).filter(Boolean);
    const cacheCards = visibleCaches.map((c) => `<div class="cache-card cache-card-compact"><div class="cache-card-head"><h3 title="${esc$1(cacheName(c.tag))}">${cacheName(c.tag)}</h3><div class="cache-card-actions"><button class="button small cache-view" data-tag="${c.tag}">查看</button><button class="button small danger cache-clear" data-tag="${c.tag}">清空</button></div></div><div class="cache-stats cache-stats-flat"><div class="cache-stat" title="完整数值：${num(c.q)}"><span>请求总数</span><strong>${num(c.q)}</strong></div><div class="cache-stat" title="完整数值：${num(c.size)}"><span>条目数</span><strong>${num(c.size)}</strong></div><div class="cache-stat" title="完整数值：${pct(c.hit)}"><span>命中率</span><strong>${compactPct(c.hit)}</strong></div><div class="cache-stat" title="完整数值：${pct(c.lazy)}"><span>过期命中</span><strong>${compactPct(c.lazy)}</strong></div></div></div>`);
    const cacheHeaderActions = `<div class="cache-header-actions"><span class="badge success cache-active-badge">${activeCacheLabel} · ${cacheEnabled ? "当前使用" : "当前模式"}</span><span class="badge ${cacheEnabled ? "success" : "danger"}">● 核心缓存${cacheEnabled ? "已开启" : "已关闭"}</span><button class="button small danger" id="cache-clear-all">全部清空</button></div>`;
    const slot = $("#management-cache-slot");
    if (!slot) return;
    setHTML(slot, `<section class="card data-cache-panel"><div class="card-header"><div class="card-title"><span class="icon">${icon$1("data")}</span><div><h2>缓存管理</h2><p>仅显示当前模式对应的全部缓存与国外缓存，界面更紧凑</p></div></div>${cacheHeaderActions}</div><div class="card-body"><div class="cache-grid data-cache-grid">${cacheCards.join("")}</div></div></section>`);
    (_a2 = $("#cache-clear-all")) == null ? void 0 : _a2.addEventListener("click", async () => {
      if (!confirm("确定清空全部 DNS 缓存？将同时清空经典、智能、国内与国外缓存。")) return;
      const ct = caches.map((c) => c.tag);
      const result = await Promise.allSettled(ct.map((tag) => api.request(`/plugins/${tag}/flush`)));
      const failed = result.filter((x) => x.status === "rejected").length;
      failed ? toast(`已清空 ${result.length - failed} 个缓存，${failed} 个失败`, "error") : toast(`全部 ${result.length} 个缓存已清空`);
      renderRoute(true);
    });
    $$(".cache-clear").forEach((x) => x.onclick = async () => {
      if (!confirm(`确定清空 ${cacheName(x.dataset.tag)}？`)) return;
      await api.request(`/plugins/${x.dataset.tag}/flush`);
      toast("缓存已清空");
      renderRoute(true);
    });
    $$(".cache-view").forEach((x) => x.onclick = async () => {
      const text2 = await api.request(`/plugins/${x.dataset.tag}/show`);
      openDrawer(cacheName(x.dataset.tag), "缓存内容", `<pre>${esc$1(text2)}</pre>`);
    });
  }).catch((e) => {
    if (isCurrent() && $("#management-cache-slot")) setHTML($("#management-cache-slot"), card("缓存管理", `<div class="error-panel">加载失败：${esc$1(e.message)}</div>`, { iconName: "data", className: "data-cache-panel" }));
  });
  Promise.all([reqStatusPromise, reqCfgPromise]).then(([reqStatus, reqCfg]) => {
    var _a2, _b2, _c;
    if (!isCurrent()) return;
    const slot = $("#management-requery-slot");
    if (!slot) return;
    const rq = requeryHtml(reqStatus, reqCfg);
    setHTML(slot, card("刷新分流缓存", rq.body, { iconName: "refresh", subtitle: "重新扫描域名并更新自动生成的分流列表", actions: rq.actions, className: "data-requery-card" }));
    (_a2 = $("#requery-trigger")) == null ? void 0 : _a2.addEventListener("click", async () => {
      await api.request("/plugins/requery/trigger", { method: "POST" });
      toast("刷新任务已开始");
      renderRoute(true);
    });
    (_b2 = $("#requery-cancel")) == null ? void 0 : _b2.addEventListener("click", async () => {
      await api.request("/plugins/requery/cancel", { method: "POST" });
      toast("已请求取消");
      renderRoute(true);
    });
    (_c = $("#requery-scheduler")) == null ? void 0 : _c.addEventListener("click", () => openRequeryScheduler(reqCfg));
  });
  countsPromise.then((counts) => {
    var _a2, _b2;
    if (!isCurrent()) return;
    const slot = $("#management-counts-slot");
    if (!slot) return;
    setHTML(slot, card("域名列表统计", countsHtml(counts), { iconName: "rules", subtitle: "查看自动分流列表的当前条目数", actions: '<button class="button small" id="save-shunt" title="保存分流规则">保存</button><button class="button small danger" id="clear-shunt" title="清空分流规则">清空</button>', className: "data-counts-card" }));
    const countsCard = $("#management-counts-slot .data-counts-card");
    if (countsCard) {
      countsCard.style.height = "";
      countsCard.style.minHeight = "";
    }
    (_a2 = $("#save-shunt")) == null ? void 0 : _a2.addEventListener("click", () => multiPluginAction(["domain_stats/save", "realip/save", "fakeip/save", "nodata/save"], "分流规则已保存"));
    (_b2 = $("#clear-shunt")) == null ? void 0 : _b2.addEventListener("click", () => clearShuntData());
  });
}
async function restartService() {
  if (!confirm(`确定重启 ${(identityService == null ? void 0 : identityService.getName()) || "LocalDNS"}？短时间内 DNS 服务会中断。`)) return;
  const scope = currentScope();
  await api.json("/api/v1/system/restart", "POST", { delay_ms: 500 });
  if (scope.signal.aborted) return;
  toast(((identityService == null ? void 0 : identityService.getName()) || "LocalDNS") + " 正在重启");
  scope.timeout(() => renderRoute(true), 4e3);
}
const cpuSample = { total: null, at: null };
async function renderOverview(container, context) {
  var _a2, _b2;
  const renderScope = context.scope, page2 = container;
  trafficClientService.start(renderScope);
  await renderScope.guard(loadAliases(renderScope).catch(() => {
  }));
  const switchTags = ["switch1", "switch5", "switch7", "switch6", "switch13", "switch4", "switch2", "switch12"];
  const [stats, domains, clients, slowest, sets, metricsRaw, engineStatus, upCfg, switchVals] = await renderScope.guard(Promise.all([
    api.stats(),
    api.rank("domain", 1e3),
    api.rank("client", 1e3),
    api.rank("slowest", 1e3),
    api.rank("domain_set", 64),
    api.metrics(),
    safe(() => api.request("/api/v1/status"), {}),
    safe(() => api.request("/api/v1/upstream/config"), {}),
    Promise.all(switchTags.map((t) => safe(() => api.request(`/plugins/${t}/show`), "B")))
  ]));
  const sw = Object.fromEntries(switchTags.map((t, i) => [t, String(switchVals[i] || "").trim().toUpperCase()]));
  const enabledCount = Object.values(sw).filter((v) => v === "A").length;
  const metrics = parseProm(metricsRaw), sys = parseSystem(metrics), caches = parseCaches(metrics);
  if (sys.version && $("#brand-version-tag")) $("#brand-version-tag").dataset.backendVersion = sys.version;
  if (sys.version && $("#brand-version-tag") && (document.documentElement.dataset.brandVerMode || "version") === "version") $("#brand-version-tag").textContent = sys.version;
  if ($("#float-stat-top")) $("#float-stat-top").textContent = `↑ 累计 ${compactNum(stats.total_queries)} 次`;
  if ($("#float-stat-bot")) $("#float-stat-bot").textContent = `↓ ${ms(stats.average_duration_ms)}`;
  const cacheDisabled = sw.switch13 === "B";
  const lazyEnabled = sw.switch4 === "A";
  const cMain = caches.find((x) => x.tag === "cache_main") || { hit: 0, lazy: 0, q: 0, h: 0, size: 0 };
  const cDom = caches.find((x) => x.tag === "cache_domestic") || { hit: 0, lazy: 0, q: 0, h: 0, size: 0 };
  const cFor = caches.find((x) => x.tag === "cache_foreign") || { hit: 0, lazy: 0, q: 0, h: 0, size: 0 };
  const cEcs = caches.find((x) => x.tag === "cache_foreign_ecs") || { hit: 0, lazy: 0, q: 0, h: 0, size: 0 };
  const totalCacheQ = caches.reduce((s, c) => s + (c.q || 0), 0);
  const totalCacheH = caches.reduce((s, c) => s + (c.h || 0), 0);
  const overallHitRate = cMain.q > 0 ? cMain.hit : totalCacheQ > 0 ? totalCacheH / totalCacheQ * 100 : 0;
  const cacheValue = cacheDisabled ? "已关闭" : pct(overallHitRate);
  const now = Date.now();
  let cpuPct = sys.uptime > 0 ? Math.max(0, sys.cpu / sys.uptime * 100) : 0;
  if (cpuSample.total != null && cpuSample.at != null && sys.cpu >= cpuSample.total && now > cpuSample.at) {
    cpuPct = Math.max(0, (sys.cpu - cpuSample.total) / ((now - cpuSample.at) / 1e3) * 100);
  }
  cpuSample.total = sys.cpu;
  cpuSample.at = now;
  const adguardBlocked = Math.max(0, +((_a2 = engineStatus == null ? void 0 : engineStatus.stats) == null ? void 0 : _a2.adguard_blocked) || 0);
  const clientCount = Number.isFinite(+(stats == null ? void 0 : stats.client_count)) ? fullNum(+stats.client_count) : rankCount(clients);
  const domainCount = Number.isFinite(+(stats == null ? void 0 : stats.domain_count)) ? fullNum(+stats.domain_count) : rankCount(domains);
  shellInterfaceService == null ? void 0 : shellInterfaceService.recordMetrics({ total: (_b2 = metrics.find((x) => x.name === "localdns_queries_total")) == null ? void 0 : _b2.value, latency: stats.average_duration_ms, cache: overallHitRate, cacheEnabled: !cacheDisabled, clients: stats.client_count ?? clients.length, domains: stats.domain_count ?? domains.length, blocked: adguardBlocked, start: sys.start });
  const outcomes = overviewInsightsService.distribution(sets);
  const allSets = outcomes.all;
  const ds = outcomes.shown;
  const slowGroups = aggregateSlowest(slowest, Infinity);
  const clientMode = sw.switch2 === "A" ? "fakeip" : sw.switch12 === "A" ? "realip" : "all";
  const totalQ = Math.max(1, +stats.total_queries || 0);
  const topoClients = clientsService.topology(clients, clientAliases, stats.total_queries, compactNum);
  const isClaude = document.documentElement.dataset.skin === "claude";
  const rRules = (engineStatus == null ? void 0 : engineStatus.rules) || {};
  const eStats = (engineStatus == null ? void 0 : engineStatus.stats) || {};
  const topoRules = [
    { id: "r1", tab: "diversion", name: "geosite_cn", sub: `国内大陆域名直连 · ${num(rRules.geosite_cn || 0)} 条规则`, val: compactNum(eStats.domestic || 0), iconColor: isClaude ? "#2D6A4F" : "#10B981", icon: "globe" },
    { id: "r2", tab: "lists", name: "whitelist / custom_cn", sub: `白名单与自定义国内 · ${num(rRules.force_domestic || 0)} 条规则`, val: `${num(rRules.force_domestic || 0)} 条`, iconColor: isClaude ? "#C96442" : "#60A5FA", icon: "check" },
    { id: "r3", tab: "diversion", name: "geosite_non_cn", sub: `海外无污染分流 · ${num(rRules.geosite_non_cn || 0)} 条规则`, val: compactNum((+eStats.foreign || 0) + (+eStats.foreign_ecs || 0)), iconColor: isClaude ? "#3D6B66" : "#14B8A6", icon: "split" },
    { id: "r4", tab: "lists", name: "force_fakeip / 灰名单", sub: `FakeIP 分流映射 · ${num(rRules.force_foreign_fakeip || 0)} 条规则`, val: compactNum(eStats.fakeip || 0), iconColor: isClaude ? "#B45309" : "#F59E0B", icon: "spark" },
    { id: "r5", tab: "adguard", name: "adguard_block", sub: `广告与追踪器拦截 · ${num((engineStatus == null ? void 0 : engineStatus.adguard_rules) || 0)} 条规则`, val: compactNum(adguardBlocked), iconColor: isClaude ? "#B91C1C" : "#EF4444", icon: "shield" },
    { id: "r6", tab: "lists", name: "block / 特殊类型清洗", sub: `黑名单与类型抑制 · ${num(rRules.block || 0)} 条规则`, val: compactNum(eStats.blocked || 0), iconColor: isClaude ? "#857F74" : "#94A3B8", icon: "sliders" }
  ];
  const groupUpstreams = {};
  ["domestic", "foreign", "foreign_ecs", "proxy"].forEach((g) => {
    const list = ((upCfg == null ? void 0 : upCfg[g]) || []).map((u) => ({ g, u, m: upstreamMetrics(metrics, g, u.tag) }));
    groupUpstreams[g] = list;
  });
  const groupAvgMs = (g) => {
    const active2 = (groupUpstreams[g] || []).filter((x) => x.u.enabled !== false && x.m.latency > 0);
    if (!active2.length) return "就绪";
    const avg = active2.reduce((s, x) => s + x.m.latency, 0) / active2.length;
    return `${avg.toFixed(1)} ms`;
  };
  const topoGroups = [
    { id: "g1", code: "CN", codeColor: isClaude ? "#2D6A4F" : "#34D399", codeBg: isClaude ? "rgba(45,106,79,0.12)" : "rgba(16,185,129,0.14)", name: "国内组 (domestic)", sub: `并发竞速 · ${groupAvgMs("domestic")} · ${num(eStats.domestic || 0)} 次` },
    { id: "g2", code: "GL", codeColor: isClaude ? "#3D6B66" : "#2DD4BF", codeBg: isClaude ? "rgba(61,107,102,0.12)" : "rgba(20,184,166,0.14)", name: "国外组 (foreign)", sub: `无污染解析 · ${groupAvgMs("foreign")} · ${num(eStats.foreign || 0)} 次` },
    { id: "g3", code: "ECS", codeColor: isClaude ? "#C96442" : "#93C5FD", codeBg: isClaude ? "rgba(201,100,66,0.12)" : "rgba(59,130,246,0.16)", name: "国外 ECS (foreign_ecs)", sub: `EDNS 子网 · ${groupAvgMs("foreign_ecs")} · ${num(eStats.foreign_ecs || 0)} 次` },
    { id: "g4", code: "PX", codeColor: isClaude ? "#B45309" : "#FBBF24", codeBg: isClaude ? "rgba(180,83,9,0.12)" : "rgba(245,158,11,0.15)", name: "代理组 (proxy)", sub: `远端解析 · ${groupAvgMs("proxy")} · ${num(eStats.fakeip || 0)} 次` },
    { id: "g5", code: "BLK", codeColor: isClaude ? "#B91C1C" : "#F87171", codeBg: isClaude ? "rgba(185,28,28,0.12)" : "rgba(239,68,68,0.15)", name: "本地拦截黑洞", sub: `0.0.0.0 / NXDOMAIN · ${num(eStats.blocked || 0)} 拦截` }
  ];
  const allRealUps = [
    ...groupUpstreams.domestic || [],
    ...groupUpstreams.foreign || [],
    ...groupUpstreams.foreign_ecs || [],
    ...groupUpstreams.proxy || []
  ].sort((a, b) => Number(b.u.enabled !== false) - Number(a.u.enabled !== false) || b.m.win - a.m.win);
  const pickedUps = [];
  const pickFrom = (g, count) => {
    const candidates = (groupUpstreams[g] || []).slice().sort((a, b) => Number(b.u.enabled !== false) - Number(a.u.enabled !== false) || b.m.win - a.m.win);
    candidates.slice(0, count).forEach((x) => {
      if (pickedUps.length < 5) pickedUps.push(x);
    });
  };
  pickFrom("domestic", 2);
  pickFrom("foreign", 1);
  pickFrom("foreign_ecs", 1);
  pickFrom("proxy", 1);
  allRealUps.forEach((x) => {
    if (pickedUps.length < 5 && !pickedUps.includes(x)) pickedUps.push(x);
  });
  const groupToNodeId = { domestic: "g1", foreign: "g2", foreign_ecs: "g3", proxy: "g4" };
  const topoServers = pickedUps.map((item, idx) => {
    const { g, u, m } = item;
    const latTxt = m.latency > 0 ? `${m.latency.toFixed(1)} ms` : u.enabled !== false ? "在线" : "未启用";
    const badgeTxt = m.q > 0 ? `${Math.round(m.adoption)}% 采纳` : (u.protocol || "UDP").toUpperCase();
    const colorMap = isClaude ? {
      domestic: ["#2D6A4F", "rgba(45,106,79,0.12)"],
      foreign: ["#3D6B66", "rgba(61,107,102,0.12)"],
      foreign_ecs: ["#C96442", "rgba(201,100,66,0.12)"],
      proxy: ["#B45309", "rgba(180,83,9,0.12)"]
    } : {
      domestic: ["#34D399", "rgba(16,185,129,0.15)"],
      foreign: ["#2DD4BF", "rgba(20,184,166,0.15)"],
      foreign_ecs: ["#93C5FD", "rgba(59,130,246,0.16)"],
      proxy: ["#FBBF24", "rgba(245,158,11,0.16)"]
    };
    const [badgeColor, badgeBg] = colorMap[g] || ["#CBD5E1", "rgba(148,163,184,0.14)"];
    return {
      id: `s${idx + 1}`,
      groupNode: groupToNodeId[g] || "g1",
      name: u.tag || `Upstream-${idx + 1}`,
      sub: `${u.addr || u.server_addr || "—"} · ${latTxt}`,
      badge: badgeTxt,
      badgeColor,
      badgeBg,
      icon: "server",
      muted: u.enabled === false
    };
  });
  topoServers.push({
    id: "s6",
    groupNode: "g5",
    name: "拦截直接响应",
    sub: "零上游消耗 · 立即阻断",
    badge: `${compactNum(eStats.blocked || 0)} 阻断`,
    badgeColor: isClaude ? "#B91C1C" : "#F87171",
    badgeBg: isClaude ? "rgba(185,28,28,0.12)" : "rgba(239,68,68,0.16)",
    icon: "shieldRed"
  });
  const cPrimary = isClaude ? "#C96442" : "#3B82F6";
  const cTeal = isClaude ? "#2D6A4F" : "#14B8A6";
  const cAmber = isClaude ? "#B45309" : "#F59E0B";
  const cGreen = isClaude ? "#2D6A4F" : "#10B981";
  const topoEdges = [
    ...topoClients.filter((c) => !c.muted).map((c) => [c.id, "e_core", cPrimary]),
    ["e_core", "r1", cTeal],
    ["e_core", "r2", cPrimary],
    ["e_core", "r3", cTeal],
    ["e_core", "r4", cAmber],
    ["e_core", "r5", cTeal],
    ["e_core", "r6", cTeal],
    ["r1", "g1", cTeal],
    ["r2", "g1", cTeal],
    ["r3", "g2", cTeal],
    ["r3", "g3", cPrimary],
    ["r4", "g4", cAmber],
    ["r5", "g5", cTeal],
    ["r6", "g5", cTeal],
    ...topoServers.map((s) => [s.groupNode, s.id, cGreen])
  ].map(([from, to, color]) => {
    var _a3, _b3;
    return {
      from,
      to,
      color,
      muted: Boolean(((_a3 = topoClients.find((c) => c.id === from)) == null ? void 0 : _a3.muted) || ((_b3 = topoServers.find((s) => s.id === to)) == null ? void 0 : _b3.muted))
    };
  });
  const dsTotal = Math.max(1, outcomes.total);
  const outcomeColor = (key) => overviewInsightsService.color(key, isClaude ? "claude" : "glass");
  let dashOffset = 25;
  const ringCircles = ds.map((x) => {
    const pctVal = Math.max(0, Math.min(100, (+x.count || 0) / dsTotal * 100));
    const circle = `<circle cx="21" cy="21" r="15.915" fill="transparent" stroke="${outcomeColor(x.key)}" stroke-width="4.8" stroke-dasharray="${pctVal.toFixed(4)} ${(100 - pctVal).toFixed(4)}" stroke-dashoffset="${dashOffset.toFixed(4)}"></circle>`;
    dashOffset -= pctVal;
    return circle;
  }).join("");
  const rankTab = state.overviewRankTab || "client";
  const rankItems = (rankTab === "client" ? clients || [] : domains || []).slice(0, 4);
  const rankMax = Math.max(1, ...rankItems.map((x) => +x.count || 0));
  setHTML(page2, `
      <div class="view-title-row">
        <div style="display:flex;align-items:baseline;gap:12px">
          <h1>运行概览</h1>
          <span class="mono" style="font-size:12px;color:var(--text-3)">${esc$1([sys.version || (engineStatus == null ? void 0 : engineStatus.version) || "FJG20", sys.platform, sys.runtime !== "—" ? sys.runtime : ""].filter(Boolean).join(" · "))}</span>
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          <button type="button" class="glass-btn" id="btn-overview-custom-bg">自定义壁纸与玻璃</button>
        </div>
      </div>

      <section class="console-service-summary" aria-labelledby="service-summary-title">
        <div class="console-service-row">
          <div class="console-service-health">
            <span class="service-health-mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="10"/><path data-service-check d="m7 12 3 3 7-7"/></svg></span>
            <div class="service-health-copy">
              <div class="service-health-title"><h2 id="service-summary-title">DNS 服务运行中</h2><span class="service-connection">已连接</span></div>
              <p class="service-build mono">${esc$1([sys.version || (engineStatus == null ? void 0 : engineStatus.version) || "FJG20", sys.platform, sys.runtime !== "—" ? sys.runtime : ""].filter(Boolean).join(" · "))}</p>
            </div>
          </div>
          <div class="service-metric" data-service-metric="start"><div class="service-metric-label"><span>启动时间</span>${icon$1("clock")}</div><div class="service-value service-start-value">${startTimeMarkup(sys.start)}</div></div>
          <div class="service-metric" data-service-metric="uptime"><div class="service-metric-label"><span>运行时长</span>${icon$1("uptime")}</div><div class="service-value service-uptime-value">${sys.start ? overviewUptimeMarkup(sys.uptime) : "—"}</div></div>
          <div class="service-metric" data-service-metric="cpu"><div class="service-metric-label"><span>进程 CPU</span>${icon$1("cpu")}</div><div class="service-value" data-display-number>${metrics.some((m) => m.name === "process_cpu_seconds_total") ? cpuPct.toFixed(1) + "%" : "—"}</div></div>
          <div class="service-metric" data-service-metric="memory"><div class="service-metric-label"><span>内存占用</span>${icon$1("memory")}</div><div class="service-value" data-display-number>${metrics.some((m) => m.name === "process_resident_memory_bytes") ? fmtBytesBrief(sys.rss) : "—"}</div></div>
        </div>
      </section>

      <!-- 第一层：3 张等宽快捷控制条 (4 + 4 + 4 = 12列)，100% 绑定 LocalDNS 真实功能 -->
      <div class="col-4">
        <div class="glass-card control-bar-card">
          <div class="cb-label">
            <svg viewBox="0 0 24 24" fill="none" stroke="#60A5FA" stroke-width="2" aria-hidden="true"><path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/></svg>
            <span>客户端分流</span>
          </div>
          <div class="cb-right">
            <div class="seg-group" role="group" aria-label="客户端分流策略">
              <button type="button" class="seg-item ${clientMode === "all" ? "active" : ""}" data-client-mode="all" title="所有客户端均按分流规则正常解析">全员分流</button>
              <button type="button" class="seg-item ${clientMode === "fakeip" ? "active" : ""}" data-client-mode="fakeip" title="switch2：只允许指定客户端科学">指定 FakeIP</button>
              <button type="button" class="seg-item ${clientMode === "realip" ? "active" : ""}" data-client-mode="realip" title="switch12：指定客户端不允许科学">指定 RealIP</button>
            </div>
            <button type="button" class="glass-btn" id="manage-alias">别名</button>
          </div>
        </div>
      </div>

      <div class="col-4">
        <div class="glass-card control-bar-card">
          <div class="cb-label">
            <svg viewBox="0 0 24 24" fill="none" stroke="#10B981" stroke-width="2" aria-hidden="true"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
            <span>缓存与过期</span>
          </div>
          <div class="cb-right">
            <div class="seg-group" role="group" aria-label="缓存功能开关">
              <button type="button" class="seg-item ${!cacheDisabled ? "active" : ""}" id="btn-toggle-switch13" title="点击切换核心缓存 (switch13)">核心缓存 ${!cacheDisabled ? "开" : "关"}</button>
              <button type="button" class="seg-item ${lazyEnabled ? "active" : ""}" id="btn-toggle-switch4" title="点击切换乐观过期缓存 (switch4)">过期缓存 ${lazyEnabled ? "开" : "关"}</button>
            </div>
            <button type="button" class="glass-btn" id="btn-flush-all-cache">清空</button>
          </div>
        </div>
      </div>

      <div class="col-4">
        <div class="glass-card control-bar-card">
          <div class="cb-label">
            <span class="dot-online" aria-hidden="true"></span>
            <span style="color:var(--text-1);font-weight:600">运行中 · ${duration(sys.uptime)}</span>
          </div>
          <div class="cb-right">
            <button type="button" class="glass-btn" id="btn-toggle-switch7" title="点击切换 AdGuard 广告屏蔽 (switch7)">AdGuard ${sw.switch7 === "A" ? "已开启" : "已关闭"}</button>
            <span style="font-size:12px;color:var(--text-2);cursor:pointer" data-route="management">${enabledCount}/8 项开启 ›</span>
          </div>
        </div>
      </div>

      <!-- 第二层：6 张等宽微趋势指标卡 (2 × 6 = 12列)，100% 对应 LocalDNS 6 大真实指标 -->
      <div class="col-2">
        <div class="glass-card spark-kpi-card" data-route="logs">
          <div class="sk-top"><span class="sk-title">累计请求</span><svg viewBox="0 0 24 24" fill="none" stroke="#3B82F6" stroke-width="2" aria-hidden="true"><path d="M12 3v14m0 0-4-4m4 4 4-4M4 21h16"/></svg></div>
          <div class="sk-bottom">
            <div class="sk-val tabular">${num(stats.total_queries)}</div>
            <svg class="sk-chart" viewBox="0 0 100 34" fill="none" aria-hidden="true"></svg>
          </div>
          <div class="sk-note">${cacheDisabled ? "缓存已关闭" : "缓存命中占 " + pct(overallHitRate)}</div>
        </div>
      </div>

      <div class="col-2">
        <div class="glass-card spark-kpi-card" data-route="management">
          <div class="sk-top"><span class="sk-title">缓存命中</span><svg viewBox="0 0 24 24" fill="none" stroke="#F59E0B" stroke-width="2" aria-hidden="true"><path d="M12 21V7m0 0-4 4m4-4 4 4M4 3h16"/></svg></div>
          <div class="sk-bottom">
            <div class="sk-val tabular">${cacheValue}</div>
            <svg class="sk-chart" viewBox="0 0 100 34" fill="none" aria-hidden="true"></svg>
          </div>
          <div class="sk-note">${caches.filter((c) => (+c.q || 0) > 0).length} 个活跃缓存池</div>
        </div>
      </div>

      <div class="col-2">
        <div class="glass-card spark-kpi-card" id="kpi-card-clients">
          <div class="sk-top"><span class="sk-title">客户端数</span><svg viewBox="0 0 24 24" fill="none" stroke="#14B8A6" stroke-width="2" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg></div>
          <div class="sk-bottom">
            <div class="sk-val tabular">${clientCount}</div>
            <svg class="sk-chart" viewBox="0 0 100 34" fill="none" aria-hidden="true"></svg>
          </div>
          <div class="sk-note">活跃来源 IP</div>
        </div>
      </div>

      <div class="col-2">
        <div class="glass-card spark-kpi-card" data-route="rules">
          <div class="sk-top"><span class="sk-title">拦截请求</span><svg viewBox="0 0 24 24" fill="none" stroke="#EF4444" stroke-width="2" aria-hidden="true"><path d="M12 3 4 7v5c0 5 3.4 9.3 8 10 4.6-.7 8-5 8-10V7l-8-4Z"/></svg></div>
          <div class="sk-bottom">
            <div class="sk-val tabular">${fullNum(adguardBlocked)}</div>
            <svg class="sk-chart" viewBox="0 0 100 34" fill="none" aria-hidden="true"></svg>
          </div>
          <div class="sk-note">${pct(totalQ > 0 ? adguardBlocked / totalQ * 100 : 0)} 的请求被拦截</div>
        </div>
      </div>

      <div class="col-2">
        <div class="glass-card spark-kpi-card" data-route="upstreams">
          <div class="sk-top"><span class="sk-title">平均响应</span><svg viewBox="0 0 24 24" fill="none" stroke="#60A5FA" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg></div>
          <div class="sk-bottom">
            <div class="sk-val tabular" style="color:#F59E0B">${ms(stats.average_duration_ms)}</div>
            <svg class="sk-chart" viewBox="0 0 100 34" fill="none" aria-hidden="true"></svg>
          </div>
          <div class="sk-note">当前浏览器会话采样</div>
        </div>
      </div>

      <div class="col-2">
        <div class="glass-card spark-kpi-card" id="kpi-card-domains">
          <div class="sk-top"><span class="sk-title">域名统计</span><svg viewBox="0 0 24 24" fill="none" stroke="#10B981" stroke-width="2" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/></svg></div>
          <div class="sk-bottom">
            <div class="sk-val tabular">${domainCount}</div>
            <svg class="sk-chart" viewBox="0 0 100 34" fill="none" aria-hidden="true"></svg>
          </div>
          <div class="sk-note">去重域名数</div>
        </div>
      </div>

      <!-- 第三层：UI 2026.10.16.1 的五阶段 DNS 解析路径布局 -->
      <div class="col-12">
        <section class="glass-card topology-glass-card" aria-label="实时 DNS 解析与分流全链路拓扑" title="流光仅示意拓扑路径，不代表单条 DNS 查询记录">
          <div class="topo-stage-wrap ${state.particles === false ? "no-particles" : ""} ${state.particleMotionOverride ? "motion-override" : ""}" id="topo-stage-wrap">
            <svg class="topo-svg-overlay" id="topo-svg" aria-hidden="true"></svg>

            <div class="topo-grid">
              <div class="topo-col" data-col="1">
                <div class="topo-col-title"><span>01</span>客户端来源</div>
                <div class="topo-col-body">
                  ${topoClients.map((c) => `
                    <div class="t-node" data-node-id="${c.id}" data-client-ip="${esc$1(c.ip)}">
                      <div class="tn-left">
                        <div class="tn-icon-box">${getNodeIcon(c.icon, "#94A3B8")}</div>
                        <div class="tn-meta">
                          <div class="tn-name">${esc$1(c.name)}</div>
                          <div class="tn-sub">${esc$1(c.sub)}</div>
                        </div>
                      </div>
                      <span class="tn-val" style="color:${c.valColor}">${esc$1(c.val)}</span>
                    </div>
                  `).join("")}
                </div>
              </div>

              <div class="topo-col" data-col="2">
                <div class="topo-col-title"><span>02</span>引擎与多级缓存</div>
                <div class="topo-col-body">
                  <div class="t-node t-engine-card" data-node-id="e_core" data-route="management">
                    <div>
                      <div class="tec-top">
                        <span class="tec-big tabular">${cacheDisabled ? "—" : overallHitRate.toFixed(1) + "%"}</span>
                        <span class="tec-badge">${compactNum(stats.total_queries)} 请求</span>
                      </div>
                      <div class="tec-desc">多级内存缓存命中 · ${cacheDisabled ? "核心缓存已关闭" : "4 个活跃缓存池"}</div>
                    </div>

                    <div class="tec-bars">
                      <div class="tec-bar-row">
                        <span class="tec-bar-name">主缓存</span>
                        <div class="tec-bar-track"><div class="tec-bar-fill" style="width:${Math.max(4, cMain.hit)}%"></div></div>
                        <span class="tec-bar-pct">${cMain.hit.toFixed(1)}%</span>
                      </div>
                      <div class="tec-bar-row">
                        <span class="tec-bar-name">国内池</span>
                        <div class="tec-bar-track"><div class="tec-bar-fill" style="width:${Math.max(4, cDom.hit)}%"></div></div>
                        <span class="tec-bar-pct">${cDom.hit.toFixed(1)}%</span>
                      </div>
                      <div class="tec-bar-row">
                        <span class="tec-bar-name">国外池</span>
                        <div class="tec-bar-track"><div class="tec-bar-fill" style="width:${Math.max(4, cFor.hit)}%"></div></div>
                        <span class="tec-bar-pct">${cFor.hit.toFixed(1)}%</span>
                      </div>
                      <div class="tec-bar-row">
                        <span class="tec-bar-name">ECS 池</span>
                        <div class="tec-bar-track"><div class="tec-bar-fill" style="width:${Math.max(4, cEcs.hit)}%"></div></div>
                        <span class="tec-bar-pct">${cEcs.hit.toFixed(1)}%</span>
                      </div>
                      <div class="tec-bar-row">
                        <span class="tec-bar-name">乐观过期</span>
                        <div class="tec-bar-track"><div class="tec-bar-fill" style="width:${Math.max(4, Math.max(cMain.lazy, cDom.lazy))}%;background:#F59E0B"></div></div>
                        <span class="tec-bar-pct">${Math.max(cMain.lazy, cDom.lazy).toFixed(1)}%</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div class="topo-col" data-col="3">
                <div class="topo-col-title"><span>03</span>分流规则集</div>
                <div class="topo-col-body">
                  ${topoRules.map((r) => `
                    <div class="t-node" data-node-id="${r.id}" data-rule-jump="${r.tab}">
                      <div class="tn-left">
                        <div class="tn-icon-box">${getNodeIcon(r.icon, r.iconColor)}</div>
                        <div class="tn-meta">
                          <div class="tn-name">${esc$1(r.name)}</div>
                          <div class="tn-sub">${esc$1(r.sub)}</div>
                        </div>
                      </div>
                      <span class="tn-val">${esc$1(r.val)}</span>
                    </div>
                  `).join("")}
                </div>
              </div>

              <div class="topo-col" data-col="4">
                <div class="topo-col-title"><span>04</span>上游策略组</div>
                <div class="topo-col-body">
                  ${topoGroups.map((g) => `
                    <div class="t-node" data-node-id="${g.id}" data-route="upstreams">
                      <div class="tn-left">
                        <div class="tn-icon-box" style="color:${g.codeColor};background:${g.codeBg};border-color:${g.codeColor}33">${esc$1(g.code)}</div>
                        <div class="tn-meta">
                          <div class="tn-name">${esc$1(g.name)}</div>
                          <div class="tn-sub">${esc$1(g.sub)}</div>
                        </div>
                      </div>
                    </div>
                  `).join("")}
                </div>
              </div>

              <div class="topo-col" data-col="5">
                <div class="topo-col-title"><span>05</span>上游 DNS 节点</div>
                <div class="topo-col-body">
                  ${topoServers.map((s) => `
                    <div class="t-node" data-node-id="${s.id}" data-route="upstreams">
                      <div class="tn-left">
                        <div class="tn-icon-box">${getNodeIcon(s.icon, "#94A3B8")}</div>
                        <div class="tn-meta">
                          <div class="tn-name">${esc$1(s.name)}</div>
                          <div class="tn-sub">${esc$1(s.sub)}</div>
                        </div>
                      </div>
                      <span class="tn-pill" style="color:${s.badgeColor};background:${s.badgeBg}">${esc$1(s.badge)}</span>
                    </div>
                  `).join("")}
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>

      <!-- 第四层：8列系统运行体征与实时流量趋势 + 4列分流结果占比 = 12列 -->
      <div class="col-8">
        <div class="glass-card">
          <div class="gc-head">
            <div class="gc-title">服务运行体征与查询吞吐监控</div>
            <div style="display:flex;gap:8px;align-items:center">
              <span class="tn-pill" style="color:#93C5FD;background:rgba(59,130,246,0.16)">启动于 ${startTimeMarkup(sys.start)}</span>
              <span class="tn-pill" style="color:#34D399;background:rgba(16,185,129,0.15)">在线 ${duration(sys.uptime)}</span>
            </div>
          </div>
          <div class="traffic-chart-body">
            <div class="console-chart-empty">正在积累趋势数据…</div>
            <div class="tc-metrics-side">
              <div class="tcm-row"><span>国内直连</span><strong>${num(eStats.domestic || 0)}</strong></div>
              <div class="tcm-row"><span>国外无污染</span><strong>${num((+eStats.foreign || 0) + (+eStats.foreign_ecs || 0))}</strong></div>
              <div class="tcm-row"><span>FakeIP 映射</span><strong>${num(eStats.fakeip || 0)}</strong></div>
              <div class="tcm-row"><span>平均耗时</span><strong>${ms(stats.average_duration_ms)}</strong></div>
            </div>
          </div>
        </div>
      </div>

      <div class="col-4">
        <div class="glass-card">
          <div class="gc-head">
            <div><div class="gc-title">查询处理结果占比</div><p class="workspace-subline">当前保留日志 · 最终处理结果</p></div>
            <button type="button" class="glass-btn" id="outcome-detail-button">全部 ${allSets.length} 类</button>
          </div>
          <div class="outbound-donut-body">
            <div class="ring-wrap">
              <svg viewBox="0 0 42 42" width="124" height="124" aria-hidden="true">
                <circle cx="21" cy="21" r="15.915" fill="transparent" stroke="rgba(148,163,184,0.14)" stroke-width="4.8"></circle>
                ${ringCircles}
              </svg>
              <div class="ring-center" title="${fullNum(outcomes.total)} 次查询">${compactNum(outcomes.total)}</div>
            </div>
            <div class="ring-legend">
              ${ds.map((x, i) => {
    const p = ((+x.count || 0) / dsTotal * 100).toFixed(1);
    return `<button type="button" class="rl-item outcome-item" data-outcome-index="${i}" title="${x.members ? `展开其余 ${x.members.length} 类` : `${esc$1(x.key || "未分类")} · 点击查看查询日志`}">
                  <span class="rl-name"><i class="rl-dot" style="background:${outcomeColor(x.key)}"></i>${esc$1(x.label)}${x.members ? `<small>（${x.members.length} 类）</small>` : ""}</span>
                  <span class="mono" style="color:var(--text-2);text-align:right">${compactNum(x.count)}</span>
                  <span class="mono" style="color:var(--text-3);text-align:right">${p}%</span>
                </button>`;
  }).join("") || `<div style="color:var(--text-3);font-size:12px">暂无分流分类统计</div>`}
            </div>
          </div>
          <p class="overview-outcome-note">按查询次数排列；缓存命中不展开原始分流去向。${allSets.length >= 64 ? "接口最多读取 64 类，当前占比仅覆盖已返回分类。" : ""}</p>
        </div>
      </div>

      <div class="col-12 workspace-rankings">
        ${workspaceService.rankings({ domains: domains || [], clients: clients || [], sets: sets || [], total: stats.total_queries, aliases: clientAliases })}
      </div>

      <div class="col-12 overview-cache-panel">
        <div class="glass-card">
          <div class="gc-head">
            <div>
              <div class="gc-title-row">
                <div class="gc-title">多级缓存池状态</div>
                <span class="cache-status-pill ${cacheDisabled ? "is-off" : "is-on"}">${cacheDisabled ? "● 核心缓存已关闭" : "● 核心缓存运行中"}</span>
                <span class="cache-status-pill ${lazyEnabled ? "is-lazy" : "is-muted"}">乐观过期 ${lazyEnabled ? "开启" : "关闭"}</span>
              </div>
              <p class="workspace-subline cache-panel-subline">4 级独立缓存池实时命中率、请求量与驻留条目数 · 综合命中率 ${pct(overallHitRate)}</p>
            </div>
            <div class="cache-head-actions">
              <span class="gc-sub" style="cursor:pointer" data-route="management">缓存管理 ›</span>
            </div>
          </div>
          <div class="overview-cache-pools">
            ${[
    ["全部缓存 (cache_main)", "cache_main", cMain],
    ["国内缓存 (cache_domestic)", "cache_domestic", cDom],
    ["国外缓存 (cache_foreign)", "cache_foreign", cFor],
    ["国外 ECS (cache_foreign_ecs)", "cache_foreign_ecs", cEcs]
  ].map(([label, tag, c]) => {
    const info = (overviewInsightsService == null ? void 0 : overviewInsightsService.poolInfo) ? overviewInsightsService.poolInfo(tag) : { code: "POOL", shortLabel: label, sub: tag, tone: "main" };
    const hitClamped = Math.max(0, Math.min(100, +c.hit || 0));
    const lazyVal = Math.max(0, +c.lazy || 0);
    return `
              <div class="u-row-bar overview-cache-pool" data-pool-tag="${esc$1(tag)}" data-pool-tone="${esc$1(info.tone)}">
                <div class="cache-pool-body">
                  <div class="urb-head">
                    <span class="cache-pool-title-wrap" style="color:var(--text-1)">
                      <span class="cache-pool-code mono">${esc$1(info.code)}</span>
                      <span class="cache-pool-titles">
                        <strong class="cache-pool-short">${esc$1(info.shortLabel)}</strong>
                        <small class="cache-pool-sub">${esc$1(info.sub)}</small>
                      </span>
                    </span>
                    <span class="cache-pool-rate-wrap" style="color:var(--text-2)" aria-label="命中率 ${c.hit.toFixed(1)}%">
                      <span class="cache-pool-hit-num tabular">${c.hit.toFixed(1)}%</span> <small class="cache-pool-hit-unit" style="font-size:11px">命中率</small>
                      <span class="cache-pool-lazy-tag tabular" title="乐观过期缓存命中率 ${lazyVal.toFixed(1)}%">过期 ${lazyVal.toFixed(1)}%</span>
                    </span>
                  </div>
                  <div class="urb-track" aria-hidden="true"><div class="urb-fill" style="width:${hitClamped.toFixed(1)}%"></div></div>
                  <dl class="overview-cache-facts"><div><dt>查询数</dt><dd>${num(c.q)}</dd></div><div><dt>命中数</dt><dd>${num(c.h)}</dd></div><div><dt>缓存条目</dt><dd>${num(c.size)}</dd></div></dl>
                  <div class="cache-pool-foot">
                    <span class="cache-pool-tag-mono mono">${esc$1(tag)}</span>
                    <div class="cache-pool-actions">
                      <button type="button" class="cache-pool-btn" data-overview-cache-view="${esc$1(tag)}" title="查看 ${esc$1(info.shortLabel)} 内容">查看</button>
                      <button type="button" class="cache-pool-btn is-danger" data-overview-cache-flush="${esc$1(tag)}" title="清空 ${esc$1(info.shortLabel)}">清空</button>
                    </div>
                  </div>
                </div>
              </div>`;
  }).join("")}
          </div>
          <p class="overview-outcome-note">命中率 = 命中数 ÷ 本池查询数；条目数为当前值。查询与命中计数来自核心运行指标，统计周期与审计日志不同。</p>
        </div>
      </div>

      <div class="col-12 overview-slow-panel">
        <div class="glass-card">
          <div class="gc-head">
            <div><div class="gc-title">慢查询排行</div><p class="workspace-subline">当前保留日志中耗时最高的最多 1,000 条样本 · 按域名与客户端合并，取最大耗时</p></div>
            <div class="overview-slow-tools"><label for="overview-slow-limit">显示条数</label><select id="overview-slow-limit">${[5, 10, 20].map((n) => `<option value="${n}" ${state.overviewSlowLimit === n ? "selected" : ""}>${n} 条</option>`).join("")}</select><button type="button" class="glass-btn" id="slow-detail-button">详情</button></div>
          </div>
          <div class="overview-slow-table-wrap" tabindex="0" role="region" aria-label="慢查询列表，可滚动查看更多记录"><table class="overview-slow-table"><thead><tr><th scope="col">序号</th><th scope="col">域名</th><th scope="col">查询类型</th><th scope="col">客户端</th><th scope="col">最大耗时</th></tr></thead><tbody id="overview-slow-rows">${slowOverviewRowsHtml(slowGroups)}</tbody></table></div>
          <p class="overview-outcome-note" id="overview-slow-count">显示 ${Math.min(state.overviewSlowLimit, slowGroups.length)} / ${slowGroups.length} 组 · 点击域名查看对应查询日志</p>
        </div>
      </div>
    `);
  const topologyWrap = $("#topo-stage-wrap");
  const redraw = () => {
    if ((topologyWrap == null ? void 0 : topologyWrap.isConnected) && $("#topo-stage-wrap") === topologyWrap) drawTopoCurves(topoEdges);
  };
  requestAnimationFrame(() => requestAnimationFrame(redraw));
  const onResize = () => requestAnimationFrame(redraw);
  window.addEventListener("resize", onResize, { passive: true });
  window.addEventListener("localdns:layoutchange", onResize);
  trackRouteCleanup(() => {
    window.removeEventListener("resize", onResize);
    window.removeEventListener("localdns:layoutchange", onResize);
  });
  $$("[data-client-ip]", page2).forEach((el) => {
    el.onclick = () => {
      const ip = el.dataset.clientIp;
      if (ip) {
        state.logs.client = ip;
        state.logs.page = 1;
      }
      navigate("logs");
    };
  });
  $$("[data-rule-jump]", page2).forEach((el) => {
    el.onclick = async () => {
      const tab = el.dataset.ruleJump;
      await navigate("rules");
      if (state.route !== "rules") return;
      const btn = $(`[data-rule-tab="${tab}"]`);
      if (btn) btn.click();
    };
  });
  if ($("#btn-overview-custom-bg")) {
    $("#btn-overview-custom-bg").onclick = (e) => {
      var _a3;
      e.stopPropagation();
      (_a3 = $("#btn-open-bg-customizer")) == null ? void 0 : _a3.click();
    };
  }
  $$("[data-client-mode]", page2).forEach((btn) => {
    btn.onclick = async () => {
      const m = btn.dataset.clientMode;
      try {
        if (m === "all") {
          await Promise.all([
            api.json("/plugins/switch2/post", "POST", { value: "B" }),
            api.json("/plugins/switch12/post", "POST", { value: "B" })
          ]);
          toast("已切换为全员分流模式");
        } else if (m === "fakeip") {
          await api.json("/plugins/switch2/post", "POST", { value: "A" });
          await api.json("/plugins/switch12/post", "POST", { value: "B" });
          toast("已启用：指定 Client FakeIP");
        } else if (m === "realip") {
          await api.json("/plugins/switch12/post", "POST", { value: "A" });
          await api.json("/plugins/switch2/post", "POST", { value: "B" });
          toast("已启用：指定 Client RealIP");
        }
        renderRoute(true, true);
      } catch (e) {
        toast("切换失败", "error", e.message);
      }
    };
  });
  const bindSwitchBtn = (sel, tag, curVal, label) => {
    const el = $(sel);
    if (!el) return;
    el.onclick = async () => {
      const nextVal = curVal === "A" ? "B" : "A";
      try {
        await api.json(`/plugins/${tag}/post`, "POST", { value: nextVal });
        toast(`${label}已${nextVal === "A" ? "开启" : "关闭"}`);
        renderRoute(true, true);
      } catch (e) {
        toast("操作失败", "error", e.message);
      }
    };
  };
  bindSwitchBtn("#btn-toggle-switch13", "switch13", sw.switch13, "核心缓存");
  bindSwitchBtn("#btn-toggle-switch4", "switch4", sw.switch4, "乐观过期缓存");
  bindSwitchBtn("#btn-toggle-switch7", "switch7", sw.switch7, "AdGuard 广告拦截");
  if ($("#btn-flush-all-cache")) {
    $("#btn-flush-all-cache").onclick = async () => {
      if (!confirm("确定清空全部 DNS 缓存？将同时清空全部、国内、国外与国外 ECS 缓存。")) return;
      const ct = ["cache_main", "cache_domestic", "cache_foreign", "cache_foreign_ecs"];
      await Promise.allSettled(ct.map((t) => api.request(`/plugins/${t}/flush`)));
      toast("全部 4 个 DNS 缓存池已清空");
      renderRoute(true, true);
    };
  }
  workspaceService.bindRanks(page2, { domains: domains || [], clients: clients || [], sets: sets || [], aliases: clientAliases });
  $$("[data-rank-tab]", page2).forEach((btn) => {
    btn.onclick = () => {
      state.overviewRankTab = btn.dataset.rankTab;
      renderRoute(true, true);
    };
  });
  $$("[data-overview-cache-view]", page2).forEach((btn) => {
    btn.onclick = async () => {
      const tag = btn.dataset.overviewCacheView;
      try {
        const text2 = await api.request(`/plugins/${tag}/show`);
        openDrawer(cacheName(tag), "缓存内容", `<pre>${esc$1(text2)}</pre>`);
      } catch (e) {
        toast("查看缓存失败", "error", e.message);
      }
    };
  });
  $$("[data-overview-cache-flush]", page2).forEach((btn) => {
    btn.onclick = async () => {
      const tag = btn.dataset.overviewCacheFlush;
      if (!confirm(`确定清空 ${cacheName(tag)}？`)) return;
      try {
        await api.request(`/plugins/${tag}/flush`);
        toast(`${cacheName(tag)}已清空`);
        renderRoute(true, true);
      } catch (e) {
        toast("清空缓存失败", "error", e.message);
      }
    };
  });
  if ($("#manage-alias")) $("#manage-alias").onclick = openAliasModal;
  if ($("#kpi-card-clients")) $("#kpi-card-clients").onclick = openAliasModal;
  if ($("#kpi-card-domains")) $("#kpi-card-domains").onclick = () => openDomainDetailModal(domains || []);
  if ($("#domain-detail-button")) {
    $("#domain-detail-button").onclick = () => {
      if ((state.overviewRankTab || "client") === "client") openAliasModal();
      else openDomainDetailModal(domains || []);
    };
  }
  if ($("#slow-detail-button")) $("#slow-detail-button").onclick = () => openSlowDetailModal(slowGroups);
  const bindSlowRows = () => $$("[data-slow-record]", page2).forEach((button) => button.onclick = () => {
    const row = slowGroups[Number(button.dataset.slowRecord)];
    Object.assign(state.logs, { page: 1, q: row.query_name, exact: true, type: "", set: "", code: "", client: row.client_ip });
    navigate("logs");
  });
  bindSlowRows();
  $("#overview-slow-limit").onchange = (event) => {
    const limit = Number(event.target.value);
    if (![5, 10, 20].includes(limit)) return;
    state.overviewSlowLimit = limit;
    storage.set("localdns-overview-slow-limit:" + (API_BASE || location.host), limit);
    setHTML($("#overview-slow-rows"), slowOverviewRowsHtml(slowGroups));
    $("#overview-slow-count").textContent = `显示 ${Math.min(limit, slowGroups.length)} / ${slowGroups.length} 组 · 点击域名查看对应查询日志`;
    bindSlowRows();
  };
  $("#outcome-detail-button").onclick = () => openOutcomeDetail(allSets, outcomes.total);
  $$("[data-outcome-index]", page2).forEach((button) => button.onclick = () => {
    const row = ds[Number(button.dataset.outcomeIndex)];
    if (row.members) return openOutcomeDetail(row.members, outcomes.total, true);
    Object.assign(state.logs, { page: 1, q: "", exact: false, type: "", set: row.key, code: "", client: "" });
    navigate("logs");
  });
  workspaceService.topology(page2, redraw, sets);
}
const overviewRoute = { mount(container, context) {
  return renderOverview(container, context);
} };
function logViewModel(record2, aliases = {}) {
  const type = String(record2.query_type || "").toUpperCase();
  return {
    record: record2,
    time: fmtDate(record2.query_time),
    mobileTime: new Date(record2.query_time).toLocaleTimeString("zh-CN", { hour12: false }),
    domain: String(record2.query_name || ""),
    type,
    queryType: String(record2.query_type || ""),
    shortType: { AAAA: "6", A: "A", CNAME: "C", PTR: "P", HTTPS: "H", TXT: "T", MX: "M", NS: "N", SRV: "S" }[type] || type[0] || "?",
    blocked: /黑|BAN|BLOCK|拒绝|拦截/i.test(String(record2.domain_set || "")),
    answer: (record2.answers || []).map((answer) => (answer == null ? void 0 : answer.data) || (answer == null ? void 0 : answer.value)).filter(Boolean).join(", ") || record2.response_code || "—",
    set: record2.domain_set,
    duration: record2.duration_ms,
    client: String(record2.client_ip || ""),
    clientLabel: aliases[record2.client_ip] || record2.client_ip,
    code: record2.response_code,
    success: record2.response_code === "NOERROR"
  };
}
async function readLogs(query, aliases, scope) {
  const data = await scope.guard(api.logs(logQueryParams(query)));
  return { ...data, records: data.logs, rows: data.logs.map((record2) => logViewModel(record2, aliases)) };
}
function auditDirectory(value) {
  const directory = value.trim();
  if (!directory) throw new Error("请填写日志目录，例如 logs 或 /var/log/localdns。");
  if ([...directory].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) throw new Error("目录不能包含换行或控制字符。");
  if (directory.includes("\\") || /^[a-z]:/i.test(directory) || /^[a-z]+:\/\//i.test(directory)) {
    throw new Error("请填写 VM 上的 Linux 目录，例如 /var/log/localdns。");
  }
  return directory;
}
function auditStorage(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError("日志存储信息格式无效。", 0, null, "contract");
  }
  const data = value;
  if (typeof data.dir !== "string" || !data.dir.trim() || typeof data.path !== "string" || !data.path.startsWith("/") || typeof data.memory_fs !== "boolean") {
    throw new ApiError("日志存储目录信息不完整。", 0, null, "contract");
  }
  for (const key of ["capacity", "entries", "memory_bytes", "disk_bytes"]) {
    if (typeof data[key] !== "number" || !Number.isFinite(data[key]) || Number(data[key]) < 0) {
      throw new ApiError("日志存储统计格式无效。", 0, null, "contract");
    }
  }
  return data;
}
async function readAuditStorage(request2) {
  try {
    return auditStorage(await request2("/api/v1/audit/settings"));
  } catch (error) {
    if (error instanceof ApiError && [404, 405, 501].includes(error.status)) return null;
    throw error;
  }
}
function storageDetails(value) {
  const mb = (bytes) => `${(bytes / 1048576).toFixed(2)} MB`;
  return `<dl class="audit-storage-details"><div><dt>当前实际位置</dt><dd>${esc$1(value.path)}</dd></div><div><dt>存储占用</dt><dd>内存 ${mb(value.memory_bytes)} · 磁盘 ${mb(value.disk_bytes)} · ${num(value.entries)} 条</dd></div></dl>
    ${value.memory_fs ? '<p class="audit-storage-warning">当前目录位于内存盘（tmpfs），请改用磁盘目录以减少内存占用。</p>' : ""}`;
}
async function openAuditModal() {
  var _a2;
  const scope = currentScope();
  let status, capacity, storage2 = null, storageError = null;
  try {
    [status, capacity] = await Promise.all([api.status(), api.capacity()]);
    try {
      storage2 = await readAuditStorage((path) => api.request(path));
    } catch (error) {
      storageError = error;
    }
  } catch (error) {
    if (!scope.signal.aborted) toast("审计控制读取失败", "error", error.message);
    return;
  }
  if (scope.signal.aborted) return;
  modalOpen("审计控制", "管理 DNS 查询日志的记录状态、容量与存放位置", `
    <div class="audit-settings">
      <div class="kv-list"><div class="kv-row"><span class="kv-key">当前状态</span><span class="kv-value"><span class="badge ${status.capturing ? "success" : "danger"}">${status.capturing ? "运行中" : "已停止"}</span></span></div></div>
      <div class="field"><label for="audit-cap">日志容量 <span class="settings-compact-note">最多保留的查询记录数</span></label>
        <div class="settings-refresh-row audit-settings-row"><input id="audit-cap" type="number" min="100" max="1000000" step="1" required value="${capacity.capacity}"><button type="button" class="button primary" id="audit-cap-save">保存容量</button></div></div>
      ${storage2 ? `<div class="field"><label for="audit-dir">日志存储位置</label>
        <div class="settings-refresh-row audit-settings-row"><input id="audit-dir" type="text" value="${esc$1(storage2.dir)}" placeholder="logs 或 /var/log/localdns" autocomplete="off" spellcheck="false" required aria-describedby="audit-dir-help audit-dir-behavior"><button type="button" class="button primary" id="audit-dir-save">保存目录</button></div>
        <p class="form-note" id="audit-dir-help">填写 VM 上的目录。相对路径基于 LocalDNS 安装目录，也支持 /var/log/localdns 等绝对路径。</p>
        <div id="audit-storage-details">${storageDetails(storage2)}</div>
        <p class="form-note" id="audit-dir-behavior">最新 2,000 条记录留在内存，其余压缩写入磁盘。重启服务后查询记录清空，目录设置保留。切换目录也会清空当前记录，旧文件留在原目录。</p></div>` : `<div class="audit-storage-unavailable"><p>${storageError ? "日志存储信息读取失败。可以重试，容量与审计开关仍可使用。" : "当前内核不支持自定义日志目录，升级到支持此功能的内核后即可设置。"}</p>${storageError ? '<button type="button" class="button small" id="audit-storage-retry">重新读取</button>' : ""}</div>`}
      <p class="audit-settings-feedback" id="audit-settings-feedback" role="status" aria-live="polite" hidden></p>
      <div class="grid grid-2 audit-settings-actions"><button type="button" class="button ${status.capturing ? "danger" : "success"}" id="modal-audit-toggle">${status.capturing ? "关闭审计" : "开启审计"}</button><button type="button" class="button danger" id="modal-audit-clear">清空日志</button></div>
    </div>`, null, false);
  const dialog2 = $("#modal");
  const feedback = $("#audit-settings-feedback");
  const active2 = () => !scope.signal.aborted && dialog2.open && feedback.isConnected;
  let refreshOnClose = false;
  dialog2.addEventListener("close", () => {
    if (refreshOnClose && !scope.signal.aborted && feedback.isConnected) renderRoute(true);
  }, { once: true });
  function message(text2, error = false) {
    feedback.hidden = false;
    feedback.textContent = text2;
    feedback.classList.toggle("is-error", error);
    feedback.setAttribute("role", error ? "alert" : "status");
  }
  async function perform(button, label, task) {
    const controls = $$("button, input", $("#modal-content"));
    const states = controls.map((control) => control.disabled);
    const original = button.textContent;
    controls.forEach((control) => {
      control.disabled = true;
    });
    button.textContent = label;
    feedback.hidden = true;
    try {
      await task();
    } catch (error) {
      if (active2()) message(error.message, true);
    } finally {
      controls.forEach((control, i) => {
        control.disabled = states[i];
      });
      button.textContent = original;
    }
  }
  $("#audit-cap-save").onclick = (event) => {
    const input = $("#audit-cap");
    if (!input.reportValidity()) return;
    const value = Number(input.value);
    if (!Number.isInteger(value) || value < 100 || value > 1e6) {
      message("日志容量应为 100 到 1,000,000 之间的整数。", true);
      return;
    }
    if (value < capacity.capacity && !confirm("降低日志容量可能移除较早的查询记录。确定保存容量？")) return;
    return perform(event.currentTarget, "保存中…", async () => {
      await api.json("/api/v1/audit/capacity", "POST", { capacity: value });
      if (!active2()) return;
      capacity = { capacity: value };
      refreshOnClose = true;
      if (storage2) {
        try {
          storage2 = await readAuditStorage((path) => api.request(path));
          if (active2() && storage2) setHTML($("#audit-storage-details"), storageDetails(storage2));
        } catch {
          message("容量已保存，存储统计刷新失败。请重新打开审计控制查看。", true);
          return;
        }
      }
      if (active2()) message("日志容量已保存。");
    });
  };
  if (storage2) $("#audit-dir-save").onclick = (event) => {
    let directory;
    try {
      directory = auditDirectory($("#audit-dir").value);
    } catch (error) {
      message(error.message, true);
      $("#audit-dir").focus();
      return;
    }
    if (directory === storage2.dir) {
      message("日志目录未变更。");
      return;
    }
    if (!confirm("切换日志目录会清空当前查询记录，旧压缩文件留在原目录。确定保存目录？")) return;
    return perform(event.currentTarget, "保存中…", async () => {
      const result = await api.json("/api/v1/audit/settings", "POST", { dir: directory });
      if (!active2()) return;
      try {
        storage2 = auditStorage(result);
      } catch {
        message("服务器已接受保存请求，但返回信息无效。请重新打开审计控制确认当前目录。", true);
        return;
      }
      $("#audit-dir").value = storage2.dir;
      setHTML($("#audit-storage-details"), storageDetails(storage2));
      message("日志目录已保存，当前查询记录已清空。");
      refreshOnClose = true;
    });
  };
  (_a2 = $("#audit-storage-retry")) == null ? void 0 : _a2.addEventListener("click", () => {
    modalClose();
    openAuditModal();
  });
  $("#modal-audit-toggle").onclick = (event) => perform(event.currentTarget, "更新中…", async () => {
    await api.request(`/api/v1/audit/${status.capturing ? "stop" : "start"}`, { method: "POST" });
    if (!active2()) return;
    toast("审计状态已更新");
    modalClose();
    renderRoute(true);
  });
  $("#modal-audit-clear").onclick = (event) => {
    if (!confirm("确定清空所有查询日志？此操作无法撤销。")) return;
    return perform(event.currentTarget, "清空中…", async () => {
      await api.request("/api/v1/audit/clear", { method: "POST" });
      if (!active2()) return;
      toast("日志已清空");
      modalClose();
      renderRoute(true);
    });
  };
}
function logBadge(set) {
  const s = String(set || "未分类");
  let cls = "primary";
  if (/黑|BAN|BLOCK|拒绝/i.test(s)) cls = "danger";
  else if (/白|直连|国内|REAL/i.test(s)) cls = "success";
  else if (/灰|代理|订阅/i.test(s)) cls = "pink";
  else if (/FAKE/i.test(s)) cls = "cyan";
  return `<span class="badge ${cls}" title="${esc$1(s)}">${esc$1(overviewInsightsService.label(s))}</span>`;
}
function logRow(view) {
  return `<tr data-log='${esc$1(JSON.stringify(view.record))}'><td title="${esc$1(view.time)}"><span class="log-time-full">${view.time}</span><span class="log-time-mobile">${esc$1(view.mobileTime)}</span></td><td class="td-domain" data-qtype="${esc$1(view.type)}" data-qtype-short="${esc$1(view.shortType)}" data-blocked="${view.blocked ? 1 : 0}"><strong class="copyable" role="button" tabindex="0" data-copy="${esc$1(view.domain)}" title="点击复制域名">${esc$1(view.domain)}</strong><div style="color:var(--muted);font-size:11px;max-width:360px;overflow:hidden;text-overflow:ellipsis">${esc$1(view.answer)}</div></td><td>${esc$1(view.queryType)}</td><td>${logBadge(view.set)}</td><td>${ms(view.duration)}</td><td><span class="copyable value-chip" role="button" tabindex="0" data-copy="${esc$1(view.client)}" title="点击复制客户端 IP">${esc$1(view.clientLabel)}</span></td><td><span class="badge ${view.success ? "success" : "danger"}">${esc$1(view.code)}</span></td><td><button class="icon-button row-action log-detail" type="button" aria-label="查看查询详情" title="查看详情"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6Z"/><circle cx="12" cy="12" r="2.6"/></svg></button></td></tr>`;
}
async function renderLogs(container, context) {
  var _a2, _b2, _c;
  const renderScope = context.scope, page2 = container;
  const p = state.logs;
  await loadAliases(renderScope);
  const data = await readLogs(p, clientAliases, renderScope);
  const rows = data.rows, filters = data.filters;
  const topPager = `<div class="logs-top-pagination">${paginationHtml(data.pagination)}</div>`;
  const choices = (items, selected) => [...new Set([...items || [], selected].filter(Boolean))].sort();
  const options = (items, value, label) => `<option value="">${label}</option>${choices(items, value).map((v) => `<option value="${esc$1(v)}" ${v === value ? "selected" : ""}>${esc$1(v)}</option>`).join("")}`;
  setHTML(page2, `<div class="view-title-row"><div><h1>查询日志</h1></div><div class="workspace-actions"><button type="button" class="glass-btn" id="log-pause" aria-pressed="${!!state.logsPaused}">${state.logsPaused ? "继续刷新" : "暂停刷新"}</button><button type="button" class="glass-btn" id="audit-control">审计控制</button><button type="button" class="glass-btn" id="alias-control">客户端管理</button></div></div>
    ${card("查询与过滤", `<div class="log-filter-bar"><div class="lf-search"><span class="search-icon">${icon$1("search")}</span><input id="log-q" value="${esc$1(p.q)}" placeholder="域名、IP、响应值" aria-label="搜索查询"></div><select id="log-type" aria-label="请求类型">${options(filters.query_types, p.type, "全部类型")}</select><select id="log-set" aria-label="分流结果">${options(filters.domain_sets, p.set, "全部分流")}</select><button type="button" class="lf-more" id="lf-more" aria-expanded="${!!(p.code || p.client || p.exact)}" aria-controls="log-filter-more">更多筛选</button><button type="button" class="lf-reset" id="lf-reset">重置</button><button type="button" class="button primary" id="log-search">查询</button></div><div class="log-filter-more" id="log-filter-more" ${p.code || p.client || p.exact ? "" : "hidden"}><div class="field"><label for="log-code">响应码</label><select id="log-code">${options(filters.response_codes, p.code, "全部响应码")}</select></div><div class="field"><label for="log-client">客户端</label><input id="log-client" value="${esc$1(p.client)}" placeholder="客户端 IP"></div><label class="switch"><input id="log-exact" type="checkbox" ${p.exact ? "checked" : ""}><span class="switch-track"><span class="switch-thumb"></span></span><span class="switch-label">精确匹配</span></label></div>${workspaceService.logTools(p)}`, { iconName: "logs" })}
    ${card("DNS 请求记录", `${topPager}<div class="table-wrap"><table class="workspace-log-table"><thead><tr><th>时间</th><th>域名 / 响应</th><th>类型</th><th>分流</th><th>耗时</th><th>客户端</th><th>状态</th><th>操作</th></tr></thead><tbody>${rows.length ? rows.map(logRow).join("") : '<tr><td colspan="8" class="table-empty">没有符合条件的记录</td></tr>'}</tbody></table></div>${paginationHtml(data.pagination)}`, { iconName: "logs", subtitle: `共 ${num(((_a2 = data.pagination) == null ? void 0 : _a2.total_items) || 0)} 条 · 第 ${num(((_b2 = data.pagination) == null ? void 0 : _b2.current_page) || 1)} / ${num(((_c = data.pagination) == null ? void 0 : _c.total_pages) || 1)} 页` })}`);
  $("#log-search").onclick = () => {
    Object.assign(p, { page: 1, q: $("#log-q").value.trim(), type: $("#log-type").value, set: $("#log-set").value, code: $("#log-code").value, client: $("#log-client").value.trim(), exact: $("#log-exact").checked });
    renderRoute(true);
  };
  $("#log-q").onkeydown = (e) => {
    if (e.key === "Enter") $("#log-search").click();
  };
  $("#lf-more").onclick = () => {
    const box = $("#log-filter-more");
    box.hidden = !box.hidden;
    $("#lf-more").setAttribute("aria-expanded", String(!box.hidden));
  };
  $("#lf-reset").onclick = () => {
    Object.assign(p, { page: 1, q: "", type: "", set: "", code: "", client: "", exact: false });
    renderRoute(true);
  };
  $$(".log-detail", page2).forEach((b) => b.onclick = () => openLogPath(JSON.parse(b.closest("tr").dataset.log)));
  $$(".pagination button[data-page]", page2).forEach((b) => b.onclick = () => {
    p.page = +b.dataset.page;
    renderRoute(true);
  });
  $("#audit-control").onclick = openAuditModal;
  $("#alias-control").onclick = openAliasModal;
  workspaceService.bindLogs(page2, data.records);
}
function openLogPath(record2) {
  openDrawer("解析路径", record2.query_name, logDetailHtml(record2));
  queryPathService.bind($("#drawer-content"), record2, clientAliases);
}
function paginationHtml(p) {
  if (!p || p.total_pages <= 1) return "";
  const cur = p.current_page, total = p.total_pages;
  let arr = [];
  for (let i = Math.max(1, cur - 2); i <= Math.min(total, cur + 2); i++) arr.push(i);
  return `<div class="pagination"><button data-page="${cur - 1}" ${cur <= 1 ? "disabled" : ""}>‹</button>${arr.map((i) => `<button data-page="${i}" class="${i === cur ? "active" : ""}">${i}</button>`).join("")}<button data-page="${cur + 1}" ${cur >= total ? "disabled" : ""}>›</button></div>`;
}
function logDetailHtml(record2) {
  return queryPathService.html(record2, clientAliases);
}
const logsRoute = { mount(container, context) {
  return renderLogs(container, context);
} };
async function readUpstreams(scope) {
  const [config, tags, rawMetrics, ecs] = await scope.guard(Promise.all([
    api.request("/api/v1/upstream/config"),
    api.request("/api/v1/upstream/tags"),
    api.metrics(),
    api.request("/api/v1/upstream/ecs")
  ]));
  const groups = Array.isArray(tags) ? tags : Object.keys(config);
  const metrics = parseProm(rawMetrics), rows = [];
  groups.forEach((group) => (config[group] || []).forEach((upstream, index) => {
    rows.push({ g: group, u: upstream, i: index, m: upstreamMetrics(metrics, group, upstream.tag) });
  }));
  rows.sort((a, b) => Number(b.u.enabled !== false) - Number(a.u.enabled !== false));
  return { config, ecs: typeof (ecs == null ? void 0 : ecs.ecs) === "string" ? ecs.ecs : "", groups, rows };
}
function writeUpstreamGroup(group, candidate, ecs) {
  const body = { plugin_tag: group, upstreams: candidate || [] };
  if (group === "foreign_ecs" && typeof ecs === "string") body.ecs = ecs;
  return api.json("/api/v1/upstream/config", "POST", body);
}
async function renderUpstreams(container, context) {
  const renderScope = context.scope, page2 = container;
  const { config, ecs, groups, rows } = await readUpstreams(renderScope);
  const model = { config, ecs };
  setHTML(page2, `<div class="view-title-row"><div><h1>DNS 管理</h1></div><button type="button" class="glass-btn primary" id="up-add">添加上游节点</button></div><div class="col-12">${workspaceService.upstreams(rows, groups)}</div>`);
  $$(".up-toggle", page2).forEach((x) => x.onchange = () => toggleUpstream(x.closest("tr"), x.checked));
  $$(".up-edit", page2).forEach((x) => x.onclick = () => openUpstreamModal(x.closest("tr")));
  $$(".up-delete", page2).forEach((x) => x.onclick = () => deleteUpstream(x.closest("tr")));
  $$(".up-error-detail-trigger", page2).forEach((x) => x.onclick = (e) => {
    e.stopPropagation();
    const row = rows.find((r) => r.g === x.dataset.group && String(r.i) === x.dataset.index);
    if (row) openUpstreamErrorPopover(x, row);
  });
  $$(".workspace-upstream-group .table-wrap", page2).forEach((w) => w.addEventListener("scroll", closeUpstreamErrorPopover, { passive: true }));
  $("#up-add").onclick = () => openUpstreamModal();
  async function saveUpstreamCandidate(group, candidate, ecs2) {
    return renderScope.guard(writeUpstreamGroup(group, candidate, ecs2));
  }
  async function saveUpstreamGroup(group) {
    return saveUpstreamCandidate(group, model.config[group] || []);
  }
  async function toggleUpstream(row, enabled) {
    const g = row.dataset.group, i = +row.dataset.index, old = model.config[g][i].enabled;
    model.config[g][i].enabled = enabled;
    try {
      await saveUpstreamGroup(g);
      toast("上游状态已保存");
      renderRoute(true);
    } catch (e) {
      if (renderScope.signal.aborted) return;
      model.config[g][i].enabled = old;
      toast("保存失败", "error", e.message);
      renderRoute(true);
    }
  }
  async function deleteUpstream(row) {
    if (!confirm("确定删除这个上游 DNS 吗？")) return;
    const g = row.dataset.group, i = +row.dataset.index, old = model.config[g].slice();
    model.config[g].splice(i, 1);
    try {
      await saveUpstreamGroup(g);
      toast("上游已删除");
      renderRoute(true);
    } catch (e) {
      if (renderScope.signal.aborted) return;
      model.config[g] = old;
      toast("删除失败", "error", e.message);
    }
  }
  function openUpstreamModal(row) {
    const edit = !!row;
    const group = edit ? row.dataset.group : Object.keys(model.config || {})[0] || "domestic";
    const idx = edit ? +row.dataset.index : -1;
    const u = edit ? model.config[group][idx] : { tag: "", protocol: "udp", addr: "", enabled: true };
    const groups2 = Object.keys(model.config || {});
    const hasSocks = (g) => g === "foreign" || g === "foreign_ecs";
    const fieldsHtml = (g, v) => {
      const f = (id, label, value, extra = "") => `<div class="field"><label>${label}</label><input id="${id}" ${extra} value="${esc$1(value)}"></div>`;
      return `<div class="field"><label>名称</label><input id="u-tag" value="${esc$1(v.tag)}" required></div>
      <div class="field"><label>协议</label><select id="u-protocol">${["udp", "tcp", "tls", "https"].map((x) => `<option ${x === v.protocol ? "selected" : ""}>${x}</option>`).join("")}</select></div>
      ${f("u-addr", "服务器地址", v.addr, 'required placeholder="223.5.5.5:53 或 https://.../dns-query"')}
      ${f("u-dial", "拨号地址", v.dial, 'placeholder="可选"')}
      ${hasSocks(g) ? f("u-socks", "SOCKS5", v.socks, 'placeholder="可选"') : ""}
      ${g === "foreign_ecs" ? f("u-ecs", "ECS", v.ecs, 'placeholder="一个 IPv4 或 IPv6，可留空；IPv4 默认 /24，IPv6 默认 /56"') : ""}
      ${f("u-timeout", "查询超时（ms）", v.timeout, 'type="number" min="0"')}`;
    };
    const readForm = () => ({ tag: $("#u-tag").value, protocol: $("#u-protocol").value, addr: $("#u-addr").value, dial: $("#u-dial").value, socks: $("#u-socks") ? $("#u-socks").value : "", ecs: $("#u-ecs") ? $("#u-ecs").value : model.ecs || "", timeout: $("#u-timeout").value });
    const initial = { tag: u.tag || "", protocol: u.protocol || "udp", addr: u.addr || u.server_addr || "", dial: u.dial_addr || "", socks: u.socks5 || "", ecs: model.ecs || "", timeout: u.upstream_query_timeout || 0 };
    modalOpen(edit ? "编辑上游 DNS" : "添加上游 DNS", "保存后立即生效", `<div class="grid grid-2">
      <div class="field"><label>所属组</label><select id="u-group" ${edit ? "disabled" : ""}>${groups2.map((g) => `<option value="${esc$1(g)}" ${g === group ? "selected" : ""}>${esc$1(groupName(g))}</option>`).join("")}</select></div>
      <span id="u-fields" style="display:contents">${fieldsHtml(group, initial)}</span>
    </div>`, async () => {
      const g = $("#u-group").value;
      const v = readForm();
      const item = Object.assign({}, u, { tag: v.tag.trim(), protocol: v.protocol, enabled: u.enabled !== false });
      if (!item.tag) throw new Error("名称不能为空");
      item.addr = v.addr.trim();
      item.dial_addr = v.dial.trim();
      if (hasSocks(g)) item.socks5 = v.socks.trim();
      else delete item.socks5;
      const timeout = +v.timeout || 0;
      if (timeout > 0) item.upstream_query_timeout = timeout;
      else delete item.upstream_query_timeout;
      for (const k of ["bootstrap", "enable_http3", "enable_pipeline", "account_id", "access_key_id", "access_key_secret", "server_addr", "ecs_client_ip", "ecs_client_mask", "ecs_mask"]) delete item[k];
      const candidate = (model.config[g] || []).slice();
      if (edit) candidate[idx] = item;
      else candidate.push(item);
      const ecs2 = g === "foreign_ecs" ? v.ecs.trim() : void 0;
      await saveUpstreamCandidate(g, candidate, ecs2);
      model.config[g] = candidate;
      if (ecs2 !== void 0) model.ecs = ecs2;
      toast("上游 DNS 已保存");
      renderRoute(true);
    });
    $("#u-group").onchange = () => {
      const g = $("#u-group").value;
      setHTML($("#u-fields"), fieldsHtml(g, readForm()));
    };
  }
}
const upstreamsRoute = { mount(container, context) {
  return renderUpstreams(container, context);
} };
class LatestView {
  constructor(parent) {
    this.parent = parent;
  }
  begin() {
    var _a2;
    (_a2 = this.release) == null ? void 0 : _a2.call(this);
    const scope = new CleanupScope();
    this.active = scope;
    this.release = this.parent.add(() => scope.dispose());
    return scope;
  }
  get signal() {
    var _a2;
    return (_a2 = this.active) == null ? void 0 : _a2.signal;
  }
}
let mountToolbar;
function initialize$6() {
  "use strict";
  const $2 = (s, r = document) => r.querySelector(s);
  const esc2 = (value) => String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const names = { whitelist: "白名单", blocklist: "黑名单", greylist: "灰名单", force_realip: "强制 RealIP", ddns_domains: "DDNS 域名", pcdn_domains: "PCDN 域名", pcdn_regex_v4: "PCDN IPv4", pcdn_regex_v6: "PCDN IPv6", client_ip: "客户端 IP", direct_ip: "直连 IP", rewrite: "重定向" };
  function syncMode() {
    const host = $2("#rv-root");
    if (!host) {
      document.body.classList.remove("has-rules-workbench");
      const heading = $2(".view-title-row h1");
      if (heading && heading.textContent === "清单工作台") heading.textContent = "规则管理";
      const note = $2(".view-title-row .gc-sub");
      if (note && note.textContent === "逐条编辑名单，随时切换原文。") note.textContent = "维护本地名单、广告拦截与在线分流规则。";
    }
    if (!host) return;
    const raw = host.classList.contains("raw");
    for (const b of host.querySelectorAll("[data-wb-mode]")) b.setAttribute("aria-pressed", String(b.dataset.wbMode === "raw" === raw));
  }
  function enhance() {
    var _a2;
    const main = $2("#page-content");
    if (!main) return;
    if (document.body.dataset.consoleRoute !== "rules") {
      document.body.classList.remove("has-rules-workbench");
      return;
    }
    const host = $2("#rv-root");
    if (!host) {
      document.body.classList.remove("has-rules-workbench");
      const heading2 = $2(".view-title-row h1");
      if (heading2 && heading2.textContent === "清单工作台") heading2.textContent = "规则管理";
      const note = $2(".view-title-row .gc-sub");
      if (note && note.textContent === "逐条编辑名单，随时切换原文。") note.textContent = "维护本地名单、广告拦截与在线分流规则。";
    }
    const titleArea = $2(".view-title-row>div:first-child");
    if (host && titleArea && !$2("h1", titleArea)) insertHTML(titleArea, "afterbegin", '<h1>清单工作台</h1><span class="gc-sub">逐条编辑名单，随时切换原文。</span>');
    if (!host || host.dataset.workbench) return;
    host.dataset.workbench = "1";
    document.body.classList.add("has-rules-workbench");
    const title = $2(".view-title-row h1");
    if (title) title.textContent = "清单工作台";
    const sub = $2(".view-title-row .gc-sub");
    if (sub) sub.textContent = "逐条编辑名单，随时切换原文。";
    const bar = $2(".rv-toolbar", host), actions = $2(".section-header-actions", bar);
    const heading = document.createElement("div");
    heading.className = "wb-list-heading";
    setHTML(heading, `<div><h2>${esc2(names[(_a2 = $2(".rule-menu button.active")) == null ? void 0 : _a2.dataset.ruleTag] || "名单管理")}</h2><p>启停与编辑先保留为草稿，保存后生效。</p></div><div class="wb-list-tools"><span class="wb-author">名单视图由 clone-fan 贡献</span></div>`);
    bar.before(heading);
    const modes = document.createElement("div");
    modes.className = "wb-modes";
    modes.setAttribute("role", "group");
    modes.setAttribute("aria-label", "名单编辑方式");
    setHTML(modes, '<button type="button" data-wb-mode="list" aria-pressed="true">列表</button><button type="button" data-wb-mode="raw" aria-pressed="false">原文</button>');
    for (const button of modes.querySelectorAll("button")) button.onclick = () => {
      const isRaw = host.classList.contains("raw");
      if (button.dataset.wbMode === "raw" !== isRaw) $2("#rv-mode").click();
      syncMode();
    };
    if (actions) bar.insertBefore(modes, actions);
    else bar.append(modes);
    const save = $2("#rule-save");
    if (save) {
      setHTML(save, '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M4 3h14l2 2v16H4zM8 3v7h8V3M8 21v-8h8v8"/></svg>保存');
      save.title = "保存到 DNS 核心";
    }
    const list = $2(".rv-list", host);
    if (list) list.setAttribute("aria-label", "规则列表");
    const search = $2("#rv-q");
    if (search) search.setAttribute("aria-label", "搜索内容或类型");
    const raw = $2("#rule-text");
    if (raw) raw.setAttribute("aria-label", "名单原文");
    syncMode();
  }
  let active2;
  mountToolbar = () => {
    const scope = currentScope();
    if (active2 === scope) return;
    active2 = scope;
    let queued = false, frame;
    const observer = new MutationObserver(() => {
      if (queued) return;
      queued = true;
      frame = requestAnimationFrame(() => {
        queued = false;
        if (!scope.signal.aborted) enhance();
      });
    });
    observer.observe($2("#page-content"), { subtree: true, childList: true });
    scope.add(() => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      document.body.classList.remove("has-rules-workbench");
    });
    enhance();
  };
}
let rulesWorkbenchService;
function initialize$5() {
  "use strict";
  let lifecycle;
  let leaveResolution;
  function finishLeave(allowed) {
    const resolve = leaveResolution;
    leaveResolution = null;
    resolve == null ? void 0 : resolve(allowed);
  }
  function requestLeave2() {
    return new Promise((resolve) => {
      finishLeave(false);
      leaveResolution = resolve;
      const allowed = canLeave(() => finishLeave(true));
      if (allowed) finishLeave(true);
      else if (!pendingLeave) finishLeave(false);
    });
  }
  let observer;
  let rt;
  function mount2() {
    const next = currentScope();
    if (lifecycle === next) return;
    lifecycle = next;
    globalBound = false;
    bindGlobal();
    tick();
    lifecycle.listen(window, "resize", () => {
      clearTimeout(rt);
      rt = setTimeout(fitList, 150);
    });
    lifecycle.listen(window, "beforeunload", beforeUnload);
    let pending = false;
    observer = new MutationObserver(() => {
      if (pending || lifecycle.signal.aborted) return;
      pending = true;
      try {
        paintCounts();
        tick();
      } catch {
      }
      const frame = requestAnimationFrame(() => {
        pending = false;
        if (!lifecycle.signal.aborted) {
          tick();
          fitList();
        }
      });
      lifecycle.add(() => cancelAnimationFrame(frame));
    });
    observer.observe(document.getElementById("page-content"), { childList: true, subtree: true });
    lifecycle.add(() => {
      observer.disconnect();
      clearTimeout(rt);
      clearTimeout(focusTimer);
      closeSheet(true);
      closePaste();
      closeRowMenu();
      closeNewMenu();
      for (const element of document.querySelectorAll("#rv-sheet,#rv-scrim,#rp-wrap,.rv-menu-float")) element.remove();
      root = null;
      ta = null;
      sheetEl = null;
      scrimEl = null;
    });
  }
  var PREFIX = { domain: "domain:", full: "full:", keyword: "keyword:", regexp: "regexp:" };
  var NAME = { domain: "域名", full: "完整域名", keyword: "关键字", regexp: "正则", raw: "原文", comment: "注释" };
  var HOST_RE = /^(\*\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;
  var REGEX_CHAR_RE = /[\\^$[\](){}|?+]/;
  var PREFIX_RE = /^\s*(domain|full|keyword|regexp)\s*[:：]\s*/i;
  var esc2 = function(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function(c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  };
  var ICON = {
    search: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
    edit: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
    note: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M5 4h14v9l-4 4H5z"/><path d="M9 9h7M9 13h4"/></svg>',
    plus: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>',
    ungroup: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M7 4v9h7M14 4v9H7M4 17h16M12 17v3"/></svg>',
    group: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M4 6h6M4 12h6M4 18h6M13 12h7"/><path d="M13 12V6h7"/></svg>',
    del: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M3 6h18M8 6V4h8v2m-9 0 1 14h8l1-14"/></svg>'
  };
  var root = null, ta = null, saveBtn = null, rows = [], sel = [], q = "", view = "list";
  var editing = null, isNew = false, dirty = false, seq = 0, armedEnter = false;
  var hist = [], histAt = -1, histLock = false, savedText = "";
  var dragIds = [];
  var sheetBaseline = "", sheetOff = false, pendingLeave = null, focusTimer = null, mainWasInert = false, ownsInert = false;
  var rawTags = { client_ip: true, direct_ip: true, rewrite: true };
  var rawMode = false;
  var sheetEl = null, scrimEl = null;
  var sheetBack = null;
  var lastTrigger = null;
  var menuBtn = null, menuPop = null;
  var groupSelBase = "";
  var groupRole = "title";
  var groupMode = false, editingGroup = null, groupBase = null;
  var counts = {}, countsAt = 0, countsBusy = false, lastTag = null;
  function say(msg, type, detail) {
    try {
      if (typeof toast === "function") {
        toast(msg, type, detail);
        return;
      }
    } catch (e) {
    }
    var box = document.getElementById("toast-stack");
    if (!box) return;
    var previous = box.querySelector("[data-rv-notice]");
    if (previous) previous.remove();
    var el = document.createElement("div");
    el.dataset.rvNotice = "";
    el.className = "toast";
    setHTML(el, "<span>" + esc2(msg) + "</span>");
    box.appendChild(el);
    setTimeout(function() {
      el.remove();
    }, 2600);
  }
  function parse(text2) {
    return String(text2 || "").split("\n").map(function(raw, i) {
      var s = raw.trim(), off = false, m;
      if (/^#/.test(s)) {
        off = true;
        s = s.replace(/^#\s*/, "");
      }
      var rawOff = off && s.match(/^停用原文[:：]\s*(.*)$/);
      if (rawOff) return { id: "r" + ++seq, kind: "raw", type: "raw", value: rawOff[1], off: true, line: raw };
      m = s.match(/^(domain|full|keyword|regexp)\s*:\s*/i);
      if (m) return { id: "r" + ++seq, kind: "rule", type: m[1].toLowerCase(), value: s.slice(m[0].length), off, line: raw };
      if (off && !s) return { id: "r" + ++seq, kind: "sep", type: "sep", value: "", off: true, line: raw };
      if (!s) return { id: "r" + ++seq, kind: "blank", type: "blank", value: "", off: false, line: raw };
      if (off) return { id: "r" + ++seq, kind: "comment", type: "comment", value: s, off: true, line: raw };
      return { id: "r" + ++seq, kind: "raw", type: "raw", value: s, off: false, line: raw };
    });
  }
  function lineOf(r) {
    if (!r.touched) return r.line;
    if (r.kind === "blank") return "";
    if (r.kind === "sep") return "#";
    if (r.kind === "comment") return "# " + r.value;
    if (r.kind === "raw") return (r.off ? "# 停用原文：" : "") + r.value;
    return (r.off ? "# " : "") + (PREFIX[r.type] || "domain:") + r.value;
  }
  function syncSiteState() {
    if (!ta) return;
    try {
      var api2 = shellInterfaceService;
      if (ta.dataset && ta.dataset.original !== void 0) ta.dataset.original = savedText;
      if (api2 && typeof api2.rememberDraft === "function") api2.rememberDraft();
    } catch (e) {
    }
  }
  function writeBack() {
    if (!ta) return;
    ta.value = rows.map(lineOf).join("\n");
    var lines = ta.value.split("\n").filter(function(x) {
      return x.trim();
    }).length;
    var counter = document.getElementById("rule-lines");
    if (counter) counter.textContent = "共 " + lines + " 行";
    dirty = ta.value !== savedText;
    if (saveBtn) saveBtn.classList.toggle("rv-has-dirty", dirty);
    commitHist(ta.value);
    syncSiteState();
    renderStat();
  }
  function paintHist() {
    if (!root) return;
    var u = root.querySelector("#rv-undo"), r = root.querySelector("#rv-redo");
    if (u) u.disabled = histAt <= 0;
    if (r) r.disabled = histAt >= hist.length - 1;
  }
  function commitHist(text2) {
    if (histLock) return;
    if (histAt >= 0 && hist[histAt] === text2) {
      paintHist();
      return;
    }
    hist = hist.slice(0, histAt + 1);
    hist.push(text2);
    if (hist.length > 60) hist.shift();
    histAt = hist.length - 1;
    paintHist();
  }
  function applyHist() {
    if (!ta) return;
    histLock = true;
    ta.value = hist[histAt] || "";
    rows = parse(ta.value);
    sel = [];
    q = "";
    var qBox = root && root.querySelector("#rv-q");
    if (qBox) qBox.value = "";
    paintSearch();
    dirty = ta.value !== savedText;
    if (saveBtn) saveBtn.classList.toggle("rv-has-dirty", dirty);
    renderList();
    renderStat();
    histLock = false;
    syncSiteState();
    var counter = document.getElementById("rule-lines");
    if (counter) counter.textContent = "共 " + ta.value.split("\n").filter(Boolean).length + " 行";
    paintHist();
  }
  function undo() {
    if (histAt <= 0) {
      say("没有更早的状态了");
      return;
    }
    histAt--;
    applyHist();
    say("已撤销（" + (histAt + 1) + "/" + hist.length + "）");
  }
  function redo() {
    if (histAt >= hist.length - 1) {
      say("没有更新的状态了");
      return;
    }
    histAt++;
    applyHist();
    say("已重做（" + (histAt + 1) + "/" + hist.length + "）");
  }
  function activeTag() {
    var b = document.querySelector(".rule-menu button.active");
    return b && b.dataset.ruleTag;
  }
  function setDirty(v) {
    dirty = !!v;
    if (saveBtn) saveBtn.classList.toggle("rv-has-dirty", dirty);
    renderStat();
  }
  function hookSaved() {
    var api2 = shellInterfaceService;
    if (!api2 || typeof api2.ruleSaved !== "function" || api2.__rvHooked) return;
    var orig = api2.ruleSaved;
    api2.ruleSaved = function(tag, value) {
      try {
        if (!root || !root.isConnected || activeTag() !== tag) return orig.apply(this, arguments);
        savedText = typeof value === "string" ? value : ta ? ta.value : savedText;
        setDirty(!!ta && ta.value !== savedText);
      } catch (e) {
      }
      return orig.apply(this, arguments);
    };
    api2.__rvHooked = true;
  }
  function visibleRows() {
    var kw = q.trim().toLowerCase();
    if (!kw) return rows;
    return rows.filter(function(r) {
      if (r.kind === "blank" || r.kind === "sep") return false;
      return (r.value || "").toLowerCase().indexOf(kw) >= 0 || NAME[r.type].indexOf(kw) >= 0;
    });
  }
  function selectableRows() {
    return visibleRows().filter(function(r) {
      return r.kind === "rule" || r.kind === "raw";
    });
  }
  function allSelected() {
    var v = selectableRows();
    return v.length > 0 && v.every(function(r) {
      return sel.indexOf(r.id) >= 0;
    });
  }
  function paintSearch() {
    var box = root && root.querySelector("#rv-q"), x = root && root.querySelector("#rv-qx");
    if (x) x.hidden = !(box && box.value);
  }
  function paintSelect() {
    var b = root && root.querySelector("#rv-all");
    if (!b) return;
    var label = allSelected() ? "取消全选" : "全选";
    if (b.textContent !== label) b.textContent = label;
    b.disabled = selectableRows().length === 0;
  }
  var groups = [], lineGroup = {}, childGroup = {};
  var TITLE_RE = /^#\s*(?:标题|title)\s*[:：]\s*(.*)$/i;
  var NOTE_RE_ANY = /^#\s*(?:备注|note)\s*[:：]\s*(.*)$/i;
  var ANNO_KEY = /^(?:注意|注释|提示|匹配|仅处理|仅|另外|补充|来源)/;
  var DOC_COLON = /^说明\s*[:：]/;
  var DOC_PUNCT = /[，。；、]/;
  function isAnno(r) {
    return ANNO_KEY.test(commentLine(r).replace(/^#\s*/, "").trim());
  }
  function commentLine(r) {
    return String(r.touched ? lineOf(r) : r.line != null ? r.line : "# " + r.value);
  }
  function commentRole(r, cur) {
    var t = commentLine(r);
    if (NOTE_RE_ANY.test(t)) return "note";
    if (TITLE_RE.test(t)) return "title";
    var body = t.replace(/^#\s*/, "").trim();
    if (isAnno(r)) return cur && !cur.children.length ? "gnote" : "note";
    if (DOC_COLON.test(body) || DOC_PUNCT.test(body)) return "doc";
    return "title";
  }
  function buildGroups() {
    groups = [];
    lineGroup = {};
    childGroup = {};
    var cur = null;
    rows.forEach(function(r) {
      if (r.kind === "comment") {
        var role = commentRole(r, cur);
        r.role = role;
        if (role === "gnote" && cur) {
          cur.notes.push(r);
          cur.lines.push(r);
          lineGroup[r.id] = cur.id;
          return;
        }
        if (role === "note") {
          if (cur) childGroup[r.id] = cur.id;
          return;
        }
        if (role === "doc") return;
        cur = { id: r.id, title: r, notes: [], lines: [r], children: [] };
        groups.push(cur);
        lineGroup[r.id] = cur.id;
        return;
      }
      if (r.kind === "blank" || r.kind === "sep") {
        cur = null;
        return;
      }
      if (cur) {
        cur.children.push(r.id);
        childGroup[r.id] = cur.id;
      } else cur = null;
    });
  }
  function stripTitlePrefix(t) {
    return String(t || "").replace(/^\s*(?:标题|title)\s*[:：]\s*/i, "").trim();
  }
  function stripNotePrefix(t) {
    return String(t || "").replace(/^\s*(?:备注|note)\s*[:：]\s*/i, "").trim();
  }
  function openCommentSheet(row) {
    openGroupSheet({ id: row.id, title: row, notes: [], lines: [row], children: [], docOnly: true });
  }
  function groupById(id) {
    for (var i = 0; i < groups.length; i++) if (groups[i].id === id) return groups[i];
    return null;
  }
  function groupOf(id) {
    return groupById(childGroup[id]);
  }
  function groupTitle(g) {
    return String(g && g.title && g.title.value || "").trim();
  }
  function renderStat() {
    var box = document.getElementById("rv-stat");
    if (!box) return;
    buildGroups();
    var rules = rows.filter(function(r) {
      return r.kind === "rule" || r.kind === "raw";
    });
    var off = rules.filter(function(r) {
      return r.off;
    }).length;
    var g = groups.filter(function(x) {
      return x.children.length;
    }).length;
    var statHTML = "共 <b>" + rules.length + "</b> 条 · 停用 <b>" + off + "</b>" + (g ? " · 分组 <b>" + g + "</b>" : "") + (dirty ? ' · <span style="color:var(--amber)">有未保存修改</span>' : "");
    if (box.innerHTML !== statHTML) setHTML(box, statHTML);
    var bar = root.querySelector(".rv-selbar");
    if (bar) {
      bar.hidden = !sel.length;
      var m = bar.querySelector(".n b");
      if (m && m.textContent !== String(sel.length)) m.textContent = sel.length;
    }
    paintSelect();
  }
  function groupRowHTML(g) {
    var notes = g.notes.map(function(n) {
      return esc2(String(n.value || "").trim());
    }).filter(Boolean);
    return '<div class="rv-row grp" data-id="' + g.id + '"><span class="rv-mark" title="这条 # 行是分组标题">#</span><span class="rv-grp-main"><span class="rv-grp-title">' + esc2(stripTitlePrefix(groupTitle(g))) + "</span>" + (notes.length ? '<span class="rv-grp-notes">' + notes.join("<br>") + "</span>" : "") + (g.children.length ? "" : '<span class="rv-grp-empty">还没有规则 · 用规则行上的「分组」按钮放进来</span>') + '</span><span class="rv-grp-count">' + (g.children.length ? g.children.length + " 条" : "空标题") + '</span><span class="rv-ops"><button class="rv-ib" data-act="edit" title="编辑标题与注释">' + ICON.edit + "</button>" + (g.children.length ? '<button class="rv-ib" data-act="tonote" title="改成下面第一条规则的备注">' + ICON.note + "</button>" : "") + '<button class="rv-ib del" data-act="del" title="删除这个标题块">' + ICON.del + "</button></span></div>";
  }
  function ruleRowHTML(r) {
    var on = sel.indexOf(r.id) >= 0;
    var cmt = r.kind === "comment";
    return '<div class="rv-row' + (r.off && r.kind !== "comment" ? " off" : "") + (r.kind === "comment" ? " cmt" : "") + (childGroup[r.id] ? " child" : "") + (on ? " sel" : "") + '" data-id="' + r.id + '"><span class="rv-handle" title="拖动排序"><svg width="14" height="16" viewBox="0 0 14 16" fill="currentColor" aria-hidden="true"><circle cx="4" cy="4" r="1"/><circle cx="10" cy="4" r="1"/><circle cx="4" cy="8" r="1"/><circle cx="10" cy="8" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="10" cy="12" r="1"/></svg></span>' + /* 注释行/说明行不参与批量选择与启停，就不给它复选框，免得勾了却数不进「已选 N 条」 */
    (cmt ? '<span class="rv-ck-na" title="# 行不参与批量操作">—</span>' : '<label class="rv-select" title="选择这条"><input type="checkbox" class="rv-ck"' + (on ? " checked" : "") + ' aria-label="选择这条"></label>') + '<span class="rv-type t-' + r.type + (cmt && r.role === "note" ? " role-note" : "") + '">' + (cmt ? r.role === "note" ? "备注" : r.role === "doc" ? "说明" : "注释" : NAME[r.type]) + '</span><span class="rv-value' + (r.type === "regexp" || (r.value || "").length > 56 ? " wrap" : "") + '" title="' + esc2(lineOf(r)) + '">' + esc2(r.value) + "</span>" + (cmt ? '<span class="rv-na" title="# 行不会启用或停用">—</span>' : '<label class="switch"><input type="checkbox" class="rv-sw"' + (r.off ? "" : " checked") + ' aria-label="启用这条"><span class="switch-track"><span class="switch-thumb"></span></span></label>') + '<span class="rv-ops"><button class="rv-ib" data-act="edit" title="编辑">' + ICON.edit + "</button>" + (!cmt ? '<button class="rv-ib' + (childGroup[r.id] ? " on" : "") + '" data-act="group" title="放进分组 / 移出分组">' + ICON.group + "</button>" : "") + (cmt ? '<button class="rv-ib" data-act="role" title="这一行是标题 / 说明 / 备注">' + ICON.note + "</button>" : "") + '<button class="rv-ib del" data-act="del" title="删除">' + ICON.del + "</button></span></div>";
  }
  function renderList() {
    var box = root.querySelector(".rv-list");
    buildGroups();
    var kw = q.trim().toLowerCase();
    var hits = function(r) {
      return String(r.value || "").toLowerCase().indexOf(kw) >= 0 || String(NAME[r.type] || "").toLowerCase().indexOf(kw) >= 0;
    };
    var show = {};
    if (!kw) {
      rows.forEach(function(r) {
        show[r.id] = true;
      });
    } else {
      groups.forEach(function(g) {
        if (!hits(g.title) && !g.notes.some(hits)) return;
        show[g.id] = true;
        g.notes.forEach(function(n) {
          show[n.id] = true;
        });
        g.children.forEach(function(id) {
          show[id] = true;
        });
      });
      rows.forEach(function(r) {
        if (r.kind === "blank" || r.kind === "sep" || !hits(r)) return;
        show[r.id] = true;
        var g = groupOf(r.id) || groupById(lineGroup[r.id]);
        if (g) {
          show[g.id] = true;
          g.notes.forEach(function(n) {
            show[n.id] = true;
          });
        }
      });
    }
    var anyReal = rows.some(function(r) {
      return show[r.id] && r.kind !== "blank";
    });
    if (!anyReal) {
      var hasRows = rows.some(function(r) {
        return r.kind !== "blank";
      });
      setHTML(box, '<div class="rv-empty"><b>' + (hasRows ? "没有匹配的规则" : "这个名单还是空的") + "</b>" + (hasRows ? "换个关键词试试" : "点右上角「新增规则」加一条") + "</div>");
    } else {
      var out = [];
      rows.forEach(function(r) {
        if (!show[r.id]) return;
        if (r.kind === "blank" || r.kind === "sep") {
          out.push('<div class="rv-row ' + (r.kind === "sep" ? "sep" : "blank") + '" data-id="' + r.id + '"' + (r.kind === "sep" ? ' title="分组分隔线：它上面的规则不归下一个标题"' : "") + "></div>");
          return;
        }
        var g = groupById(r.id);
        if (g) {
          out.push(groupRowHTML(g));
          return;
        }
        if (lineGroup[r.id]) return;
        out.push(ruleRowHTML(r));
      });
      setHTML(box, out.join(""));
    }
    Array.prototype.forEach.call(box.querySelectorAll(".rv-row:not(.blank):not(.sep)"), function(el) {
      var grp = groupById(el.dataset.id);
      if (grp) {
        el.onclick = function() {
          lastTrigger = el.querySelector("[data-act=edit]");
          openGroupSheet(grp);
        };
        el.querySelector("[data-act=edit]").onclick = function(e) {
          e.stopPropagation();
          lastTrigger = this;
          openGroupSheet(grp);
        };
        el.querySelector("[data-act=del]").onclick = function(e) {
          e.stopPropagation();
          dropGroup(grp);
        };
        var tn = el.querySelector("[data-act=tonote]");
        if (tn) tn.onclick = function(e) {
          e.stopPropagation();
          groupToNote(grp);
        };
        bindDrag(el, grp.lines.map(function(l) {
          return l.id;
        }).concat(grp.children), grp.lines[0], grp);
        return;
      }
      var row = byId(el.dataset.id);
      if (!row) return;
      var ck = el.querySelector(".rv-ck");
      var sw = el.querySelector(".rv-sw");
      var host = el.querySelector(".rv-value");
      if (ck) ck.onchange = function() {
        if (ck.checked) {
          if (sel.indexOf(row.id) < 0) sel.push(row.id);
        } else sel = sel.filter(function(x) {
          return x !== row.id;
        });
        el.classList.toggle("sel", ck.checked);
        renderStat();
      };
      if (sw) sw.onchange = function() {
        row.off = !sw.checked;
        row.touched = true;
        el.classList.toggle("off", row.off);
        writeBack();
        say(row.off ? "已停用 " + row.value : "已启用 " + row.value);
      };
      el.querySelector("[data-act=del]").onclick = function(e) {
        e.stopPropagation();
        dropRow(row);
      };
      var gb = el.querySelector("[data-act=group]");
      if (gb) gb.onclick = function(e) {
        e.stopPropagation();
        openGroupPicker(this, row);
      };
      var rb = el.querySelector("[data-act=role]");
      if (rb) rb.onclick = function(e) {
        e.stopPropagation();
        openRolePicker(this, row);
      };
      if (!host) return;
      var target = row;
      if (row.kind === "comment") {
        for (var k = rows.indexOf(row) + 1; k < rows.length; k++) {
          if (rows[k].kind === "rule" || rows[k].kind === "raw") {
            target = rows[k];
            break;
          }
        }
      }
      var openRow = function() {
        lastTrigger = el.querySelector("[data-act=edit]");
        if (row.kind === "comment" && row.role === "doc") openCommentSheet(row);
        else openSheet(target, false);
      };
      host.setAttribute("role", "button");
      host.tabIndex = 0;
      host.setAttribute("aria-label", "编辑 " + row.value);
      host.onkeydown = function(e) {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openRow();
        }
      };
      host.onclick = openRow;
      host.ondblclick = function(e) {
        e.preventDefault();
      };
      el.querySelector("[data-act=edit]").onclick = function(e) {
        e.stopPropagation();
        openRow();
      };
      bindDrag(el, [row.id], row, null);
    });
    renderStat();
  }
  function byId(id) {
    return rows.filter(function(r) {
      return r.id === id;
    })[0];
  }
  function commitGroup() {
    var title = sheet().querySelector("#rv-grp-title").value.trim();
    var notes = sheet().querySelector("#rv-grp-notes").value.split("\n").map(function(x) {
      return x.trim();
    }).filter(Boolean).map(function(x) {
      return ANNO_KEY.test(x) || TITLE_RE.test("# " + x) || NOTE_RE_ANY.test("# " + x) ? x : "注释：" + x;
    });
    if (!title) {
      say("标题不能为空");
      sheet().querySelector("#rv-grp-title").focus();
      return;
    }
    if (groupRole !== "title") notes = [];
    var head = groupRole === "title" ? needsTitlePrefix(title) ? "标题：" : "" : groupRole === "doc" ? "说明：" : "备注：";
    var want = [head + title].concat(notes), i;
    if (editingGroup) {
      var old = editingGroup.lines, at = rows.indexOf(old[0]);
      if (at < 0) {
        closeSheet(true);
        return;
      }
      var keep = rows.slice(0, at).concat(rows.slice(at + old.length));
      var rebuilt = want.map(function(t, k) {
        if (k < old.length) {
          old[k].value = t;
          old[k].touched = true;
          old[k].kind = "comment";
          old[k].type = "comment";
          old[k].off = true;
          return old[k];
        }
        return { id: "r" + ++seq, kind: "comment", type: "comment", value: t, off: true, touched: true };
      });
      rows = keep.slice(0, at).concat(rebuilt, keep.slice(at));
      if (groupRole === "title" && !(editingGroup.title && editingGroup.title.role === "title")) keepTitleEmpty(rebuilt[0]);
      writeBack();
      closeSheet(true);
      renderList();
      say("已更新标题：" + title);
      return;
    }
    var made = want.map(function(t) {
      return { id: "r" + ++seq, kind: "comment", type: "comment", value: t, off: true, touched: true };
    });
    var lastRule = null;
    rows.forEach(function(r) {
      if (r.kind === "rule" || r.kind === "raw") lastRule = r;
    });
    var atNew = lastRule ? rows.indexOf(lastRule) + 1 : rows.length;
    rows = rows.slice(0, atNew).concat(made, rows.slice(atNew));
    writeBack();
    closeSheet(true);
    renderList();
    say("已新增标题：" + title + "（记得点保存）");
  }
  function dropGroup(g) {
    if (!g) return;
    var txt = g.lines.map(function(l) {
      return "# " + l.value;
    }).join("\n");
    if (!window.confirm("删除这个标题块？\n" + txt + "\n\n下面的 " + g.children.length + " 条规则会保留。")) return;
    var ids = g.lines.map(function(l) {
      return l.id;
    });
    rows = rows.filter(function(r) {
      return ids.indexOf(r.id) < 0;
    });
    writeBack();
    closeSheet(true);
    renderList();
    say("已删除标题");
  }
  function bindDrag(el, ids, selfRow, selfGroup) {
    var handle = el.querySelector(".rv-handle, .rv-mark");
    el.setAttribute("draggable", "false");
    if (handle) {
      handle.addEventListener("mousedown", function() {
        el.setAttribute("draggable", "true");
      });
      handle.addEventListener("touchstart", function() {
        el.setAttribute("draggable", "true");
      }, { passive: true });
    }
    el.addEventListener("dragstart", function(e) {
      dragIds = ids.slice();
      el.classList.add("dragging");
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = "move";
        try {
          e.dataTransfer.setData("text/plain", dragIds.join(","));
        } catch (x) {
        }
      }
    });
    el.addEventListener("dragend", function() {
      dragIds = [];
      el.setAttribute("draggable", "false");
      Array.prototype.forEach.call(document.querySelectorAll("#rv-root .rv-row"), function(x) {
        x.classList.remove("dragging", "over");
      });
    });
    el.addEventListener("dragover", function(e) {
      e.preventDefault();
      if (dragIds.length && dragIds.indexOf(selfRow.id) < 0) el.classList.add("over");
    });
    el.addEventListener("dragleave", function() {
      el.classList.remove("over");
    });
    el.addEventListener("drop", function(e) {
      e.preventDefault();
      el.classList.remove("over");
      if (!dragIds.length || dragIds.indexOf(selfRow.id) >= 0) return;
      var moving = rows.filter(function(x) {
        return dragIds.indexOf(x.id) >= 0;
      });
      var rest = rows.filter(function(x) {
        return dragIds.indexOf(x.id) < 0;
      });
      var at;
      if (selfGroup) {
        var lastLine = selfGroup.lines[selfGroup.lines.length - 1];
        at = rest.indexOf(lastLine) + 1;
      } else {
        at = rest.indexOf(selfRow);
      }
      if (at < 0) return;
      rows = rest.slice(0, at).concat(moving, rest.slice(at));
      writeBack();
      renderList();
      say(selfGroup ? "已移到「" + groupTitle(selfGroup) + "」下面" : "已调整顺序");
    });
  }
  function dropRow(row, confirmed) {
    var pn = row.kind === "comment" ? { idx: -1 } : prevNote(row);
    if (!confirmed && !window.confirm("删除这条规则？\n" + lineOf(row) + (pn.idx >= 0 ? "\n（它上面的备注行一起删掉）" : ""))) return;
    rows = rows.filter(function(r, i) {
      return r.id !== row.id && i !== pn.idx;
    });
    sel = sel.filter(function(x) {
      return x !== row.id;
    });
    writeBack();
    renderList();
    say("已删除 " + row.value);
  }
  function groupToNote(g) {
    if (!g || !g.children.length) return;
    var t = stripTitlePrefix(groupTitle(g));
    if (!t) return;
    if (!window.confirm("把「" + t + "」改成下面第一条规则的备注？\n这一行的 # 会写成「# 备注：" + t + "」。")) return;
    g.title.value = "备注：" + t;
    g.title.touched = true;
    g.title.role = "note";
    writeBack();
    renderList();
    say("已改成备注：" + t);
  }
  function moveToGroup(target, gid) {
    if (!target || rows.indexOf(target) < 0) return false;
    var pn = prevNote(target), moving = [target];
    if (pn.idx >= 0) moving = [rows[pn.idx], target];
    var cur = groupOf(target.id), want = gid ? groupById(gid) : null;
    if (gid && !want) return false;
    if (cur && want && cur.id === want.id || !cur && !want) return false;
    var rest = rows.filter(function(r) {
      return moving.indexOf(r) < 0;
    });
    var g = want || cur, anchor, i, c;
    anchor = g.lines[g.lines.length - 1];
    for (i = 0; i < g.children.length; i++) {
      c = byId(g.children[i]);
      if (c && rest.indexOf(c) >= 0) anchor = c;
    }
    if (!anchor) return false;
    var at = rest.indexOf(anchor);
    if (at < 0) return false;
    var out = rest.slice(0, at + 1).concat(moving, rest.slice(at + 1));
    if (!want) {
      var pos = out.indexOf(moving[0]), after = out[pos + moving.length], prev = out[pos - 1];
      if (after && (after.kind === "sep" || after.kind === "blank")) {
        out.splice(pos, moving.length);
        var at2 = out.indexOf(after) + 1;
        out = out.slice(0, at2).concat(moving, out.slice(at2));
      } else if (prev && prev.kind !== "sep" && prev.kind !== "blank") {
        out.splice(pos, 0, sepRow());
      }
    }
    rows = out;
    return true;
  }
  function fillGroupSelect(row, fresh) {
    var box = sheet().querySelector("#rv-group"), hint2 = sheet().querySelector("#rv-group-hint");
    if (!box) return;
    var curG = !fresh && row ? groupOf(row.id) : null;
    var html2 = '<option value="">（不分组）</option>';
    groups.forEach(function(g) {
      var t = stripTitlePrefix(groupTitle(g)) || "（空标题）";
      html2 += '<option value="' + g.id + '"' + (curG && curG.id === g.id ? " selected" : "") + ">" + esc2(t.length > 28 ? t.slice(0, 28) + "…" : t) + "</option>";
    });
    setHTML(box, html2);
    box.disabled = groups.length === 0;
    groupSelBase = box.value;
    hint2.className = "rv-hint";
    hint2.textContent = groups.length ? curG ? "现在在「" + stripTitlePrefix(groupTitle(curG)) + "」里（" + curG.children.length + " 条）；选「（不分组）」就把它移出来" : "现在是单着的一条规则；选一个标题就归到那组下面" : "这个名单还没有标题，先在上面「＋ 新增 → 新增标题」建一个";
  }
  var rowMenuEl = null;
  function closeRowMenu() {
    if (rowMenuEl) {
      rowMenuEl.remove();
      rowMenuEl = null;
    }
  }
  function openRowMenu(anchor, cap, items) {
    closeRowMenu();
    var el = document.createElement("div");
    el.className = "rv-menu-pop rv-menu-float";
    setHTML(el, '<div class="rv-menu-cap">' + esc2(cap) + "</div>" + items.map(function(it, i) {
      return '<button type="button" data-i="' + i + '"' + (it.active ? ' class="active"' : "") + ">" + esc2(it.label) + '<span class="k">' + esc2(it.active ? "当前" : it.hint || "") + "</span></button>";
    }).join(""));
    document.body.appendChild(el);
    var r = anchor.getBoundingClientRect(), w = el.offsetWidth, h = el.offsetHeight;
    el.style.left = Math.min(Math.max(8, r.right - w), window.innerWidth - w - 8) + "px";
    var top = r.bottom + 6;
    if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 6);
    el.style.top = top + "px";
    el.onclick = function(e) {
      var b = e.target.closest("button[data-i]");
      if (!b) return;
      var it = items[+b.dataset.i];
      closeRowMenu();
      if (it && it.pick) it.pick();
    };
    rowMenuEl = el;
    var first = el.querySelector("button.active") || el.querySelector("button");
    if (first) first.focus();
  }
  function openGroupPicker(anchor, row) {
    var cur = groupOf(row.id);
    var items = [{
      label: "（不分组）",
      hint: groups.length ? "单着的一条规则" : "名单里还没有标题",
      active: !cur,
      pick: function() {
        if (moveToGroup(row, "")) {
          writeBack();
          renderList();
          say("已从分组里移出来：" + row.value);
        }
      }
    }];
    groups.forEach(function(g) {
      items.push({
        label: stripTitlePrefix(groupTitle(g)) || "（空标题）",
        hint: g.children.length + " 条",
        active: !!(cur && cur.id === g.id),
        pick: function() {
          if (moveToGroup(row, g.id)) {
            writeBack();
            renderList();
            say("已放进「" + stripTitlePrefix(groupTitle(g)) + "」：" + row.value);
          }
        }
      });
    });
    openRowMenu(anchor, "把这条放进哪一组", items);
  }
  function keepTitleEmpty(row) {
    var i = rows.indexOf(row);
    if (i < 0) return;
    var next = rows[i + 1];
    if (!next || next.kind === "blank" || next.kind === "sep") return;
    if (next.kind === "comment") {
      var nrole = next.role || commentRole(next, null);
      if (nrole !== "note") return;
    }
    rows.splice(i + 1, 0, sepRow());
  }
  function sepRow() {
    return { id: "r" + ++seq, kind: "sep", type: "sep", value: "", off: true, touched: true, line: "#" };
  }
  function setCommentRole(row, role) {
    var was = row.role;
    var body = String(row.value || "").replace(/^\s*(?:标题|title|说明|备注|note)\s*[:：]\s*/i, "");
    var head = role === "title" ? needsTitlePrefix(body) ? "标题：" : "" : role === "doc" ? "说明：" : "备注：";
    row.value = head + body;
    row.touched = true;
    row.role = role;
    if (role === "title" && was !== "title") keepTitleEmpty(row);
    writeBack();
    renderList();
    say(role === "title" ? "已改成标题：" + body : role === "note" ? "已改成规则备注：" + body : "已改成名单说明：" + body);
  }
  function needsTitlePrefix(t) {
    var s = String(t || "").trim();
    return DOC_COLON.test(s) || DOC_PUNCT.test(s) || ANNO_KEY.test(s);
  }
  function openRolePicker(anchor, row) {
    var cur = row.role || (row.kind === "comment" ? "doc" : "title");
    openRowMenu(anchor, "这一行是", [
      { label: "标题", hint: "领养下面的规则", active: cur === "title", pick: function() {
        setCommentRole(row, "title");
      } },
      { label: "名单说明", hint: "谁都不领养，规则照常单着", active: cur === "doc", pick: function() {
        setCommentRole(row, "doc");
      } },
      { label: "规则备注", hint: "贴到下面第一条规则上", active: cur === "note", pick: function() {
        setCommentRole(row, "note");
      } }
    ]);
  }
  var TYPE_TIP = {
    domain: { ph: "t.hdhome.org", tip: "含子域一起命中" },
    full: { ph: "stun.l.google.com", tip: "只匹配这一个，子域不命中" },
    keyword: { ph: "kaspersky", tip: "请求里出现就命中" },
    regexp: { ph: "^[^.]+$", tip: "按正则匹配，谨慎使用" }
  };
  var NOTE_RE = /^#\s*备注\s*[:：]\s*(.*)$/;
  function prevNote(row) {
    var i = rows.indexOf(row);
    if (i <= 0) return { idx: -1, text: "" };
    var p = rows[i - 1], line = (p.touched ? lineOf(p) : p.line) || "", m;
    if (!isRuleNote(p)) return { idx: -1, text: "" };
    m = String(line).match(NOTE_RE);
    return { idx: i - 1, text: m ? m[1] : stripNotePrefix(p.value) };
  }
  function isRuleNote(p) {
    if (!p || p.kind !== "comment") return false;
    if (p.role === "note") return true;
    if (p.role === "gnote" || p.role === "title" || p.role === "doc") return false;
    return NOTE_RE.test(commentLine(p)) || NOTE_RE_ANY.test(commentLine(p));
  }
  function sheet() {
    return sheetEl || document.getElementById("rv-sheet");
  }
  function scrim() {
    return scrimEl || document.getElementById("rv-scrim");
  }
  function defaultType() {
    var stat = {};
    rows.forEach(function(r) {
      if (r.kind === "rule") stat[r.type] = (stat[r.type] || 0) + 1;
    });
    var best = "domain", n = 0;
    Object.keys(stat).forEach(function(k) {
      if (stat[k] > n) {
        n = stat[k];
        best = k;
      }
    });
    return PREFIX[best] ? best : "domain";
  }
  function curType() {
    var b = sheet().querySelector("#rv-type button.on");
    return b ? b.dataset.t : "domain";
  }
  function setType(t, note) {
    if (!PREFIX[t]) return;
    Array.prototype.forEach.call(sheet().querySelectorAll("#rv-type button"), function(b) {
      b.classList.toggle("on", b.dataset.t === t);
      if (b.dataset.t === t) {
        b.classList.remove("pop");
        void b.offsetWidth;
        b.classList.add("pop");
      }
    });
    sheet().dataset.note = note || "";
  }
  function valid(v, t) {
    if (!v) return false;
    if (t === "keyword") return true;
    if (t === "regexp") {
      try {
        new RegExp(v);
        return true;
      } catch (e) {
        return false;
      }
    }
    return HOST_RE.test(v);
  }
  function errText(t) {
    return t === "regexp" ? "正则写错了，检查括号或转义" : t === "keyword" ? "关键字不能为空" : "域名格式看起来不对";
  }
  function linePreview() {
    var v = sheet().querySelector("#rv-value").value.trim();
    return (sheetOff ? "# " : "") + (rawMode ? "" : PREFIX[curType()] || "domain:") + (v || "…");
  }
  function hint(text2, cls) {
    var h = sheet().querySelector("#rv-hint");
    h.className = "rv-hint" + (cls ? " " + cls : "");
    setHTML(h, text2);
  }
  function paint() {
    var inp = sheet().querySelector("#rv-value");
    var raw = inp.value, v = raw.trim(), t = curType();
    var pm = v.match(PREFIX_RE), hash = /^#\s*/.test(v);
    var body = v.replace(/^#\s*/, "").replace(PREFIX_RE, "");
    var pending = !!pm || hash;
    var bad = !rawMode && !pending && !!body && !valid(body, t);
    inp.classList.toggle("bad", bad);
    var rawLabels = { client_ip: "客户端 IP", direct_ip: "IP 或网段", rewrite: "重定向条目" };
    sheet().querySelector("#rv-value-label").textContent = rawMode ? rawLabels[activeTag()] || "原文" : NAME[t];
    inp.placeholder = rawMode ? activeTag() === "rewrite" ? "例如 home.example.com 192.0.2.10" : "例如 192.0.2.10" : "例如 " + TYPE_TIP[t].ph;
    var note = sheet().dataset.note;
    if (bad) hint(errText(t), "bad");
    else if (pm) {
      var pt = pm[1].toLowerCase();
      hint("按回车识别为「" + NAME[pt] + '」 · 将写入 <span class="mono">' + esc2(PREFIX[pt] + body) + "</span>" + (hash ? "（停用）" : ""), "hit");
    } else if (hash) {
      hint('按回车按「停用」写入 <span class="mono">' + esc2("# " + PREFIX[t] + body) + "</span>", "hit");
    } else if (rawMode) hint('将写入 <span class="mono">' + esc2(linePreview()) + "</span> · " + (sheetOff ? "停用" : "保留原文格式"));
    else hint('将写入 <span class="mono">' + esc2(linePreview()) + "</span> · " + (note || TYPE_TIP[t].tip), note ? "hit" : "");
    sheet().classList.toggle("dirty", isDirtySheet());
  }
  function sheetSnapshot() {
    var pane = sheet();
    if (!pane) return "";
    if (groupMode) return JSON.stringify({ role: groupRole, title: pane.querySelector("#rv-grp-title").value, notes: pane.querySelector("#rv-grp-notes").value });
    return JSON.stringify({ type: curType(), raw: rawMode, off: sheetOff, value: pane.querySelector("#rv-value").value, note: pane.querySelector("#rv-note").value, group: pane.querySelector("#rv-group").value });
  }
  function isDirtySheet() {
    return !!sheetBaseline && sheetSnapshot() !== sheetBaseline;
  }
  function scheduleFocus(selector) {
    clearTimeout(focusTimer);
    var pane = sheet();
    focusTimer = setTimeout(function() {
      if (!pane || !pane.isConnected || !pane.classList.contains("show")) return;
      var input = pane.querySelector(selector);
      if (input) {
        input.focus({ preventScroll: true });
        if (input.setSelectionRange) input.setSelectionRange(input.value.length, input.value.length);
      }
    }, 50);
  }
  function showSheet() {
    var pane = sheet(), main = document.querySelector(".master-container");
    if (!ownsInert && main) {
      mainWasInert = main.inert;
      main.inert = true;
      ownsInert = true;
    }
    pendingLeave = null;
    sheetBaseline = sheetSnapshot();
    pane.querySelector(".rv-discard-prompt").hidden = true;
    pane.inert = false;
    pane.setAttribute("aria-hidden", "false");
    pane.classList.remove("dirty");
    scrim().classList.add("show");
    pane.classList.add("show");
  }
  function showDiscardPrompt(next) {
    if (typeof next === "function") pendingLeave = next;
    var prompt = sheet().querySelector(".rv-discard-prompt");
    prompt.hidden = false;
    prompt.querySelector("[data-rv-continue]").focus();
  }
  var noteBase = "";
  function openSheet(row, fresh) {
    editing = row || null;
    isNew = !!fresh;
    armedEnter = false;
    groupMode = false;
    editingGroup = null;
    groupBase = null;
    sheet().querySelector("#rv-rulefields").hidden = false;
    sheet().querySelector("#rv-grpfields").hidden = true;
    sheet().querySelector("#rv-sheet-tip").textContent = "应用到名单后，点击名单页保存才生效";
    var scope = document.querySelector(".rule-menu button.active span");
    sheet().querySelector("#rv-sheet-title").textContent = fresh ? "新增规则" : "编辑规则";
    sheet().querySelector("#rv-sheet-scope").textContent = scope ? scope.textContent : "名单";
    sheet().querySelector("#rv-del").style.display = fresh ? "none" : "";
    sheetOff = !!(row && row.off);
    rawMode = fresh ? !!rawTags[activeTag()] : !!row && row.kind === "raw";
    sheet().querySelector("#rv-type").closest(".rv-field").hidden = !!rawTags[activeTag()];
    if (rawMode) {
      Array.prototype.forEach.call(sheet().querySelectorAll("#rv-type button"), function(b) {
        b.classList.remove("on", "pop");
      });
      sheet().dataset.note = "";
    } else {
      setType(fresh || !row || row.type === "raw" || row.type === "comment" ? defaultType() : row.type);
    }
    sheet().querySelector("#rv-value").value = fresh ? "" : row.value || "";
    noteBase = fresh ? "" : prevNote(row).text;
    sheet().querySelector("#rv-note").value = noteBase;
    buildGroups();
    fillGroupSelect(row, fresh);
    sheet().querySelector("#rv-group").onchange = function() {
      sheet().classList.toggle("dirty", isDirtySheet());
    };
    sheet().classList.remove("dirty");
    paint();
    sheetBack = forgetTrigger();
    showSheet();
    scheduleFocus("#rv-value");
  }
  function paintGroupRole(role) {
    groupRole = role;
    var box = sheet().querySelector("#rv-grp-role");
    if (box) Array.prototype.forEach.call(box.querySelectorAll("button"), function(b) {
      b.classList.toggle("on", b.dataset.r === role);
    });
    var tf = sheet().querySelector("#rv-grp-title").closest(".rv-field");
    if (tf) {
      var lab = tf.querySelector("label").childNodes[0];
      if (lab) lab.nodeValue = role === "title" ? "标题" : role === "doc" ? "说明" : "备注";
    }
    var nf = sheet().querySelector("#rv-grp-notes") ? sheet().querySelector("#rv-grp-notes").closest(".rv-field") : null;
    if (nf) nf.hidden = role !== "title";
    var hint2 = sheet().querySelector("#rv-grp-hint");
    if (hint2) {
      hint2.textContent = role === "title" ? "标题下面（直到下一个标题或空行）的规则都算这一组" : role === "doc" ? "谁都不领养：下面的规则还是单着的，照常一行一条" : "贴到下面第一条规则上，在那条规则面板的「备注」里也能看到";
    }
  }
  function openGroupSheet(g) {
    groupMode = true;
    editingGroup = g || null;
    editing = null;
    isNew = false;
    armedEnter = false;
    rawMode = false;
    var docOnly = !!(g && g.docOnly);
    var scope = document.querySelector(".rule-menu button.active span");
    var lines = g ? g.lines : [];
    var title = g ? stripTitlePrefix(groupTitle(g)) : "";
    var notes = g ? g.notes.map(function(n) {
      return String(n.value || "").trim();
    }).filter(Boolean).join("\n") : "";
    groupBase = { title, notes };
    var role0 = docOnly ? "doc" : g && g.title && g.title.role ? g.title.role : "title";
    if (role0 === "gnote") role0 = "title";
    groupRole = role0;
    sheet().querySelector("#rv-sheet-title").textContent = docOnly ? "编辑说明" : g ? "编辑标题与注释" : "新增标题";
    sheet().querySelector("#rv-sheet-scope").textContent = (scope ? scope.textContent : "名单") + (docOnly ? " · 名单说明" : g ? " · " + (g.children.length ? g.children.length + " 条规则" : "暂无规则") : "");
    sheet().querySelector("#rv-sheet-tip").textContent = "这行 # 的角色、文字都可以直接改";
    sheet().querySelector("#rv-del").style.display = g ? "" : "none";
    sheet().querySelector("#rv-rulefields").hidden = true;
    sheet().querySelector("#rv-grpfields").hidden = false;
    paintGroupRole(role0);
    sheet().querySelector("#rv-grp-title").value = title;
    sheet().querySelector("#rv-grp-notes").value = notes;
    sheet().querySelector("#rv-grp-hint").textContent = g ? "标题写成一行 #，注释写成 # 注释：… ；这一组下面已经有 " + g.children.length + " 条规则，保存后仍留在这个标题下" : "标题写成一行 #，注释写成 # 注释：… ；它下面的规则（直到下一个标题或空行）都算这一组";
    sheet().classList.remove("dirty");
    sheet().querySelector("#rv-grp-title").oninput = function() {
      sheet().classList.toggle("dirty", isDirtySheet());
    };
    sheet().querySelector("#rv-grp-notes").oninput = function() {
      sheet().classList.toggle("dirty", isDirtySheet());
    };
    sheet().querySelector("#rv-grp-role").onclick = function(e) {
      var b = e.target.closest("button");
      if (!b) return;
      paintGroupRole(b.dataset.r);
      sheet().classList.toggle("dirty", isDirtySheet());
    };
    sheet().querySelector("#rv-grp-title").onkeydown = function(e) {
      if (!e.isComposing && e.keyCode !== 229 && e.key === "Enter") {
        e.preventDefault();
        commit();
      }
    };
    sheet().querySelector("#rv-grp-notes").onkeydown = function(e) {
      if (!e.isComposing && e.keyCode !== 229 && e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        commit();
      }
    };
    sheetBack = forgetTrigger();
    showSheet();
    scheduleFocus("#rv-grp-title");
  }
  function closeSheet(force) {
    var pane = sheet();
    if (!pane) return true;
    if (!force && isDirtySheet()) {
      showDiscardPrompt();
      return false;
    }
    clearTimeout(focusTimer);
    pendingLeave = null;
    sheetBaseline = "";
    if (scrim()) scrim().classList.remove("show");
    pane.classList.remove("show", "dirty");
    pane.inert = true;
    pane.setAttribute("aria-hidden", "true");
    pane.querySelector(".rv-discard-prompt").hidden = true;
    var main = document.querySelector(".master-container");
    if (ownsInert && main) main.inert = mainWasInert;
    ownsInert = false;
    editing = null;
    isNew = false;
    rawMode = false;
    sheetOff = false;
    groupMode = false;
    editingGroup = null;
    groupBase = null;
    if (sheetBack && sheetBack.isConnected && sheetBack.offsetParent !== null) {
      try {
        sheetBack.focus({ preventScroll: true });
      } catch (e) {
      }
    }
    sheetBack = null;
    return true;
  }
  function closeNewMenu() {
    if (menuPop) menuPop.hidden = true;
    if (menuBtn) menuBtn.setAttribute("aria-expanded", "false");
  }
  var globalBound = false;
  function bindGlobal() {
    if (globalBound) return;
    globalBound = true;
    lifecycle.listen(document, "keydown", function(e) {
      if (!root || !root.isConnected) return;
      if (e.isComposing || e.keyCode === 229) return;
      var nativeDialog = document.querySelector("dialog[open]");
      if (nativeDialog) {
        if (nativeDialog.id === "rp-wrap" && (e.ctrlKey || e.metaKey) && String(e.key).toLowerCase() === "s") {
          e.preventDefault();
          doPaste();
        }
        return;
      }
      if (e.key === "Escape") {
        if (sheetEl && sheetEl.classList.contains("show")) {
          e.preventDefault();
          e.stopPropagation();
          closeSheet();
          return;
        }
        if (rowMenuEl) {
          closeRowMenu();
          return;
        }
        if (menuPop && !menuPop.hidden) {
          closeNewMenu();
          return;
        }
        var wrap = document.getElementById("rp-wrap");
        if (wrap && wrap.open) {
          e.preventDefault();
          closePaste();
          return;
        }
        if (sel.length) {
          sel = [];
          renderList();
          return;
        }
        var qb = root && root.querySelector("#rv-q");
        if (qb && qb.value) {
          q = "";
          qb.value = "";
          paintSearch();
          renderList();
        }
        return;
      }
      if (!(e.ctrlKey || e.metaKey)) return;
      var k = String(e.key || "").toLowerCase();
      if (k === "s") {
        e.preventDefault();
        if (sheetEl && sheetEl.classList.contains("show")) commit();
        else if (saveBtn) saveBtn.click();
        return;
      }
      if (sheetEl && sheetEl.classList.contains("show")) return;
      if (view === "raw" && e.target === ta) return;
      if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) return;
      if (k === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (k === "z" && e.shiftKey || k === "y") {
        e.preventDefault();
        redo();
      }
    });
    lifecycle.listen(document, "click", function(e) {
      if (rowMenuEl && !e.target.closest(".rv-menu-float") && !e.target.closest("[data-act=group]") && !e.target.closest("[data-act=role]")) closeRowMenu();
      if (!menuPop || menuPop.hidden) return;
      if (e.target.closest && (e.target.closest("#rv-newmenu") || e.target.closest("#rv-new"))) return;
      closeNewMenu();
    });
  }
  function forgetTrigger() {
    var el = lastTrigger && document.body.contains(lastTrigger) && lastTrigger.offsetParent !== null ? lastTrigger : document.activeElement;
    lastTrigger = null;
    return el;
  }
  function recognize() {
    var inp = sheet().querySelector("#rv-value"), raw = inp.value, s = String(raw).replace(/[\r\n]+/g, " ").trim();
    var off = false, hit = null, m, changed = false;
    if (/^#\s*/.test(s)) {
      off = true;
      sheetOff = true;
      s = s.replace(/^#\s*/, "").trim();
      changed = true;
    }
    m = s.match(PREFIX_RE);
    if (rawMode && (!m || rawTags[activeTag()])) {
      if (s !== raw.trim()) {
        inp.value = s;
        changed = true;
      }
      paint();
      return changed;
    }
    if (m) {
      hit = m[1].toLowerCase();
      s = s.slice(m[0].length).trim();
      changed = true;
      rawMode = false;
    }
    if (s !== raw.trim()) {
      inp.value = s;
      changed = true;
    }
    var t = hit || curType(), notes = [];
    if (hit) notes.push("已按前缀 " + hit + ": 识别");
    if (off) notes.push("原行是注释，按停用处理");
    if (!valid(s, t)) {
      if (REGEX_CHAR_RE.test(s)) {
        t = "regexp";
        notes.push("看起来是正则");
      } else if (HOST_RE.test(s)) {
        t = "domain";
        notes.push("看起来是域名");
      } else if (s) {
        t = "keyword";
        notes.push("不是域名形态");
      }
      changed = true;
    }
    if (t !== curType()) {
      setType(t, notes.join(" · "));
      changed = true;
    } else if (notes.length) setType(t, notes.join(" · "));
    paint();
    return changed;
  }
  function commit() {
    if (groupMode) {
      commitGroup();
      return;
    }
    var input = sheet().querySelector("#rv-value").value;
    if (/^\s*#/.test(input) || PREFIX_RE.test(input)) recognize();
    var v = sheet().querySelector("#rv-value").value.trim(), t = curType();
    var note = sheet().querySelector("#rv-note").value.trim();
    var wasRaw = rawMode;
    if (!rawMode && !valid(v, t)) {
      paint();
      sheet().querySelector("#rv-value").focus();
      say(errText(t));
      return;
    }
    if (rawMode && !v) {
      say("内容不能为空");
      sheet().querySelector("#rv-value").focus();
      return;
    }
    var target;
    if (isNew) {
      var dup = rows.some(function(r) {
        return (r.kind === "rule" || r.kind === "raw") && r.value === v && r.type === (rawMode ? "raw" : t);
      });
      if (dup) {
        say("列表里已经有这条：" + (PREFIX[t] || "") + v);
        sheet().querySelector("#rv-value").focus();
        return;
      }
      target = { id: "r" + ++seq, kind: rawMode ? "raw" : "rule", type: rawMode ? "raw" : t, value: v, off: sheetOff, touched: true };
      rows.push(target);
    } else if (editing) {
      if (rawMode) {
        editing.type = "raw";
        editing.value = v;
        editing.kind = "raw";
      } else {
        editing.type = t;
        editing.value = v;
        editing.kind = "rule";
      }
      editing.off = sheetOff;
      editing.touched = true;
      target = editing;
    }
    var movedMsg = "";
    if (target) {
      applyNote(target, note);
      var gid = sheet().querySelector("#rv-group") ? sheet().querySelector("#rv-group").value : "";
      buildGroups();
      var moved = moveToGroup(target, gid);
      if (moved) movedMsg = gid ? "已放进「" + stripTitlePrefix(groupTitle(groupById(gid))) + "」" : "已从分组里移出来";
    }
    writeBack();
    closeSheet(true);
    renderList();
    say(movedMsg || "已写入列表：" + (wasRaw ? v : PREFIX[t] + v) + "（记得点保存）");
  }
  function applyNote(target, note) {
    var pn = prevNote(target);
    if (note) {
      if (pn.idx >= 0) {
        rows[pn.idx].value = "备注：" + note;
        rows[pn.idx].touched = true;
      } else {
        var at = rows.indexOf(target);
        rows.splice(at, 0, { id: "r" + ++seq, kind: "comment", type: "comment", value: "备注：" + note, off: true, touched: true });
      }
    } else if (pn.idx >= 0) rows.splice(pn.idx, 1);
  }
  function build(editor, textarea, save) {
    ta = textarea;
    saveBtn = save;
    view = "list";
    var host = document.createElement("div");
    host.className = "rv";
    host.id = "rv-root";
    setHTML(host, '<div class="rv-toolbar"><label class="rv-search">' + ICON.search + '<input id="rv-q" placeholder="搜索内容或类型" autocomplete="off"><button type="button" class="rv-search-x" id="rv-qx" title="清空搜索" hidden><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6"/></svg></button></label><span class="rv-new-wrap"><button class="button small" id="rv-new" aria-haspopup="menu" aria-expanded="false">' + ICON.plus + '新增<span class="rv-caret"></span></button><span class="rv-menu-pop" id="rv-newmenu" role="menu" hidden><button type="button" role="menuitem" data-new="rule">新增规则<span class="k">按类型加一条</span></button><button type="button" role="menuitem" data-new="group">新增标题<span class="k">给一组规则起个小标题</span></button><button type="button" role="menuitem" data-new="paste">批量粘贴<span class="k">一行一条，重复自动跳过</span></button></span></span><button class="button small ghost" id="rv-all">全选</button><button class="button small ghost" id="rv-undo" title="撤销 Ctrl+Z" disabled>撤销</button><button class="button small ghost" id="rv-redo" title="重做 Ctrl+Shift+Z" disabled>重做</button><button class="button small ghost" id="rv-mode">原文</button></div><div class="rv-list"></div><div class="rv-selbar" hidden><span class="n">已选 <b>0</b> 条</span><button class="button small" data-bulk="on">批量启用</button><button class="button small" data-bulk="off">批量停用</button><span class="grow"></span><button class="button small ghost" data-bulk="clear">取消选择</button><button class="button small danger" data-bulk="del">删除</button></div>');
    editor.insertBefore(host, textarea);
    textarea.style.display = "none";
    root = host;
    rows = parse(textarea.value);
    sel = [];
    q = "";
    dirty = false;
    savedText = textarea.dataset && textarea.dataset.original !== void 0 ? textarea.dataset.original : textarea.value;
    hist = [textarea.value];
    histAt = 0;
    paintHist();
    dirty = textarea.value !== savedText;
    if (saveBtn) saveBtn.classList.toggle("rv-has-dirty", dirty);
    root.querySelector("#rv-undo").onclick = undo;
    root.querySelector("#rv-redo").onclick = redo;
    var qBox = root.querySelector("#rv-q");
    qBox.oninput = function(e) {
      q = e.target.value;
      paintSearch();
      renderList();
    };
    root.querySelector("#rv-qx").onclick = function(e) {
      e.preventDefault();
      e.stopPropagation();
      q = "";
      qBox.value = "";
      paintSearch();
      renderList();
      qBox.focus();
    };
    var newBtn = root.querySelector("#rv-new"), newMenu = root.querySelector("#rv-newmenu");
    menuBtn = newBtn;
    menuPop = newMenu;
    newBtn.onclick = function(e) {
      e.stopPropagation();
      newMenu.hidden = !newMenu.hidden;
      newBtn.setAttribute("aria-expanded", newMenu.hidden ? "false" : "true");
      if (!newMenu.hidden) {
        var first = newMenu.querySelector("button");
        if (first) first.focus();
      }
    };
    newMenu.onclick = function(e) {
      var b = e.target.closest("button[data-new]");
      if (!b) return;
      closeNewMenu();
      lastTrigger = newBtn;
      if (b.dataset.new === "rule") openSheet(null, true);
      else if (b.dataset.new === "group") openGroupSheet(null);
      else openPaste();
    };
    newMenu.onkeydown = function(e) {
      if (e.key === "Escape") {
        closeNewMenu();
        newBtn.focus();
      }
    };
    root.querySelector("#rv-all").onclick = function() {
      var vis = selectableRows(), all = allSelected();
      vis.forEach(function(r) {
        if (all) sel = sel.filter(function(x) {
          return x !== r.id;
        });
        else if (sel.indexOf(r.id) < 0) sel.push(r.id);
      });
      renderList();
    };
    root.querySelector("#rv-mode").onclick = function() {
      var raw = !root.classList.contains("raw");
      view = raw ? "raw" : "list";
      root.classList.toggle("raw", raw);
      textarea.style.display = raw ? "" : "none";
      if (!raw) {
        rows = parse(textarea.value);
        sel = [];
        q = "";
        var qBox2 = root.querySelector("#rv-q");
        if (qBox2) qBox2.value = "";
        paintSearch();
        dirty = textarea.value !== savedText;
        commitHist(textarea.value);
        renderList();
        renderStat();
      }
      if (raw) {
        var lh = root.querySelector(".rv-list").getBoundingClientRect().height;
        textarea.style.height = Math.max(300, Math.round(lh || 420)) + "px";
        textarea.focus();
      }
      this.textContent = raw ? "列表" : "原文";
    };
    Array.prototype.forEach.call(root.querySelectorAll("[data-bulk]"), function(b) {
      b.onclick = function() {
        var act = b.dataset.bulk, n = sel.length;
        if (act === "clear") {
          sel = [];
          renderList();
          return;
        }
        if (!n) return;
        if (act === "del" && !window.confirm("删除选中的 " + n + " 条规则？")) return;
        if (act === "del") rows = rows.filter(function(r) {
          return sel.indexOf(r.id) < 0;
        });
        else rows.forEach(function(r) {
          if (sel.indexOf(r.id) < 0) return;
          if (r.kind === "comment" || r.kind === "blank" || r.kind === "sep") return;
          r.off = act === "off";
          r.touched = true;
        });
        sel = [];
        writeBack();
        renderList();
        say(act === "del" ? "已删除 " + n + " 条" : (act === "off" ? "已停用 " : "已启用 ") + n + " 条");
      };
    });
    renderList();
    fitList();
    Array.prototype.forEach.call(document.querySelectorAll("#rv-scrim, #rv-sheet"), function(n) {
      if (n.parentNode) n.parentNode.removeChild(n);
    });
    insertHTML(document.body, "beforeend", '<div class="rv-scrim" id="rv-scrim"></div><aside class="rv-sheet" id="rv-sheet" role="dialog" aria-modal="true" aria-labelledby="rv-sheet-title" tabindex="-1"><div class="rv-sheet-head"><div><h2 id="rv-sheet-title">编辑规则</h2><div class="rv-sub"><span id="rv-sheet-scope">名单</span><span class="rv-sep"></span><span id="rv-sheet-tip">回车识别类型，再回车保存</span><span class="rv-dot"></span></div></div><div class="rv-sheet-tools"><button class="rv-x del" id="rv-del" title="删除这条">' + ICON.del + '</button><button class="rv-x" id="rv-close" title="关闭"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6"/></svg></button></div></div><section class="rv-discard-prompt" role="alert" hidden><p>修改尚未应用到名单。要放弃这次编辑吗？</p><div><button type="button" class="button small" data-rv-continue>继续编辑</button><button type="button" class="button small" data-rv-discard>放弃修改</button></div></section><div class="rv-fields" id="rv-rulefields"><div class="rv-field"><label>规则类型<span class="rv-lh">可粘贴整行，回车后自动识别</span></label><div class="rv-seg" id="rv-type"><button type="button" data-t="domain" class="on">域名（含子域）</button><button type="button" data-t="full">完整域名</button><button type="button" data-t="keyword">关键字</button><button type="button" data-t="regexp">正则</button></div></div><div class="rv-field"><label id="rv-value-label" for="rv-value">域名</label><input class="rv-inp" id="rv-value" spellcheck="false" autocomplete="off"><div class="rv-hint" id="rv-hint"></div></div><div class="rv-field"><label for="rv-note">备注<span class="rv-lh">可留空 · 存成「# 备注：…」贴在规则上一行，只对这条生效</span></label><input class="rv-inp" id="rv-note" placeholder="一句话说明，可留空" autocomplete="off"></div><div class="rv-field"><label for="rv-group">分组<span class="rv-lh">放进某个标题下面，或者移出来单着</span></label><select class="rv-inp" id="rv-group"></select><div class="rv-hint" id="rv-group-hint"></div></div></div><div class="rv-fields" id="rv-grpfields" hidden><div class="rv-field"><label>这一行是<span class="rv-lh">标题=领养下面的规则 · 名单说明=谁都不领养 · 规则备注=贴到下面第一条规则上</span></label><div class="rv-seg" id="rv-grp-role"><button type="button" data-r="title">标题</button><button type="button" data-r="doc">名单说明</button><button type="button" data-r="note">规则备注</button></div></div><div class="rv-field"><label for="rv-grp-title">标题<span class="rv-lh">名单里的裸 # 行就是标题，下面的规则都归到它</span></label><input class="rv-inp" id="rv-grp-title" placeholder="例如 腾讯CDN (smtcdns.com - 48-char hex)" autocomplete="off"></div><div class="rv-field"><label for="rv-grp-notes">注释<span class="rv-lh">可留空 · 一行一条，存成 # 注释：… 这种带前缀的注释行</span></label><textarea class="rv-inp rv-area" id="rv-grp-notes" rows="3" spellcheck="false" placeholder="例如 注意: 已将长度修正为精确的 {59}"></textarea><div class="rv-hint" id="rv-grp-hint">保存后这一组下面已有的规则不变，仍由它们的位置决定</div></div></div><div class="rv-foot"><button class="button primary" id="rv-ok">应用到名单</button><button class="button" id="rv-cancel">取消</button></div></aside>');
    scrimEl = document.getElementById("rv-scrim");
    sheetEl = document.getElementById("rv-sheet");
    var sv = sheetEl;
    sv.inert = true;
    sv.setAttribute("aria-hidden", "true");
    sv.querySelector("#rv-value").setAttribute("aria-describedby", "rv-hint");
    sv.querySelector("[data-rv-continue]").onclick = function() {
      finishLeave(false);
      pendingLeave = null;
      sv.querySelector(".rv-discard-prompt").hidden = true;
      scheduleFocus(groupMode ? "#rv-grp-title" : "#rv-value");
    };
    sv.querySelector("[data-rv-discard]").onclick = function() {
      var next = pendingLeave;
      closeSheet(true);
      if (next) next();
    };
    sv.querySelector("#rv-type").onclick = function(e) {
      var b = e.target.closest("button");
      if (!b) return;
      rawMode = false;
      setType(b.dataset.t, "");
      paint();
      sv.querySelector("#rv-value").focus();
    };
    sv.querySelector("#rv-value").addEventListener("input", function() {
      armedEnter = false;
      paint();
    });
    sv.querySelector("#rv-note").addEventListener("input", function() {
      paint();
    });
    sv.querySelector("#rv-note").addEventListener("keydown", function(e) {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === "Enter") {
        e.preventDefault();
        commit();
      }
    });
    sv.querySelector("#rv-value").addEventListener("keydown", function(e) {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key !== "Enter") return;
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        commit();
        return;
      }
      if (armedEnter || !recognize()) {
        armedEnter = false;
        commit();
      } else {
        armedEnter = true;
        hint("已识别为「" + (rawMode ? "原文" : NAME[curType()]) + '」 · <span class="mono">' + esc2(linePreview()) + "</span> · 再按一次回车应用到名单", "hit");
      }
    });
    sv.querySelector("#rv-ok").onclick = commit;
    sv.querySelector("#rv-cancel").onclick = function() {
      closeSheet();
    };
    sv.querySelector("#rv-close").onclick = function() {
      closeSheet();
    };
    sv.querySelector("#rv-del").onclick = function() {
      if (groupMode) {
        var g = editingGroup;
        if (!g) {
          closeSheet(true);
          return;
        }
        dropGroup(g);
        return;
      }
      var r = editing;
      if (!r) return;
      if (!window.confirm("删除这条规则？\n" + lineOf(r))) return;
      closeSheet(true);
      dropRow(r, true);
    };
    scrimEl.onclick = function() {
      closeSheet();
    };
    sv.addEventListener("keydown", function(e) {
      if (e.key !== "Tab") return;
      var f = sv.querySelectorAll("button, input, textarea, select");
      var list = Array.prototype.filter.call(f, function(x) {
        return !x.disabled && x.offsetParent !== null;
      });
      if (!list.length) return;
      var first = list[0], last = list[list.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    });
    hookSaved();
    if (save) save.addEventListener("click", function() {
      lifecycle.timeout(hookSaved, 400);
    });
    var rawTimer = null;
    textarea.addEventListener("input", function() {
      if (view !== "raw") return;
      setDirty(textarea.value !== savedText);
      rawTimer == null ? void 0 : rawTimer();
      rawTimer = lifecycle.timeout(function() {
        if (ta === textarea && textarea.isConnected) commitHist(textarea.value);
      }, 600);
    });
  }
  function enhance() {
    hookSaved();
    var editor = document.querySelector(".rule-editor");
    var textarea = document.getElementById("rule-text");
    if (!editor || !textarea || textarea.dataset.original === void 0 || document.getElementById("rv-root")) return;
    build(editor, textarea, document.getElementById("rule-save"));
  }
  function decorate() {
    var editor = document.querySelector(".rule-editor");
    if (!editor || !document.getElementById("rv-root")) return;
    var head = editor.querySelector(".section-header");
    if (head) {
      var bar = root.querySelector(".rv-toolbar");
      var acts = head.querySelector(".section-header-actions");
      if (bar && acts) bar.appendChild(acts);
      var state2 = editor.querySelector(".console-rule-state");
      if (bar && state2) bar.appendChild(state2);
      head.remove();
      var stat = root.querySelector("#rv-stat");
      if (stat && !stat.title) stat.title = "左边拖动可排序 · 每行开关单独启停 · 点域名或铅笔打开编辑";
    }
    var foot = editor.querySelector(".rule-editor-footer");
    if (foot) {
      var st = document.getElementById("rv-stat");
      if (!st) {
        st = document.createElement("span");
        st.id = "rv-stat";
        st.className = "rv-stat";
      }
      if (st.parentNode !== foot) foot.appendChild(st);
      renderStat();
    }
    var dl = document.getElementById("rule-download");
    if (dl && dl.dataset.rvRenamed !== "1") {
      dl.dataset.rvRenamed = "1";
      setHTML(dl, dl.innerHTML.replace(/下载列表/, "导出"));
    }
    if (dl) dl.classList.add("rv-ghost");
    loadCounts();
  }
  function paintCounts() {
  }
  function loadCounts() {
  }
  function openPaste() {
    var wrap = document.getElementById("rp-wrap");
    if (!wrap) {
      insertHTML(document.body, "beforeend", '<dialog class="rp-wrap" id="rp-wrap" aria-label="批量粘贴"><div class="rp-panel"><h2>批量粘贴</h2><p>一行一条，可直接贴线上原文（支持 domain: / full: / keyword: / regexp: 前缀，<code>#</code> 开头按停用）；与现有规则重复的会自动跳过。</p><textarea id="rp-text" aria-label="批量规则原文" spellcheck="false" placeholder="domain:example.com&#10;full:stun.l.google.com&#10;keyword:kaspersky"></textarea><div class="rp-foot"><button class="button primary" id="rp-ok">追加到列表</button><button class="button" id="rp-cancel">取消</button><span class="grow"></span><span class="rp-note" id="rp-note"></span></div></div></dialog>');
      wrap = document.getElementById("rp-wrap");
      wrap.addEventListener("click", function(e) {
        if (e.target === wrap) closePaste();
      });
      wrap.querySelector("#rp-text").addEventListener("input", pastePreview);
      wrap.querySelector("#rp-cancel").onclick = closePaste;
      wrap.querySelector("#rp-ok").onclick = doPaste;
    }
    if (!wrap.open) wrap.showModal();
    var t = wrap.querySelector("#rp-text");
    t.value = "";
    pastePreview();
    t.focus();
  }
  function parsePaste(text2) {
    return parse(text2).filter(function(r) {
      return r.kind !== "blank";
    });
  }
  function closePaste() {
    var wrap = document.getElementById("rp-wrap");
    if (wrap && wrap.open) wrap.close();
  }
  function pastedRows() {
    var input = document.getElementById("rp-text"), list = parsePaste(input ? input.value : ""), seen2 = /* @__PURE__ */ new Set();
    function key(r) {
      return r.kind + "|" + r.type + "|" + r.value;
    }
    rows.forEach(function(r) {
      if (r.kind === "rule" || r.kind === "raw") seen2.add(key(r));
    });
    var unique = list.filter(function(r) {
      if (r.kind !== "rule" && r.kind !== "raw") return true;
      var k = key(r);
      if (seen2.has(k)) return false;
      seen2.add(k);
      return true;
    });
    return { rows: unique, duplicates: list.length - unique.length };
  }
  function pastePreview() {
    var result = pastedRows(), label = document.getElementById("rp-note");
    label.textContent = result.rows.length || result.duplicates ? "将追加 " + result.rows.length + " 行" + (result.duplicates ? " · 跳过重复 " + result.duplicates + " 条规则" : "") : "";
  }
  function doPaste() {
    var result = pastedRows();
    if (!result.rows.length) {
      closePaste();
      say("没有可追加的内容");
      return;
    }
    rows = rows.concat(result.rows);
    writeBack();
    renderList();
    closePaste();
    say("已追加 " + result.rows.length + " 行（记得点保存）");
  }
  function canLeave(next) {
    if (!root || !root.isConnected) return true;
    if (sheetEl && sheetEl.classList.contains("show")) {
      if (isDirtySheet()) {
        showDiscardPrompt(next);
        return false;
      }
      closeSheet(true);
    }
    var paste = document.getElementById("rp-wrap");
    if (paste && paste.open) {
      if (paste.querySelector("#rp-text").value.trim() && !confirm("批量粘贴尚未加入名单，放弃并离开吗？")) return false;
      closePaste();
    }
    return true;
  }
  function tick() {
    if (root && !document.body.contains(root)) {
      if (sheetEl && sheetEl.classList.contains("show")) {
        try {
          closeSheet(true);
        } catch (e) {
        }
      }
      closePaste();
      var paste = document.getElementById("rp-wrap");
      if (paste) paste.remove();
      sheetEl = scrimEl = null;
      try {
        closeRowMenu();
        closeNewMenu();
      } catch (e) {
      }
    }
    Array.prototype.forEach.call(document.querySelectorAll("#rv-scrim, #rv-sheet"), function(n) {
      if (!n.classList.contains("show") && (!root || !document.body.contains(root))) n.remove();
    });
    enhance();
    decorate();
  }
  function fitList() {
    var list = root && root.querySelector(".rv-list");
    if (!list) return;
    var top = list.getBoundingClientRect().top + window.scrollY;
    var avail = Math.round(window.innerHeight - top - 56);
    if (avail < 200) avail = 200;
    if (avail > 660) avail = 660;
    if (Math.abs(avail - list.getBoundingClientRect().height) > 4) list.style.height = avail + "px";
  }
  function beforeUnload(e) {
    var paste = document.getElementById("rp-wrap");
    if (sheetEl && sheetEl.classList.contains("show") && isDirtySheet() || paste && paste.open && paste.querySelector("#rp-text").value.trim()) {
      e.preventDefault();
      e.returnValue = "";
    }
  }
  rulesWorkbenchService = { mount: mount2, requestLeave: requestLeave2, canLeave, refreshText: function() {
    if (!ta || !ta.isConnected || !root || !root.isConnected) return;
    rows = parse(ta.value);
    sel = [];
    q = "";
    var query = root.querySelector("#rv-q");
    if (query) query.value = "";
    commitHist(ta.value);
    setDirty(ta.value !== savedText);
    syncSiteState();
    renderList();
    paintSearch();
  } };
}
function playViewEnter() {
  if (reduceMotion.matches) return;
  page.classList.remove("view-enter");
  void page.offsetWidth;
  page.classList.add("view-enter");
  setTimeout(() => page.classList.remove("view-enter"), 1050);
}
function animateCountUps(root) {
  var _a2;
  (_a2 = shellInterfaceService == null ? void 0 : shellInterfaceService.displayNumerals) == null ? void 0 : _a2.call(shellInterfaceService);
  if (reduceMotion.matches) return;
  root.querySelectorAll(".sk-val").forEach((el) => {
    const numEl = el.querySelector(".display-number");
    if (!numEl) return;
    const numText = numEl.textContent.trim();
    const target = parseFloat(numText.replace(/,/g, ""));
    if (!isFinite(target) || target <= 0) return;
    const decimals = (numText.split(".")[1] || "").length, grouped = numText.includes(",");
    const fmtNum = (v) => {
      const num2 = decimals ? Number(v.toFixed(decimals)) : Math.round(v);
      return grouped ? num2.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) : num2.toFixed(decimals);
    };
    const t0 = performance.now(), dur = 560;
    const step = (now) => {
      if (!numEl.isConnected) return;
      if (reduceMotion.matches) {
        numEl.textContent = numText;
        return;
      }
      const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      numEl.textContent = fmtNum(target * e);
      if (k < 1) requestAnimationFrame(step);
      else {
        numEl.textContent = numText;
        el.classList.add("is-bumping");
        setTimeout(() => el.classList.remove("is-bumping"), 520);
      }
    };
    numEl.textContent = fmtNum(0);
    requestAnimationFrame(step);
  });
}
function syncSegThumb(group) {
  const active2 = group.querySelector(".seg-item.active");
  let thumb = group.querySelector(":scope > .seg-thumb");
  if (!active2) {
    if (thumb) thumb.remove();
    return;
  }
  if (!thumb) {
    thumb = document.createElement("span");
    thumb.className = "seg-thumb";
    thumb.setAttribute("aria-hidden", "true");
    group.prepend(thumb);
  }
  thumb.style.width = active2.offsetWidth + "px";
  thumb.style.height = active2.offsetHeight + "px";
  thumb.style.transform = `translate(${active2.offsetLeft}px, ${active2.offsetTop}px)`;
}
function syncAllSegThumbs() {
  document.querySelectorAll(".seg-group").forEach(syncSegThumb);
}
async function copyToClipboard(text2) {
  var _a2;
  try {
    if ((_a2 = navigator.clipboard) == null ? void 0 : _a2.writeText) {
      await navigator.clipboard.writeText(text2);
      return true;
    }
  } catch {
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text2;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}
function downloadBlob(name, blob) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 100);
}
function downloadText(name, text2) {
  downloadBlob(name, new Blob([text2], { type: "text/plain;charset=utf-8" }));
}
function navHtml() {
  return `
      <div class="nav-group">
        <div class="nav-group-head"><span>活动</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></div>
        <div class="nav-items">
          <button type="button" class="nav-item active" data-route="overview">
            <svg viewBox="0 0 24 24" fill="none" stroke="#3B82F6" stroke-width="2" aria-hidden="true"><path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2Zm0 14a4 4 0 1 1 4-4 4 4 0 0 1-4 4Z"/></svg>
            <span>运行概览</span>
          </button>
        </div>
      </div>

      <div class="nav-group">
        <div class="nav-group-head"><span>观测</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></div>
        <div class="nav-items">
          <button type="button" class="nav-item" data-route="logs">
            <svg viewBox="0 0 24 24" fill="none" stroke="#14B8A6" stroke-width="2" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h10"/></svg>
            <span>查询日志</span>
          </button>
        </div>
      </div>

      <div class="nav-group">
        <div class="nav-group-head"><span>路由</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></div>
        <div class="nav-items">
          <button type="button" class="nav-item" data-route="upstreams">
            <svg viewBox="0 0 24 24" fill="none" stroke="#60A5FA" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3.6 9h16.8M3.6 15h16.8M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/></svg>
            <span>DNS 管理</span>
          </button>
          <button type="button" class="nav-item" data-route="rules">
            <svg viewBox="0 0 24 24" fill="none" stroke="#10B981" stroke-width="2" aria-hidden="true"><path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/></svg>
            <span>规则管理</span>
          </button>
        </div>
      </div>

      <div class="nav-group">
        <div class="nav-group-head"><span>设置</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></div>
        <div class="nav-items">
          <button type="button" class="nav-item" data-route="management">
            <svg viewBox="0 0 24 24" fill="none" stroke="#F59E0B" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0-4h-.09a1.65 1.65 0 0 0-1.51 1Z"/></svg>
            <span>系统管理</span>
          </button>
        </div>
      </div>`;
}
function fitRuleLayoutHeight() {
  const layout = $(".rule-layout");
  if (!layout) return;
  if (window.innerWidth <= 900) {
    layout.style.removeProperty("height");
    layout.style.removeProperty("min-height");
    return;
  }
  const top = layout.getBoundingClientRect().top;
  const available = Math.max(500, Math.floor(window.innerHeight - top - 28));
  layout.style.height = `${available}px`;
  layout.style.minHeight = "0";
}
function initShell() {
  document.title = CONFIG.title;
  setHTML($("#side-nav"), navHtml());
  const mobile = [["overview", "overview", "概览"], ["logs", "logs", "日志"], ["upstreams", "upstream", "DNS"], ["rules", "rules", "规则"], ["management", "management", "管理"]];
  setHTML($("#mobile-nav"), mobile.map(([r, i, l]) => `<button data-route="${r}">${icon$1(i)}<span>${l}</span></button>`).join(""));
  setHTML($("#theme-toggle"), icon$1("theme"));
  setHTML($("#refresh-button"), icon$1("refresh"));
  setHTML($("#restart-button"), icon$1("power"));
  setHTML($("#drawer-close"), icon$1("close"));
  $$("#modal .icon-button").forEach((x) => setHTML(x, icon$1("close")));
  shellInterfaceService == null ? void 0 : shellInterfaceService.updateBrand();
  typographyService == null ? void 0 : typographyService.setup();
  proxyPanelService == null ? void 0 : proxyPanelService.setup({ notify: toast });
  const wpLayer = $("#wallpaper-layer");
  const pop = $("#bg-customizer-popover");
  const openBtn = $("#btn-open-bg-customizer");
  if (wpLayer && pop && openBtn) {
    openBtn.onclick = (e) => {
      e.stopPropagation();
      const isOpen = pop.classList.toggle("open");
      openBtn.setAttribute("aria-expanded", String(isOpen));
    };
    if ($("#btn-close-bg-popover")) {
      $("#btn-close-bg-popover").onclick = () => {
        pop.classList.remove("open");
        openBtn.setAttribute("aria-expanded", "false");
      };
    }
    document.addEventListener("click", (e) => {
      if (!pop.contains(e.target) && !e.target.closest("#btn-open-bg-customizer")) {
        pop.classList.remove("open");
        openBtn.setAttribute("aria-expanded", "false");
      }
    });
    wallpaperService == null ? void 0 : wallpaperService.setup({ notify: toast });
    if ($("#slider-blur")) {
      $("#slider-blur").oninput = (e) => {
        const v = e.target.value;
        document.documentElement.style.setProperty("--glass-blur", `${v}px`);
        $("#val-blur").textContent = `${v}px`;
      };
    }
    if ($("#slider-alpha")) {
      $("#slider-alpha").oninput = (e) => {
        const v = e.target.value;
        document.documentElement.style.setProperty("--glass-alpha", (v / 100).toFixed(2));
        $("#val-alpha").textContent = `${v}%`;
      };
    }
    if ($("#slider-dimmer")) {
      $("#slider-dimmer").oninput = (e) => {
        const v = e.target.value;
        document.documentElement.style.setProperty("--bg-dimmer", (v / 100).toFixed(2));
        $("#val-dimmer").textContent = `${v}%`;
      };
    }
  }
  state.particles = (storage.get("localdns_particles") ?? storage.get("localdns_particles_v2")) !== "false";
  state.particleMotionOverride = storage.get("localdns_particles_motion_override") === "true";
  const partBtn = $("#btn-toggle-particles");
  if (partBtn) {
    const enabled = () => state.particles && (!reduceMotion.matches || state.particleMotionOverride);
    const syncParticles = () => {
      partBtn.classList.toggle("active", enabled());
      partBtn.setAttribute("aria-pressed", String(enabled()));
      const label = reduceMotion.matches && !state.particleMotionOverride ? "拓扑动画已跟随系统减少动态暂停，点击可单独启用" : enabled() ? "关闭拓扑动画" : "开启拓扑动画";
      partBtn.title = label;
      partBtn.setAttribute("aria-label", label);
      const wrap = $("#topo-stage-wrap");
      if (wrap) {
        wrap.classList.toggle("no-particles", !state.particles);
        wrap.classList.toggle("motion-override", state.particleMotionOverride);
        topologyFlowService == null ? void 0 : topologyFlowService.sync();
      }
    };
    partBtn.onclick = () => {
      state.particles = !enabled();
      state.particleMotionOverride = state.particles && reduceMotion.matches;
      storage.set("localdns_particles", String(state.particles));
      storage.set("localdns_particles_motion_override", String(state.particleMotionOverride));
      syncParticles();
    };
    reduceMotion.addEventListener("change", () => {
      state.particleMotionOverride = false;
      storage.set("localdns_particles_motion_override", "false");
      syncParticles();
    });
    syncParticles();
  }
  const searchInput = $("#global-search-input");
  if (searchInput) {
    searchInput.onkeydown = (e) => {
      if (e.key === "Enter") {
        const q = searchInput.value.trim();
        if (["概览", "overview"].includes(q)) return navigate("overview");
        if (["上游", "dns", "upstreams"].includes(q.toLowerCase())) return navigate("upstreams");
        if (["规则", "rules"].includes(q.toLowerCase())) return navigate("rules");
        if (["系统", "管理", "management"].includes(q.toLowerCase())) return navigate("management");
        state.logs.q = q;
        state.logs.page = 1;
        navigate("logs");
      }
    };
  }
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-route]");
    if (!b) return;
    navigate(b.dataset.route);
  });
  $("#refresh-button").onclick = () => renderRoute(true);
  $("#restart-button").onclick = restartService;
  if (!(skinService == null ? void 0 : skinService.toggleTheme)) {
    $("#theme-toggle").onclick = () => {
      var _a2;
      const cur = document.documentElement.dataset.theme;
      const next = cur === "light-glass" ? "cosmos-glass" : "light-glass";
      document.documentElement.dataset.theme = next;
      storage.set("localdnsTheme", next);
      (_a2 = shellInterfaceService == null ? void 0 : shellInterfaceService.updateBrand) == null ? void 0 : _a2.call(shellInterfaceService);
    };
  }
  window.addEventListener("localdns:skinchange", () => {
    if (state.route === "overview") renderRoute(true, true);
  });
  $("#drawer-close").onclick = closeDrawer;
  $("#drawer-backdrop").onclick = closeDrawer;
  $("#modal-close").onclick = modalClose;
  $("#modal").addEventListener("close", () => {
    closeSlowTypePopover();
    $("#modal").classList.remove("overview-detail-modal");
  });
  {
    const modal = $("#modal");
    let backdropPress = false;
    modal.addEventListener("pointerdown", (e) => {
      backdropPress = e.target === modal;
    });
    modal.addEventListener("click", (e) => {
      if (backdropPress && e.target === modal) modalClose();
      backdropPress = false;
    });
    modal.addEventListener("cancel", (e) => {
      e.preventDefault();
      if (!$("#slow-type-popover") && !$("#upstream-error-popover")) modalClose();
    });
  }
  {
    const updateSbw = () => {
      if (document.querySelector("dialog[open]") || document.querySelector("#drawer.open")) return;
      document.documentElement.style.setProperty("--sbw", Math.max(0, window.innerWidth - document.documentElement.clientWidth) + "px");
    };
    updateSbw();
    window.addEventListener("resize", updateSbw);
  }
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && $("#drawer") && $("#drawer").classList.contains("open")) {
      closeDrawer();
      return;
    }
    const ae = document.activeElement;
    const typing = !!ae && (/^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName) || ae.isContentEditable);
    if (!typing && e.key === "/" || (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      const s = $("#global-search-input");
      if (s) {
        e.preventDefault();
        s.focus();
        s.select();
      }
    }
  });
  {
    const s = $("#global-search-input");
    if (s) s.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        if (s.value) s.value = "";
        else s.blur();
      }
    });
  }
  document.addEventListener("keydown", (e) => {
    if ((e.key === "Enter" || e.key === " ") && e.target.matches("[data-copy]")) {
      e.preventDefault();
      e.target.click();
    }
  });
  document.addEventListener("click", (e) => {
    requestAnimationFrame(syncAllSegThumbs);
    const node = e.target.closest("[data-copy]");
    if (!node) return;
    const text2 = node.dataset.copy || node.textContent.trim();
    copyToClipboard(text2).then((ok) => {
      if (!ok) {
        toast("复制失败", "error");
        return;
      }
      node.classList.add("is-copied");
      setTimeout(() => node.classList.remove("is-copied"), 900);
      toast("已复制", "success", text2);
    });
  });
  syncAllSegThumbs();
  window.addEventListener("resize", () => requestAnimationFrame(syncAllSegThumbs));
  window.addEventListener("hashchange", () => navigate(location.hash.replace(/^#\/?/, "") || "overview", false));
  window.addEventListener("resize", () => {
    if (state.route === "rules") requestAnimationFrame(fitRuleLayoutHeight);
  });
  window.addEventListener("localdns:layoutchange", () => {
    if (state.route === "rules") requestAnimationFrame(fitRuleLayoutHeight);
  });
  window.addEventListener("unhandledrejection", (e) => {
    var _a2;
    const msg = ((_a2 = e == null ? void 0 : e.reason) == null ? void 0 : _a2.message) || String((e == null ? void 0 : e.reason) || "未知错误");
    toast("操作失败", "error", msg);
    e.preventDefault();
  });
}
function initialize$4() {
  appEvents.on("preferences:error", ({ message }) => toast("设置未保存", "error", message));
  workspaceService.setup({ state, apiBase: API_BASE, loadLogs: (options) => api.logs(options), navigate, renderRoute, modalOpen, openDrawer, closeDrawer, downloadText, toast, ms, pct, fmtDate, groupName, trackRouteCleanup });
  collectionsService.setup({ apiBase: API_BASE, toast });
  window.addEventListener("localdns:collectionlayoutchange", closeUpstreamErrorPopover);
  sharedUIService.ready.then(() => {
    initShell();
    CONFIG.refreshInterval = Math.min(300, Math.max(5, Number(CONFIG.refreshInterval) || 30));
    shellInterfaceService == null ? void 0 : shellInterfaceService.setup({ apiBase: API_BASE, refreshInterval: CONFIG.refreshInterval });
    navigate(location.hash.replace(/^#\/?/, "") || "overview", false);
  });
}
const ruleProfiles = [["whitelist", "白名单"], ["blocklist", "黑名单"], ["greylist", "灰名单"], ["force_realip", "强制 RealIP"], ["ddns_domains", "DDNS 域名"], ["pcdn_domains", "PCDN 域名"], ["pcdn_regex_v4", "PCDN IPv4 规则"], ["pcdn_regex_v6", "PCDN IPv6 规则"], ["client_ip", "客户端 IP"], ["direct_ip", "直连 IP"], ["rewrite", "重定向"]];
let ruleViews, activeTab = "lists";
async function renderRules(container, context) {
  const renderScope = context.scope, page2 = container;
  ruleViews = new LatestView(renderScope);
  activeTab = "lists";
  rulesWorkbenchService.mount();
  mountToolbar();
  setHTML(page2, `
    <div class="view-title-row">
      <div style="display:flex;align-items:baseline;gap:12px"><h1>规则管理</h1><span class="gc-sub">统一维护本地名单、AdGuard 广告拦截与 SRS 在线分流规则</span></div>
      <div class="seg-group" id="rule-top-tabs">
        <button type="button" class="seg-item active" data-rule-tab="lists">名单管理</button>
        <button type="button" class="seg-item" data-rule-tab="adguard">广告拦截 (AdGuard)</button>
        <button type="button" class="seg-item" data-rule-tab="diversion">在线分流 (SRS)</button>
      </div>
    </div>
    <div id="rule-tab-body" class="col-12"></div>`);
  $$("[data-rule-tab]").forEach((x) => x.onclick = () => renderRuleTab(x.dataset.ruleTab));
  await renderScope.guard(renderRuleTab("lists"));
}
async function renderRuleTab(tab, approved = false) {
  const renderScope = currentScope();
  if (!approved && (rulesWorkbenchService == null ? void 0 : rulesWorkbenchService.canLeave(() => renderRuleTab(tab, true))) === false) return;
  activeTab = tab;
  $$("[data-rule-tab]").forEach((y) => y.classList.toggle("active", y.dataset.ruleTab === tab));
  const body = $("#rule-tab-body");
  setHTML(body, loadingPage());
  if (tab === "lists") return renderListRules(body);
  if (tab === "adguard") return renderAdguard(body);
  return renderDiversion(body);
}
async function renderListRules(body) {
  if (activeTab !== "lists" || !(body == null ? void 0 : body.isConnected) || currentScope().signal.aborted) return;
  const renderScope = ruleViews.begin();
  if (!ruleProfiles.some((x) => x[0] === state.ruleTag)) state.ruleTag = ruleProfiles[0][0];
  const tag = state.ruleTag, profile = ruleProfiles.find((x) => x[0] === tag) || ruleProfiles[0];
  let text2 = "", loadError = null;
  try {
    text2 = await renderScope.guard(api.request(`/plugins/${tag}/show?all=1`, { signal: renderScope.signal }));
  } catch (e) {
    if (renderScope.signal.aborted) return;
    loadError = e;
  }
  const menu = `<div class="rule-menu">${ruleProfiles.map(([t, n]) => `<button data-rule-tag="${t}" class="${t === tag ? "active" : ""}"><span>${n}</span><span class="rule-count"></span></button>`).join("")}</div>`;
  if (loadError) {
    setHTML(body, `<section class="card"><div class="rule-layout">${menu}<div class="rule-editor"><div class="section-header"><div><h2>${profile[1]}</h2><p>读取失败时禁止保存，现有规则不会被覆盖。</p></div><button class="button" id="rule-retry">${icon$1("refresh")}重试</button></div><div class="error-panel"><strong>规则列表加载失败</strong><p>${esc$1(loadError.message)}</p></div></div></div></section>`);
    $$("[data-rule-tag]").forEach((x) => x.onclick = () => {
      const go = () => {
        state.ruleTag = x.dataset.ruleTag;
        renderListRules(body);
      };
      if ((rulesWorkbenchService == null ? void 0 : rulesWorkbenchService.canLeave(go)) !== false) go();
    });
    $("#rule-retry").onclick = () => renderListRules(body);
    requestAnimationFrame(fitRuleLayoutHeight);
    return;
  }
  const trimmed = String(text2).trim();
  setHTML(body, `<section class="card"><div class="rule-layout">${menu}<div class="rule-editor"><div class="section-header"><div><h2>${profile[1]}</h2><p>一行一条；完整读取后才允许保存</p></div><div class="section-header-actions"><button class="button small" id="rule-download">${icon$1("download")}下载列表</button><button class="button primary" id="rule-save">${icon$1("save")}保存</button></div></div><textarea id="rule-text" class="rule-textarea" spellcheck="false">${esc$1(trimmed)}</textarea><div class="rule-editor-footer"><span id="rule-lines">共 ${trimmed ? trimmed.split("\n").length : 0} 行</span></div></div></div></section>`);
  $$("[data-rule-tag]").forEach((x) => x.onclick = () => {
    const go = () => {
      state.ruleTag = x.dataset.ruleTag;
      renderListRules(body);
    };
    if ((rulesWorkbenchService == null ? void 0 : rulesWorkbenchService.canLeave(go)) !== false) go();
  });
  $("#rule-text").oninput = () => $("#rule-lines").textContent = `共 ${$("#rule-text").value.split("\n").filter(Boolean).length} 行`;
  $("#rule-save").onclick = async () => {
    const button = $("#rule-save"), text3 = $("#rule-text"), value = text3.value, baseline = text3.dataset.original;
    button.disabled = true;
    try {
      await ruleSaveService.save(tag, value, baseline, () => api.request(`/plugins/${tag}/show?all=1`), (values) => api.json(`/plugins/${tag}/post`, "POST", { values }));
      shellInterfaceService == null ? void 0 : shellInterfaceService.ruleSaved(tag, value);
      toast(`${profile[1]}已保存`);
    } catch (e) {
      toast("保存失败", "error", e.message);
    } finally {
      if (button.isConnected) button.disabled = false;
    }
  };
  $("#rule-download").onclick = () => downloadText(`${tag}.txt`, $("#rule-text").value);
  requestAnimationFrame(fitRuleLayoutHeight);
}
async function renderAdguard(body) {
  if (activeTab !== "adguard" || !(body == null ? void 0 : body.isConnected) || currentScope().signal.aborted) return;
  const renderScope = ruleViews.begin();
  let rules = [];
  try {
    rules = (await renderScope.guard(api.request("/plugins/adguard/rules", { signal: renderScope.signal }))).slice();
  } catch (e) {
    if (renderScope.signal.aborted) return;
    setHTML(body, `<div class="error-panel"><strong>广告规则读取失败</strong><p>${esc$1(e.message)}</p></div>`);
    return;
  }
  rules.sort((a, b) => Number(Boolean(b.enabled)) - Number(Boolean(a.enabled)));
  const sourceErrors = rules.filter((r) => r.last_error);
  setHTML(body, card("广告拦截规则", `${sourceErrors.length ? `<div class="error-panel">${sourceErrors.map((r) => `${esc$1(r.name)}：${esc$1(r.last_error)}`).join("；")}</div>` : ""}<div class="table-wrap adguard-table-wrap mobile-card-table"><table class="adguard-rules-table adguard-card-table"><colgroup><col class="col-enabled"><col class="col-name"><col class="col-url"><col class="col-count"><col class="col-auto"><col class="col-updated"><col class="col-actions"></colgroup><thead><tr><th>启用</th><th>名称</th><th>订阅地址</th><th>规则数</th><th>自动更新</th><th>上次更新</th><th>操作</th></tr></thead><tbody>${rules.length ? rules.map((r) => `<tr data-id="${esc$1(r.id)}"><td class="ad-enabled-cell mobile-toggle-cell"><label class="switch"><input class="ad-enable" type="checkbox" ${r.enabled ? "checked" : ""}><span class="switch-track"><span class="switch-thumb"></span></span></label></td><td class="ad-name-cell mobile-name-cell" title="${esc$1(r.name)}"><strong>${esc$1(r.name)}</strong></td><td class="ad-url-cell mobile-url-cell" data-label="订阅地址" title="${esc$1(r.url)}"><span class="table-ellipsis mobile-ellipsis">${esc$1(r.url)}</span></td><td class="ad-count-cell mobile-count-cell" data-label="规则数">${num(r.rule_count)}</td><td class="ad-auto-cell mobile-auto-cell" data-label="自动更新">${r.auto_update ? "是" : "否"}</td><td class="ad-updated-cell mobile-updated-cell" data-label="上次更新">${fmtDate(r.last_updated)}</td><td class="ad-actions-cell mobile-actions-cell"><div class="table-row-actions card-actions"><button class="button small ad-update">更新</button><button class="button small ad-edit">编辑</button><button class="button small danger ad-delete">删除</button></div></td></tr>`).join("") : `<tr><td colspan="7" class="table-empty">暂无规则</td></tr>`}</tbody></table></div>`, { iconName: "rules", actions: '<button class="button" id="ad-update-all">更新全部</button><button class="button primary" id="ad-add">' + icon$1("plus") + "添加订阅</button>" }));
  const findRule = (tr) => rules.find((r) => String(r.id) === tr.dataset.id);
  $$(".ad-enable").forEach((x) => x.onchange = async () => {
    const rule = findRule(x.closest("tr"));
    if (!rule) return;
    x.disabled = true;
    try {
      await updateAdguard(rule, { enabled: x.checked });
      toast(`规则“${rule.name}”已${x.checked ? "启用" : "关闭"}`);
      await renderAdguard(body);
    } catch (e) {
      x.checked = !x.checked;
      toast("状态保存失败", "error", e.message);
    } finally {
      x.disabled = false;
    }
  });
  $$(".ad-update").forEach((x) => x.onclick = async () => {
    const rule = findRule(x.closest("tr"));
    if (!rule) return;
    x.disabled = true;
    try {
      const r = await api.request(`/plugins/adguard/rules/${encodeURIComponent(rule.id)}/update`, { method: "POST" });
      toast(`广告规则“${rule.name}”更新完成`, "success", `规则数：${num((r == null ? void 0 : r.rule_count) || 0)}`);
      await renderAdguard(body);
    } catch (e) {
      toast(`“${rule.name}”更新失败`, "error", e.message);
    } finally {
      x.disabled = false;
    }
  });
  $$(".ad-edit").forEach((x) => x.onclick = () => openAdguardModal(findRule(x.closest("tr")), body));
  $$(".ad-delete").forEach((x) => x.onclick = async () => {
    const rule = findRule(x.closest("tr"));
    if (!rule || !confirm(`确定删除广告规则“${rule.name}”？`)) return;
    x.disabled = true;
    try {
      await api.request(`/plugins/adguard/rules/${encodeURIComponent(rule.id)}`, { method: "DELETE" });
      toast("广告规则已删除");
      await renderAdguard(body);
    } catch (e) {
      toast("删除失败", "error", e.message);
    } finally {
      x.disabled = false;
    }
  });
  $("#ad-update-all").onclick = async () => {
    const btn = $("#ad-update-all");
    btn.disabled = true;
    try {
      const r = await api.request("/plugins/adguard/update", { method: "POST" });
      const errors = Array.isArray(r == null ? void 0 : r.errors) ? r.errors : [];
      if (errors.length) {
        toast(`广告规则更新完成，失败 ${errors.length} 条`, "error", errors.map((x) => `${x.name}：${x.error}`).join("；"));
      } else toast(`广告规则更新完成：${Number((r == null ? void 0 : r.updated_sources) || 0)} 条`);
      await renderAdguard(body);
    } catch (e) {
      toast("广告规则更新失败", "error", e.message);
    } finally {
      btn.disabled = false;
    }
  };
  $("#ad-add").onclick = () => openAdguardModal(null, body);
}
async function updateAdguard(rule, patch) {
  const next = Object.assign({}, rule, patch);
  delete next.last_error;
  await api.json(`/plugins/adguard/rules/${rule.id}`, "PUT", next);
}
function openAdguardModal(rule, body) {
  rule = rule || { name: "", url: "", files: "", enabled: true, auto_update: true, update_interval_hours: 24 };
  modalOpen(rule.id ? "编辑广告规则" : "添加广告规则", "订阅下载后保存为 TXT（保留 AdGuard 语法），所有启用的订阅合并为 rules/compiled/adguard.txt。", `<div class="stack"><div class="field"><label>名称</label><input id="ad-name" value="${esc$1(rule.name)}"></div><div class="field"><label>订阅地址</label><input id="ad-url" value="${esc$1(rule.url)}" placeholder="https://example.com/adblock.txt"></div><div class="field"><label>源缓存文件（可选）</label><input id="ad-files" value="${esc$1(rule.files || "")}" placeholder="留空时从 URL 自动生成"><p class="form-note">统一保存到 rules/online/adguard/，后缀固定为 .txt；留空时从 URL 路径提取文件名，query/fragment 不会写入文件名。</p></div><div class="grid grid-2"><label class="switch"><input id="ad-enabled" type="checkbox" ${rule.enabled ? "checked" : ""}><span class="switch-track"><span class="switch-thumb"></span></span><span class="switch-label">启用</span></label><label class="switch"><input id="ad-auto" type="checkbox" ${rule.auto_update ? "checked" : ""}><span class="switch-track"><span class="switch-thumb"></span></span><span class="switch-label">自动更新</span></label></div><div class="field"><label>更新间隔（小时）</label><input id="ad-hours" type="number" min="1" value="${rule.update_interval_hours || 24}"></div></div>`, async () => {
    const payload = { name: $("#ad-name").value.trim(), url: $("#ad-url").value.trim(), files: $("#ad-files").value.trim(), enabled: $("#ad-enabled").checked, auto_update: $("#ad-auto").checked, update_interval_hours: +$("#ad-hours").value || 24 };
    if (!payload.name || !payload.url) throw new Error("名称和地址不能为空");
    if (rule.rule_count !== void 0) payload.rule_count = rule.rule_count;
    if (rule.last_updated) payload.last_updated = rule.last_updated;
    if (rule.id) await api.json(`/plugins/adguard/rules/${rule.id}`, "PUT", Object.assign({}, rule, payload, { last_error: void 0 }));
    else await api.json("/plugins/adguard/rules", "POST", payload);
    toast(`广告规则已${rule.id ? "更新" : "添加"}`);
    await renderAdguard(body);
  });
}
const diversionDefs = [
  { tag: "custom_cn", type: "custom_cn", label: "国内规则", domainRules: true },
  { tag: "custom_non_cn", type: "custom_non_cn", label: "国外规则", domainRules: true },
  { tag: "geoip_cn", type: "geoip_cn", label: "GeoIP CN", domainRules: false },
  { tag: "geosite_cn", type: "geosite_cn", label: "Geosite CN", domainRules: true },
  { tag: "geosite_non_cn", type: "geosite_non_cn", label: "Geosite 非 CN", domainRules: true }
];
const diversionDefByTag = (tag) => diversionDefs.find((x) => x.tag === tag);
const diversionDefByType = (type) => diversionDefs.find((x) => x.type === type);
const diversionFormatLabel = (r) => ruleConversionService.label(r);
function diversionPayload(rule) {
  const target = diversionDefByType(rule.type);
  const payload = {
    name: String(rule.name || "").trim(),
    type: String(rule.type || "").trim(),
    files: String(rule.files || "").trim(),
    url: String(rule.url || "").trim(),
    dataset: String(rule.dataset || "").trim(),
    auto_update: Boolean(rule.auto_update),
    update_interval_hours: +rule.update_interval_hours || 24,
    enabled: rule.enabled !== false
  };
  if (target && target.domainRules !== false) payload.enable_regexp = true;
  if (!payload.dataset) delete payload.dataset;
  if (rule.rule_count !== void 0 && rule.rule_count !== null) payload.rule_count = +rule.rule_count || 0;
  if (rule.last_updated) payload.last_updated = rule.last_updated;
  if (rule.detected_format) payload.detected_format = rule.detected_format;
  return payload;
}
async function saveDiversionRule(rule, original = null) {
  const target = diversionDefByType(rule.type);
  if (!target) throw new Error("请选择有效的规则类型");
  const payload = diversionPayload(ruleConversionService.withMetadata(rule, original));
  if (!payload.name) throw new Error("名称不能为空");
  if (!payload.url) throw new Error("订阅地址不能为空");
  const response = await api.json(`/plugins/${target.tag}/config/${encodeURIComponent(payload.name)}`, "PUT", payload);
  const saved = await ruleConversionService.finishSave(response, () => api.request(`/plugins/${target.tag}/update/${encodeURIComponent(payload.name)}`, { method: "POST" }));
  if (original && (original.tag !== target.tag || original.name !== payload.name)) {
    await api.request(`/plugins/${original.tag}/config/${encodeURIComponent(original.name)}`, { method: "DELETE" });
  }
  return saved;
}
function openDiversionDatasetPrompt(rule, datasets, body, original = rule) {
  const options = (Array.isArray(datasets) ? datasets : []).map((x) => String(x || "").trim()).filter(Boolean);
  if (!options.length) {
    toast("更新失败", "error", "数据源要求选择数据集，但没有返回可用数据集");
    return;
  }
  modalOpen("请选择数据集 / Tag", "检测到多数据集 DAT。选择一次后会作为隐藏元数据保存，后续自动更新将直接复用。", `<div class="stack"><div class="field"><label>数据集 / Tag</label><select id="div-dataset-choice">${options.map((x) => `<option value="${esc$1(x)}" ${x === rule.dataset ? "selected" : ""}>${esc$1(x)}</option>`).join("")}</select></div><p class="form-note">此选择只在多数据集 DAT 需要时出现，不会重新加入常驻的格式或匹配设置。</p></div>`, async () => {
    const dataset = $("#div-dataset-choice").value;
    const saved = await saveDiversionRule({ ...rule, dataset }, original);
    workspaceService.clearRuleDraft(original);
    toast("识别与转换完成", "success", ruleConversionService.message(saved));
    await renderDiversion(body);
  });
}
async function updateDiversionRule(rule, body) {
  var _a2;
  try {
    const result = await api.request(`/plugins/${rule.tag}/update/${encodeURIComponent(rule.name)}`, { method: "POST" });
    const source = ruleConversionService.updated(result);
    if (source) Object.assign(rule, source);
    toast("规则更新完成", "success", ruleConversionService.message(result));
    await renderDiversion(body);
    return result;
  } catch (err) {
    if (((_a2 = err.body) == null ? void 0 : _a2.code) === "dataset_required" && Array.isArray(err.body.datasets)) {
      openDiversionDatasetPrompt(rule, err.body.datasets, body);
      return null;
    }
    throw err;
  }
}
async function renderDiversion(body) {
  if (activeTab !== "diversion" || !(body == null ? void 0 : body.isConnected) || currentScope().signal.aborted) return;
  const renderScope = ruleViews.begin();
  let all;
  try {
    all = await renderScope.guard(Promise.all(diversionDefs.map(async (def) => {
      const result = await safeResult(() => api.request(`/plugins/${def.tag}/config`, { signal: renderScope.signal }));
      return result.ok ? { def, items: result.data, error: null } : { def, items: [], error: result.error };
    })));
  } catch (error) {
    if (renderScope.signal.aborted) return;
    throw error;
  }
  const errors = all.filter((x) => x.error);
  const rows = all.flatMap(({ def, items }) => (Array.isArray(items) ? items : []).map((i) => ({
    ...i,
    tag: def.tag,
    group: def.label,
    type: i.type || def.type,
    enabled: i.enabled !== false,
    dataset: String(i.dataset || ""),
    detected_format: String(i.detected_format || ""),
    auto_update: Boolean(i.auto_update),
    update_interval_hours: +i.update_interval_hours || 24
  })));
  rows.sort((a, b) => Number(b.enabled) - Number(a.enabled));
  setHTML(body, card("在线分流规则", workspaceService.diversion(rows, errors, diversionFormatLabel), { iconName: "rules", actions: '<button class="button" id="div-update-all">更新全部</button><button class="button primary" id="div-add">' + icon$1("plus") + "添加规则</button>" }));
  workspaceService.bindDiversion(body);
  $$(".div-detail", body).forEach((button) => button.onclick = () => {
    const el = button.closest("[data-tag][data-name]"), r = rows.find((r2) => r2.tag === el.dataset.tag && String(r2.name) === el.dataset.name);
    if (r) workspaceService.ruleDetails(r, () => openDiversionModal(r, body), diversionFormatLabel);
  });
  const findRow = (tr) => rows.find((r) => r.tag === tr.dataset.tag && String(r.name) === tr.dataset.name);
  $$(".div-enable").forEach((x) => x.onchange = async () => {
    const tr = x.closest("[data-tag][data-name]"), rule = findRow(tr);
    if (!rule) return;
    x.disabled = true;
    try {
      const next = { ...rule, enabled: x.checked };
      await saveDiversionRule(next, rule);
      rule.enabled = x.checked;
      toast(`规则“${rule.name}”已${x.checked ? "启用" : "关闭"}，配置已保存`);
      await renderDiversion(body);
    } catch (e) {
      x.checked = !x.checked;
      toast("状态保存失败", "error", e.message);
    } finally {
      x.disabled = false;
    }
  });
  $$(".div-update").forEach((x) => x.onclick = async () => {
    const rule = findRow(x.closest("[data-tag][data-name]"));
    if (!rule) return;
    x.disabled = true;
    try {
      await updateDiversionRule(rule, body);
    } catch (e) {
      toast("更新失败", "error", e.message);
    } finally {
      x.disabled = false;
    }
  });
  $$(".div-edit").forEach((x) => x.onclick = () => {
    const rule = findRow(x.closest("[data-tag][data-name]"));
    if (rule) openDiversionModal(rule, body);
  });
  $$(".div-delete").forEach((x) => x.onclick = async () => {
    if (!confirm("确定删除此在线规则？配置文件中的对应项目也会被删除。")) return;
    const tr = x.closest("[data-tag][data-name]");
    x.disabled = true;
    try {
      await api.request(`/plugins/${tr.dataset.tag}/config/${encodeURIComponent(tr.dataset.name)}`, { method: "DELETE" });
      toast("规则及对应配置已删除");
      await renderDiversion(body);
    } catch (e) {
      toast("删除失败", "error", e.message);
    } finally {
      x.disabled = false;
    }
  });
  $("#div-add").onclick = () => openDiversionModal(null, body);
  $("#div-update-all").onclick = async () => {
    const targets = rows.filter((r) => r.enabled && r.url);
    if (!targets.length) {
      toast("没有可更新的已启用规则", "info");
      return;
    }
    const btn = $("#div-update-all");
    btn.disabled = true;
    try {
      const byTag = /* @__PURE__ */ new Map();
      targets.forEach((r) => {
        if (!byTag.has(r.tag)) byTag.set(r.tag, []);
        byTag.get(r.tag).push(r);
      });
      const jobs = [];
      for (const [tag, group] of byTag) {
        const def = diversionDefByTag(tag);
        if (def) {
          jobs.push(api.request(`/plugins/${tag}/update-all`, { method: "POST" }).then((data) => ({ kind: "batch", count: group.length, data }), (error) => ({ kind: "failed", count: group.length, error })));
        } else {
          group.forEach((r) => jobs.push(api.request(`/plugins/${r.tag}/update/${encodeURIComponent(r.name)}`, { method: "POST" }).then((data) => ({ kind: "single", count: 1, data }))));
        }
      }
      const result = await Promise.allSettled(jobs);
      let failed = 0, datasetNeeded = 0, completed = 0, details = [];
      result.forEach((x) => {
        var _a2, _b2, _c, _d, _e, _f, _g, _h;
        if (x.status === "rejected") {
          failed++;
          if (((_b2 = (_a2 = x.reason) == null ? void 0 : _a2.body) == null ? void 0 : _b2.code) === "dataset_required") datasetNeeded++;
          details.push(((_c = x.reason) == null ? void 0 : _c.message) || "未知错误");
          return;
        }
        const item = x.value;
        if (item.kind === "failed") {
          failed += item.count;
          details.push(((_d = item.error) == null ? void 0 : _d.message) || "更新失败");
          return;
        }
        completed += item.kind === "batch" ? Number(((_e = item.data) == null ? void 0 : _e.updated) || 0) : item.count;
        if (item.kind === "batch") {
          failed += Number(((_f = item.data) == null ? void 0 : _f.failed) || 0);
          datasetNeeded += Number(((_g = item.data) == null ? void 0 : _g.dataset_required) || 0);
          if (Array.isArray((_h = item.data) == null ? void 0 : _h.errors)) details.push(...item.data.errors.map((e) => `${e.name}：${e.error}`));
        }
      });
      const detailText = details.join("；");
      if (datasetNeeded) toast(`更新完成 ${completed} 条；${datasetNeeded} 条需要单独选择数据集`, "error", detailText);
      else if (failed) toast(`更新任务完成，失败 ${failed} 条`, "error", detailText);
      else toast(`已更新 ${completed} 条在线分流规则`);
      await renderDiversion(body);
    } finally {
      btn.disabled = false;
    }
  };
}
function openDiversionModal(rule, body) {
  const original = rule ? { ...rule } : null;
  rule = rule || { name: "", type: "custom_cn", url: "", files: "", enabled: true, dataset: "", auto_update: true, update_interval_hours: 24 };
  rule.dataset = String(rule.dataset || "");
  modalOpen(original ? "编辑在线分流规则" : "添加在线分流规则", "远程规则由后端按内容自动识别，并统一转换为 SRS；无需手工选择源格式或匹配方式。", `<div class="stack"><div class="grid grid-2"><div class="field"><label>名称</label><input id="div-name" value="${esc$1(rule.name)}" placeholder="例如：direct_tld_cn"></div><div class="field"><label>规则类型</label><select id="div-type">${diversionDefs.map((d) => `<option value="${d.type}" ${d.type === rule.type ? "selected" : ""}>${esc$1(d.label)}</option>`).join("")}</select></div></div><div class="field"><label>订阅地址</label><input id="div-url" value="${esc$1(rule.url || "")}" placeholder="https://example.com/rules"></div><div class="field"><label>源缓存文件（可选）</label><input id="div-files" value="${esc$1(rule.files || "")}" placeholder="留空时自动生成"><p class="form-note">每个订阅源下载后统一转换为 SRS，存放在 rules/online/规则组/；同组来源合并去重后生成 rules/compiled/规则组.srs，运行时只加载这个文件。</p></div><div class="grid grid-2"><label class="switch"><input id="div-enabled" type="checkbox" ${rule.enabled !== false ? "checked" : ""}><span class="switch-track"><span class="switch-thumb"></span></span><span class="switch-label">启用</span></label><label class="switch"><input id="div-auto" type="checkbox" ${rule.auto_update ? "checked" : ""}><span class="switch-track"><span class="switch-thumb"></span></span><span class="switch-label">自动更新</span></label></div><div class="field"><label>更新间隔（小时）</label><input id="div-hours" type="number" min="1" value="${rule.update_interval_hours || 24}"></div><p class="form-note">支持的来源按内容自动识别；只有多数据集 DAT 才会在更新时要求选择一次数据集。所有成功识别的来源最终统一转换为 SRS 后加载。</p></div>`, async () => {
    var _a2;
    const payload = { name: $("#div-name").value.trim(), type: $("#div-type").value, url: $("#div-url").value.trim(), files: $("#div-files").value.trim(), dataset: rule.dataset, enabled: $("#div-enabled").checked, auto_update: $("#div-auto").checked, update_interval_hours: +$("#div-hours").value || 24 };
    let saved;
    try {
      saved = await saveDiversionRule(payload, original);
    } catch (err) {
      if (((_a2 = err.body) == null ? void 0 : _a2.code) === "dataset_required" && Array.isArray(err.body.datasets)) {
        return () => openDiversionDatasetPrompt({ ...payload, tag: payload.type }, err.body.datasets, body, original);
      }
      throw err;
    }
    workspaceService.clearRuleDraft(original);
    toast("保存与转换完成", "success", ruleConversionService.message(saved));
    await renderDiversion(body);
  });
  workspaceService.trackRuleDraft(original);
}
const rulesRoute = {
  mount(container, context) {
    return renderRules(container, context);
  },
  canLeave() {
    return rulesWorkbenchService.requestLeave();
  }
};
const managementRoute = { mount(container, context) {
  return renderManagement(container, context);
} };
const scriptRel = "modulepreload";
const assetsURL = function(dep) {
  return "/ui/" + dep;
};
const seen = {};
const __vitePreload = function preload(baseModule, deps, importerUrl) {
  let promise = Promise.resolve();
  if (deps && deps.length > 0) {
    let allSettled2 = function(promises$2) {
      return Promise.all(promises$2.map((p) => Promise.resolve(p).then((value$1) => ({
        status: "fulfilled",
        value: value$1
      }), (reason) => ({
        status: "rejected",
        reason
      }))));
    };
    var allSettled = allSettled2;
    const links = document.getElementsByTagName("link");
    const cspNonceMeta = document.querySelector("meta[property=csp-nonce]");
    const cspNonce = (cspNonceMeta == null ? void 0 : cspNonceMeta.nonce) || (cspNonceMeta == null ? void 0 : cspNonceMeta.getAttribute("nonce"));
    promise = allSettled2(deps.map((dep) => {
      dep = assetsURL(dep, importerUrl);
      if (dep in seen) return;
      seen[dep] = true;
      const isCss = dep.endsWith(".css");
      const cssSelector = isCss ? '[rel="stylesheet"]' : "";
      if (!!importerUrl) for (let i$1 = links.length - 1; i$1 >= 0; i$1--) {
        const link$1 = links[i$1];
        if (link$1.href === dep && (!isCss || link$1.rel === "stylesheet")) return;
      }
      else if (document.querySelector(`link[href="${dep}"]${cssSelector}`)) return;
      const link = document.createElement("link");
      link.rel = isCss ? "stylesheet" : scriptRel;
      if (!isCss) link.as = "script";
      link.crossOrigin = "";
      link.href = dep;
      if (cspNonce) link.setAttribute("nonce", cspNonce);
      document.head.appendChild(link);
      if (isCss) return new Promise((res, rej) => {
        link.addEventListener("load", res);
        link.addEventListener("error", () => rej(/* @__PURE__ */ new Error(`Unable to preload CSS for ${dep}`)));
      });
    }));
  }
  function handlePreloadError(err$2) {
    const e$1 = new Event("vite:preloadError", { cancelable: true });
    e$1.payload = err$2;
    window.dispatchEvent(e$1);
    if (!e$1.defaultPrevented) throw err$2;
  }
  return promise.then((res) => {
    for (const item of res || []) {
      if (item.status !== "rejected") continue;
      handlePreloadError(item.reason);
    }
    return baseModule().catch(handlePreloadError);
  });
};
function proxyConfigBase(configured = "", apiBase = "", origin = location.origin) {
  const url = new URL(configured || apiBase || origin, origin);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("配置服务地址必须为 HTTP(S) 地址。");
  if (!configured) {
    url.port = "9098";
    url.pathname = "/";
  }
  url.search = "";
  url.hash = "";
  url.pathname = url.pathname.replace(/\/$/, "").replace(/\/api\/proxy-config$/, "") + "/api/proxy-config/";
  return url.href;
}
async function request(path, { method = "GET", body, signal } = {}) {
  const settings = window.LOCALDNS_UI_CONFIG || {};
  const base = proxyConfigBase(settings.proxyConfigBase, settings.apiBase);
  const client = new HttpClient({ base, timeout: path === "save" ? 105e3 : path === "check" ? 55e3 : 2e4 });
  try {
    return await client.request(path, { method, signal, credentials: "omit", cache: "no-store", headers: body === void 0 ? {} : { "Content-Type": "application/json" }, body: body === void 0 ? void 0 : JSON.stringify(body) });
  } catch (error) {
    if (path === "fetch" && error instanceof ApiError && [404, 405].includes(error.status)) {
      const failure = new Error("当前配置服务不支持 HTTP 获取，请安装 1.6.0 或更新的配套服务后重试。");
      Object.assign(failure, { cause: error });
      throw failure;
    }
    if (error instanceof ApiError && (error.code === "network" || error.code === "invalid-json")) {
      const failure = new Error("无法连接配置管理服务，请检查服务地址和安装状态后重试。");
      Object.assign(failure, { cause: error });
      throw failure;
    }
    throw error;
  }
}
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const icons = {
  back: '<path d="m14 6-6 6 6 6M8 12h12"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  expand: '<path d="M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  diff: '<path d="M8 4H4v16h4M16 4h4v16h-4M9 8h6M12 5v6M9 16h6"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  refresh: '<path d="M20 7v5h-5M20 12a8 8 0 1 0-2 5"/>',
  save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12l4 4v12a2 2 0 0 1-2 2Z"/><path d="M7 3v6h10V3M7 21v-8h10v8"/>',
  file: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z"/><path d="M14 3v6h6"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 15v2"/>'
};
const icon = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.file}</svg>`;
const brands = { mihomo: { name: "Mihomo", format: "YAML", logo: "assets/img/proxy-panel.svg" }, "sing-box": { name: "sing-box", format: "JSON", logo: "assets/img/proxy-panel.svg" } };
let active = null;
const vendor = () => __vitePreload(() => import("./editor-A1rycQg2.js"), true ? [] : void 0);
function dialog(title, content, actions = "", wide = false) {
  const origin = document.activeElement;
  const element = document.createElement("dialog");
  element.className = "pc-dialog" + (wide ? " pc-wide" : "");
  setHTML(element, `<div class="pc-dialog-heading"><h2>${esc(title)}</h2><button type="button" class="icon-button" data-pc-close aria-label="关闭">${icon("close")}</button></div><div class="pc-dialog-body">${content}</div>${actions ? `<div class="pc-dialog-actions">${actions}</div>` : ""}`);
  document.body.append(element);
  const close = () => element.close();
  element.querySelectorAll("[data-pc-close]").forEach((button) => button.addEventListener("click", close));
  element.addEventListener("close", () => {
    element.remove();
    if (origin == null ? void 0 : origin.isConnected) origin.focus({ preventScroll: true });
  }, { once: true });
  element.showModal();
  return element;
}
function confirmDiscard(action) {
  if (!(active == null ? void 0 : active.dirty())) {
    action();
    return;
  }
  const element = dialog("放弃尚未保存的修改？", "<p>继续操作会关闭当前修改，设备上的配置保持原样。</p>", '<button class="button" data-pc-close>继续编辑</button><button class="button primary" id="pc-discard">放弃修改并继续</button>');
  element.querySelector("#pc-discard").onclick = () => {
    element.close();
    action();
  };
}
async function mount(parent, context) {
  const { notify, navigate: navigate2, scope } = context;
  const abort = new AbortController();
  let editor, tools, cores = [], core = "mihomo", path = "", revision = "", base = "", newline = "\n", busy = false, programmatic = false, serviceReady = false, activeFile = false, groupRevision = "", fragmentMode = false, groupCount = 0, alive = true, mode = "file", directory = "", directoryCore = "mihomo", directoryFiles = [], browseSequence = 0, browsing = false;
  let workspace = {};
  try {
    workspace = JSON.parse(preferences.getItem("localdns-proxy-config-workspace-v1") || "{}") || {};
  } catch {
  }
  if (workspace.mode === "directory") mode = "directory";
  setHTML(parent, `<section class="pc-root" aria-label="代理配置编辑器">
      <div class="pc-heading"><div><button type="button" class="pc-back" id="pc-back">${icon("back")}系统管理</button><h1>代理配置</h1><p class="gc-sub">读取服务器文件或 HTTP 配置，校验后保存并应用。</p></div></div>
      <div class="pc-sourcebar"><label for="pc-core-select">配置核心</label><select id="pc-core-select"><option value="mihomo">Mihomo · YAML</option><option value="sing-box">sing-box · JSON</option></select><div class="pc-source-modes" role="group" aria-label="文件浏览方式"><button type="button" data-pc-mode="file" aria-pressed="true">单文件</button><button type="button" data-pc-mode="directory" aria-pressed="false">目录</button></div><button type="button" class="button small" id="pc-http-toggle" aria-expanded="false" aria-controls="pc-http-form">HTTP 获取</button></div>
      <form class="pc-http-form" id="pc-http-form" hidden><label for="pc-http-url">HTTP(S) 配置链接</label><div class="pc-http-fields"><input id="pc-http-url" type="url" placeholder="https://example.com/config.yaml" autocomplete="off" spellcheck="false" required aria-describedby="pc-http-note pc-http-error"/><button type="submit" class="button" id="pc-http-read">读取到编辑器</button></div><label class="pc-keep-controller"><input type="checkbox" id="pc-keep-controller" checked/>保留目标核心的控制地址和密钥</label><p id="pc-http-note">先选择目标配置文件。读取成功后进入草稿，保存时写入该文件。</p><p id="pc-http-error" class="pc-form-error" role="alert" hidden></p></form>
      <details class="pc-setup" id="pc-setup" hidden><summary>恢复配置服务</summary><p>在核心所在服务器安装配套配置服务，然后重新读取。默认端口为 9098；自定义地址可在 ui/config.js 设置 proxyConfigBase。</p><code>sh install-proxy-config.sh http://服务器IP:9099</code><a href="help/proxy-config.txt" target="_blank" rel="noopener noreferrer">查看安装说明</a></details>
      <button type="button" class="pc-mobile-files" id="pc-toggle-files" aria-expanded="false" aria-controls="pc-directory-panel" hidden><span>切换配置文件</span><span>展开列表</span></button>
      <div class="pc-workspace" data-mode="file"><aside class="pc-directory-panel" id="pc-directory-panel" aria-label="目录配置文件" hidden><form id="pc-directory-form"><label for="pc-directory-input">配置目录</label><div><input id="pc-directory-input" type="text" placeholder="/etc/mihomo" autocomplete="off" spellcheck="false" required/><button type="submit" class="button small">读取</button></div></form><div class="pc-directory-heading"><span id="pc-file-count" role="status">尚未读取目录</span><button type="button" class="button small" id="pc-directory-parent">上一级</button></div><input id="pc-file-filter" type="search" placeholder="筛选配置文件" aria-label="筛选配置文件"/><div id="pc-directory-list" class="pc-directory-list" aria-live="polite"></div><p class="pc-directory-note">备用配置仅保存文件；启动配置保存后自动应用。</p></aside>
      <section class="pc-card" id="pc-card"><div class="pc-filebar"><img id="pc-logo" src="assets/img/proxy-panel.svg" alt="" width="34" height="34"/><div class="pc-filename"><div><strong id="pc-name">选择配置文件</strong><span class="pc-format" id="pc-format">YAML</span></div><button type="button" class="pc-path" id="pc-choose"><span id="pc-path">读取服务器配置…</span>${icon("folder")}</button></div><div class="pc-editor-tools"><button type="button" class="icon-button" id="pc-search" aria-label="查找配置">${icon("search")}</button><button type="button" class="icon-button" id="pc-focus" aria-label="专注编辑" aria-pressed="false">${icon("expand")}</button><button type="button" class="button small" id="pc-diff">${icon("diff")}<span>查看改动</span></button></div></div>
      <div class="pc-actionbar"><span id="pc-document-state" role="status">尚未读取文件</span><div><button type="button" class="button small" id="pc-reread">重新读取</button><button type="button" class="button small" id="pc-check">${icon("check")}检查配置</button><button type="button" class="button primary small" id="pc-save">${icon("save")}保存并应用</button></div></div>
      <div id="pc-editor" class="pc-editor"><div class="pc-empty">${icon("folder")}<strong>正在读取服务器配置</strong><p>正在连接配置服务并读取目标文件。</p><button type="button" class="button" id="pc-retry" hidden>重新读取</button></div></div>
      <div class="pc-statusbar"><span id="pc-cursor">—</span><span id="pc-lines">—</span><span id="pc-encoding">UTF-8</span></div>
      <details class="pc-result" id="pc-result"><summary><span id="pc-result-title" role="status" aria-live="polite">正在读取服务器配置</span><span class="pc-result-hint">查看详情</span></summary><pre id="pc-result-detail"></pre></details></section></div>
      <div class="pc-footnote"><span>${icon("lock")}保存前自动备份，校验通过后应用。</span><span id="pc-active-note">保存启动配置后自动应用</span></div>
    </section>`);
  const root = parent.querySelector(".pc-root");
  const $2 = (selector) => root.querySelector(selector);
  const dirty = () => !!editor && editor.text() !== base;
  const current = { dirty, isBusy: () => busy, notify, confirmLeave: confirmDiscard };
  active = current;
  const result = (state2, title, detail = "", open = false) => {
    if (!alive) return;
    $2("#pc-result").dataset.state = state2;
    $2("#pc-result-title").textContent = title;
    $2("#pc-result-detail").textContent = detail;
    $2("#pc-result").open = open;
  };
  const sync = () => {
    if (!alive) return;
    const loaded = !!revision;
    $2("#pc-document-state").textContent = busy ? "正在执行操作…" : !loaded ? "尚未读取文件" : dirty() ? "有未保存的修改" : "已读取 · 尚未修改";
    $2("#pc-document-state").dataset.dirty = String(dirty());
    for (const id of ["pc-choose", "pc-check", "pc-reread", "pc-search", "pc-focus"]) $2("#" + id).disabled = busy || !serviceReady || id !== "pc-choose" && !loaded;
    $2("#pc-diff").disabled = busy || !dirty();
    $2("#pc-save").disabled = busy || !loaded || !dirty();
    for (const id of ["pc-http-toggle", "pc-http-read", "pc-http-url", "pc-keep-controller"]) $2("#" + id).disabled = busy || !serviceReady;
    setHTML($2("#pc-save"), icon("save") + (activeFile ? "保存并应用" : "保存文件"));
    $2("#pc-core-select").disabled = busy || !serviceReady;
    $2("#pc-core-select").value = core;
    for (const button of root.querySelectorAll("[data-pc-mode],#pc-directory-form button,#pc-directory-parent")) button.disabled = busy || !serviceReady || browsing;
    $2("#pc-directory-input").disabled = busy || browsing;
    for (const button of root.querySelectorAll("#pc-directory-list button")) button.disabled = busy;
    if (editor) editor.editable(!busy);
    root.setAttribute("aria-busy", String(busy));
  };
  const setBusy = (value) => {
    busy = value;
    sync();
  };
  const wireContent = () => newline === "\r\n" ? editor.text().replace(/\n/g, "\r\n") : editor.text();
  const cursor = () => {
    if (!editor || !alive) return;
    const selection = editor.view.state.selection.main, line = editor.view.state.doc.lineAt(selection.head);
    $2("#pc-cursor").textContent = `行 ${line.number}，列 ${selection.head - line.from + 1}`;
    $2("#pc-lines").textContent = editor.view.state.doc.lines + " 行";
  };
  const report = (error) => {
    if (!alive) return;
    const detail = error.body || error;
    result("error", error.message, [detail.detail, detail.backup ? "备份：" + detail.backup : ""].filter(Boolean).join("\n"), true);
    if (!serviceReady) $2("#pc-setup").hidden = false;
    if (!editor) {
      const empty2 = $2(".pc-empty");
      if (empty2) {
        empty2.querySelector("strong").textContent = "暂时无法读取配置";
        empty2.querySelector("p").textContent = error.message;
        $2("#pc-retry").hidden = false;
      }
    }
  };
  async function readFile(nextCore, nextPath) {
    var _a2, _b2;
    setBusy(true);
    result("working", "正在读取配置文件…");
    try {
      const loaded = await request("read", { method: "POST", body: { core: nextCore, path: nextPath }, signal: abort.signal });
      if (!alive) return;
      core = nextCore;
      path = loaded.path;
      revision = loaded.revision;
      activeFile = loaded.active;
      groupRevision = loaded.groupRevision || "";
      fragmentMode = loaded.mode === "fragments";
      groupCount = loaded.groupCount || 0;
      newline = loaded.content.includes("\r\n") ? "\r\n" : "\n";
      base = loaded.content.replace(/\r\n/g, "\n");
      if (!editor) {
        $2("#pc-editor").replaceChildren();
        editor = tools.makeEditor({ parent: $2("#pc-editor"), doc: base, type: core, onSave: () => {
          if (!busy && dirty()) compare(true);
        }, onUpdate: (update) => {
          cursor();
          if (update.docChanged && !programmatic) queueMicrotask(() => {
            if (!alive) return;
            editor.diagnostics([]);
            sync();
            result("idle", "内容已修改，等待检查", "保存时会重新执行核心校验。");
          });
        } });
      } else {
        programmatic = true;
        editor.set(base, core);
        programmatic = false;
      }
      $2("#pc-logo").src = brands[core].logo;
      $2("#pc-logo").alt = brands[core].name;
      $2("#pc-name").textContent = path.split("/").pop();
      $2("#pc-path").textContent = path;
      $2("#pc-path").title = path;
      $2("#pc-format").textContent = brands[core].format;
      $2("#pc-encoding").textContent = "UTF-8 · " + (newline === "\r\n" ? "CRLF" : "LF");
      $2("#pc-active-note").textContent = fragmentMode ? `运行分片 · 与 ${groupCount} 份文件合并校验，保存后重载整套配置` : activeFile ? "启动配置 · 保存后自动重载" : "备用配置 · 保存后不切换当前运行配置";
      $2("#pc-http-note").textContent = `保存目标：${path}${activeFile ? " · 保存后应用到 " + brands[core].name : " · 备用文件，保存后不应用"}`;
      $2(".pc-directory-note").textContent = ((_a2 = cores.find((item) => item.id === core)) == null ? void 0 : _a2.mode) === "fragments" ? "运行分片会按完整集合合并校验，目录外备用文件单独保存。" : "备用配置仅保存文件；启动配置保存后自动应用。";
      result("idle", fragmentMode ? `已读取运行分片 · 共 ${groupCount} 份` : "已读取配置，尚未检查", activeFile ? "修改后可检查配置、查看差异，再保存并应用。" : "此文件独立校验并保存。当前启动配置：" + ((_b2 = cores.find((item) => item.id === core)) == null ? void 0 : _b2.path));
      renderDirectoryFiles();
      if (matchMedia("(max-width:800px)").matches) toggleFiles(false);
      try {
        preferences.setItem("localdns-proxy-config-file-v1", JSON.stringify({ core, path }));
      } catch {
      }
      cursor();
      return true;
    } catch (error) {
      report(error);
    } finally {
      setBusy(false);
    }
  }
  async function check() {
    const diagnostics = fragmentMode ? [] : tools.syntaxCheck(editor.text(), core);
    editor.diagnostics(diagnostics);
    if (diagnostics.length) {
      result("error", "语法检查未通过", diagnostics.map((item) => `第 ${item.line} 行：${item.message}`).join("\n"), true);
      return false;
    }
    const response = await request("check", { method: "POST", body: { core, path, content: wireContent(), revision, ...fragmentMode ? { groupRevision } : {} }, signal: abort.signal });
    result("success", fragmentMode ? "整套分片合并与核心校验通过" : "语法与核心校验通过", response.detail || "配置可以由当前核心加载。", true);
    return true;
  }
  async function importHTTP() {
    if (busy) return;
    const field = $2("#pc-http-url"), error = $2("#pc-http-error");
    error.hidden = true;
    field.removeAttribute("aria-invalid");
    if (!revision) {
      error.textContent = "请先选择并读取目标配置文件，再导入 HTTP 内容。";
      error.hidden = false;
      return;
    }
    let url;
    try {
      url = new URL(field.value.trim());
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash) throw new Error();
    } catch {
      error.textContent = "请输入不含账号密码或片段的 HTTP(S) 配置链接。";
      error.hidden = false;
      field.setAttribute("aria-invalid", "true");
      field.focus();
      return;
    }
    setBusy(true);
    result("working", "正在获取 HTTP 配置…");
    try {
      const response = await request("fetch", { method: "POST", body: { url: url.href, core }, signal: abort.signal });
      if (!alive) return;
      const draft = tools.prepareHTTPDraft(response.content, base, core, $2("#pc-keep-controller").checked);
      programmatic = true;
      editor.set(draft.content.replace(/\r\n/g, "\n"), core);
      programmatic = false;
      editor.diagnostics([]);
      cursor();
      result("success", dirty() ? "HTTP 配置已读入草稿，尚未保存" : "HTTP 内容与当前文件一致", `来源：${response.sourceHost}
保存目标：${path}
${draft.preserved ? "已保留目标核心的控制地址和密钥。\n" : ""}${activeFile ? "保存并应用后，新连接使用新配置。" : "这是备用配置，保存后不切换运行配置。"}`, true);
    } catch (failure) {
      if (alive) {
        error.textContent = failure.message;
        error.hidden = false;
        field.setAttribute("aria-invalid", "true");
        report(failure);
      }
    } finally {
      programmatic = false;
      setBusy(false);
    }
  }
  async function compare(forSave = false) {
    if (busy || !dirty()) return;
    if (forSave) {
      setBusy(true);
      result("working", "正在执行核心校验…");
      try {
        if (!await check()) return;
      } catch (error) {
        report(error);
        return;
      } finally {
        setBusy(false);
      }
    }
    const changes = tools.differences(base, editor.text());
    const element = dialog(forSave ? activeFile ? "确认保存并应用" : "确认保存备用配置" : "查看本次修改", `<div class="pc-compare-meta"><code>${esc(path)}</code><span>+${changes.added.length} / −${changes.removed.length} 行</span></div>${forSave && activeFile && core === "sing-box" ? '<p class="pc-note">sing-box 将重建运行实例，现有连接可能断开。应用后新连接使用新规则。</p>' : ""}<div class="pc-diff-tabs" role="group" aria-label="对比版本"><button aria-pressed="true" data-pc-side="original">原配置</button><button aria-pressed="false" data-pc-side="modified">当前修改</button></div><div class="pc-diff-grid" data-side="original"><section><h3>原配置</h3><div id="pc-original"></div></section><section><h3>当前修改</h3><div id="pc-modified"></div></section></div>`, `<button class="button" data-pc-close>返回编辑</button>${forSave ? `<button class="button primary" id="pc-confirm-save">${activeFile ? "保存并应用" : "保存文件"}</button>` : ""}`, true);
    const views = [tools.makeEditor({ parent: element.querySelector("#pc-original"), doc: base, type: core, readOnly: true, changedLines: changes.removed, side: "removed" }), tools.makeEditor({ parent: element.querySelector("#pc-modified"), doc: editor.text(), type: core, readOnly: true, changedLines: changes.added, side: "added" })];
    element.addEventListener("close", () => views.forEach((view) => view.destroy()), { once: true });
    element.querySelectorAll("[data-pc-side]").forEach((button) => button.onclick = () => {
      element.querySelectorAll("[data-pc-side]").forEach((item) => item.setAttribute("aria-pressed", String(item === button)));
      element.querySelector(".pc-diff-grid").dataset.side = button.dataset.pcSide;
      views.forEach((view) => view.view.requestMeasure());
    });
    if (forSave) element.querySelector("#pc-confirm-save").onclick = async () => {
      element.close();
      setBusy(true);
      result("working", activeFile ? "正在校验、备份并重载配置…" : "正在校验、备份并保存文件…", "请等待结果，修改内容会保留在当前页面。", true);
      try {
        const response = await request("save", { method: "POST", body: { core, path, content: wireContent(), revision, ...fragmentMode ? { groupRevision } : {} } });
        if (!alive) return;
        revision = response.revision;
        groupRevision = response.groupRevision || groupRevision;
        base = editor.text();
        result("success", response.unchanged ? "配置未变化，无需重载" : response.confirmation === "saved-only" ? "备用配置已保存，当前运行配置未切换" : response.confirmation === "signal-and-health" ? "配置已保存，已发送重载且核心在线" : "配置已保存，核心重载成功", response.backup ? "原配置备份：" + response.backup : "", true);
        notify(response.reloaded ? "配置已保存并应用" : "配置文件已保存");
      } catch (error) {
        report(error);
      } finally {
        setBusy(false);
      }
    };
  }
  function rememberWorkspace() {
    try {
      preferences.setItem("localdns-proxy-config-workspace-v1", JSON.stringify({ mode, core: directoryCore, directory }));
    } catch {
    }
  }
  function renderDirectoryFiles() {
    var _a2;
    if (!alive) return;
    const list = $2("#pc-directory-list"), filter = $2("#pc-file-filter").value.trim().toLowerCase();
    list.replaceChildren();
    const items = directoryFiles.filter((item) => item.name.toLowerCase().includes(filter));
    for (const item of items) {
      const button = document.createElement("button");
      button.type = "button";
      button.disabled = busy;
      button.className = "pc-directory-item";
      setHTML(button, icon(item.directory ? "folder" : "file") + `<span>${esc(item.name)}</span>${item.active ? `<small>${((_a2 = cores.find((item2) => item2.id === directoryCore)) == null ? void 0 : _a2.mode) === "fragments" ? "运行分片" : "启动配置"}</small>` : ""}`);
      if (!item.directory) button.setAttribute("aria-current", String(directoryCore === core && item.path === path));
      button.title = item.path;
      button.onclick = () => item.directory ? browseDirectory(directoryCore, item.path) : confirmDiscard(() => readFile(directoryCore, item.path));
      list.append(button);
    }
    if (!items.length) {
      const empty2 = document.createElement("p");
      empty2.className = "pc-directory-note";
      empty2.textContent = filter ? "没有匹配的配置文件。" : "目录中没有此核心可读取的配置文件。";
      list.append(empty2);
    }
  }
  async function browseDirectory(selected, nextDirectory) {
    const sequence = ++browseSequence;
    browsing = true;
    sync();
    $2("#pc-file-count").textContent = "正在读取目录…";
    try {
      const response = await request("files?" + new URLSearchParams({ core: selected, path: nextDirectory }), { signal: abort.signal });
      if (!alive || sequence !== browseSequence) return;
      directory = response.directory;
      directoryCore = selected;
      directoryFiles = response.files;
      $2("#pc-directory-input").value = directory;
      const count = directoryFiles.filter((item) => !item.directory).length;
      $2("#pc-file-count").textContent = `${count} 份配置` + (response.truncated ? " · 仅显示前 200 项" : "");
      $2("#pc-directory-input").removeAttribute("aria-invalid");
      renderDirectoryFiles();
      rememberWorkspace();
    } catch (error) {
      if (alive && sequence === browseSequence) {
        $2("#pc-file-count").textContent = "目录读取失败";
        $2("#pc-directory-input").setAttribute("aria-invalid", "true");
        result("error", error.message, "请检查目录地址或在选择配置文件中查看允许的目录。", true);
      }
    } finally {
      if (sequence === browseSequence) {
        browsing = false;
        sync();
      }
    }
  }
  function toggleFiles(expanded) {
    root.classList.toggle("pc-files-expanded", expanded);
    $2("#pc-toggle-files").setAttribute("aria-expanded", String(expanded));
    $2("#pc-toggle-files").lastElementChild.textContent = expanded ? "收起列表" : "展开列表";
    requestAnimationFrame(() => editor == null ? void 0 : editor.view.requestMeasure());
  }
  function setMode(next) {
    var _a2;
    mode = next;
    $2("#pc-toggle-files").hidden = mode !== "directory";
    $2(".pc-workspace").dataset.mode = mode;
    $2(".pc-directory-panel").hidden = mode !== "directory";
    for (const button of root.querySelectorAll("[data-pc-mode]")) button.setAttribute("aria-pressed", String(button.dataset.pcMode === mode));
    if (mode === "directory" && serviceReady) browseDirectory(core, directory && directoryCore === core ? directory : path.slice(0, path.lastIndexOf("/")) || ((_a2 = cores.find((item) => item.id === core)) == null ? void 0 : _a2.directory) || "");
    else rememberWorkspace();
    requestAnimationFrame(() => editor == null ? void 0 : editor.view.requestMeasure());
  }
  async function chooseFile() {
    var _a2, _b2;
    if (busy) return;
    let selected = core, directory2 = "";
    const element = dialog("选择配置文件", `<div class="pc-core-options">${cores.map((item) => `<label class="pc-core-option"><input type="radio" name="pc-core" value="${esc(item.id)}" ${item.id === core ? "checked" : ""} ${item.available ? "" : "disabled"}/><img src="${brands[item.id].logo}" alt=""/><span>${brands[item.id].name}${item.available ? "" : " · 未安装"}</span></label>`).join("")}</div><div class="pc-directorybar"><code id="pc-directory"></code><button class="button small" type="button" id="pc-parent">上一级</button></div><div class="pc-files" id="pc-files" aria-live="polite"></div><form id="pc-file-form"><label class="field">配置文件绝对路径<input type="text" id="pc-picker-path" autocomplete="off" spellcheck="false" value="${esc(path)}" required/></label><p class="pc-note" id="pc-picker-roots"></p><p class="pc-form-error" id="pc-picker-error" role="alert" hidden></p></form>`, '<button class="button" data-pc-close>取消</button><button type="submit" form="pc-file-form" class="button primary">读取配置</button>');
    const field = element.querySelector("#pc-picker-path"), error = element.querySelector("#pc-picker-error");
    const showError = (text2) => {
      error.textContent = text2;
      error.hidden = false;
    };
    async function browse(nextDirectory) {
      directory2 = nextDirectory;
      error.hidden = true;
      element.querySelector("#pc-directory").textContent = directory2;
      element.querySelector("#pc-picker-roots").textContent = "配置目录：" + cores.find((item) => item.id === selected).roots.join("、");
      const list = element.querySelector("#pc-files");
      list.textContent = "正在读取目录…";
      try {
        const response = await request("files?" + new URLSearchParams({ core: selected, path: directory2 }), { signal: abort.signal });
        if (!element.isConnected) return;
        directory2 = response.directory;
        element.querySelector("#pc-directory").textContent = directory2;
        list.replaceChildren();
        for (const file of response.files) {
          const button = document.createElement("button");
          button.type = "button";
          setHTML(button, icon(file.directory ? "folder" : "file") + `<span>${esc(file.name)}</span><small>${file.directory ? "目录" : Math.max(1, Math.ceil(file.bytes / 1024)) + " KB"}</small>`);
          button.onclick = () => {
            if (file.directory) browse(file.path);
            else {
              field.value = file.path;
              error.hidden = true;
            }
          };
          list.append(button);
        }
        if (!response.files.length) list.textContent = "目录中没有可选的配置文件，也可以填写完整路径。";
      } catch (failure) {
        list.textContent = "目录暂时无法读取。";
        showError(failure.message);
      }
    }
    element.querySelectorAll('[name="pc-core"]').forEach((input) => input.onchange = () => {
      selected = input.value;
      field.value = cores.find((item) => item.id === selected).path;
      browse(field.value.slice(0, field.value.lastIndexOf("/")));
    });
    element.querySelector("#pc-parent").onclick = () => browse(directory2.slice(0, directory2.lastIndexOf("/")) || "/");
    element.querySelector("#pc-file-form").onsubmit = (event) => {
      event.preventDefault();
      const value = field.value.trim();
      if (!value.startsWith("/") || value.endsWith("/") || value.split("/").includes("..")) {
        showError("请填写配置文件的绝对路径。");
        return;
      }
      element.close();
      confirmDiscard(() => readFile(selected, value));
    };
    browse((path || ((_a2 = cores.find((item) => item.id === selected)) == null ? void 0 : _a2.path) || "/etc/mihomo/config.yaml").slice(0, (path || ((_b2 = cores.find((item) => item.id === selected)) == null ? void 0 : _b2.path) || "/etc/mihomo/config.yaml").lastIndexOf("/")));
  }
  async function loadCores(loadDefault) {
    try {
      const response = await request("cores", { signal: abort.signal });
      if (!alive) return;
      if (!Array.isArray(response.cores)) throw new Error("配置服务返回格式无效，请检查服务版本。");
      cores = response.cores;
      serviceReady = true;
      $2("#pc-setup").hidden = true;
      setHTML($2("#pc-core-select"), cores.map((item) => `<option value="${esc(item.id)}" ${item.available ? "" : "disabled"}>${brands[item.id].name} · ${brands[item.id].format}${item.mode === "fragments" ? " 分片" : ""}${item.available ? "" : " · 未安装"}</option>`).join(""));
      if (loadDefault) {
        let preferred;
        try {
          preferred = JSON.parse(preferences.getItem("localdns-proxy-config-file-v1") || "null");
        } catch {
        }
        const chosen = cores.find((item) => item.id === (preferred == null ? void 0 : preferred.core) && item.available && item.exists) || cores.find((item) => item.available && item.exists);
        if (chosen) {
          await readFile(chosen.id, (preferred == null ? void 0 : preferred.core) === chosen.id && (preferred == null ? void 0 : preferred.path) ? preferred.path : chosen.path);
          if (workspace.core === chosen.id && typeof workspace.directory === "string") {
            directory = workspace.directory;
            directoryCore = chosen.id;
          }
          setMode(chosen.mode === "fragments" ? "directory" : mode);
        } else {
          const empty2 = $2(".pc-empty");
          if (empty2) {
            empty2.querySelector("strong").textContent = "未找到核心配置";
            empty2.querySelector("p").textContent = "请在配置服务中设置核心程序、启动文件和允许目录。";
            $2("#pc-retry").hidden = false;
          }
          result("error", "未找到可读取的核心配置", "请安装对应核心，并在配置管理服务中设置核心程序、启动配置与配置目录。", true);
        }
      }
    } catch (error) {
      report(error);
    } finally {
      sync();
    }
  }
  for (const button of root.querySelectorAll("[data-pc-mode]")) button.onclick = () => setMode(button.dataset.pcMode);
  $2("#pc-toggle-files").onclick = () => toggleFiles(!root.classList.contains("pc-files-expanded"));
  $2("#pc-file-filter").oninput = renderDirectoryFiles;
  $2("#pc-directory-form").onsubmit = (event) => {
    event.preventDefault();
    browseDirectory(core, $2("#pc-directory-input").value.trim());
  };
  $2("#pc-directory-parent").onclick = () => browseDirectory(directoryCore, directory.slice(0, directory.lastIndexOf("/")) || "/");
  $2("#pc-core-select").onchange = (event) => {
    const selected = event.target.value;
    event.target.value = core;
    confirmDiscard(async () => {
      const chosen = cores.find((item) => item.id === selected);
      if (!chosen) return;
      if (await readFile(selected, chosen.path)) {
        directory = "";
        setMode(chosen.mode === "fragments" ? "directory" : mode);
      }
    });
  };
  $2("#pc-http-toggle").onclick = () => {
    const form = $2("#pc-http-form");
    form.hidden = !form.hidden;
    $2("#pc-http-toggle").setAttribute("aria-expanded", String(!form.hidden));
    if (!form.hidden) $2("#pc-http-url").focus();
  };
  $2("#pc-http-form").onsubmit = (event) => {
    event.preventDefault();
    confirmDiscard(importHTTP);
  };
  $2("#pc-http-url").oninput = () => {
    $2("#pc-http-error").hidden = true;
    $2("#pc-http-url").removeAttribute("aria-invalid");
  };
  root.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && root.classList.contains("pc-focused") && !document.querySelector(".pc-dialog[open]")) {
      event.preventDefault();
      $2("#pc-focus").click();
    }
  });
  $2("#pc-back").onclick = () => navigate2("management");
  $2("#pc-retry").onclick = async () => {
    try {
      tools = tools || await vendor();
      await loadCores(true);
    } catch (error) {
      report(error);
    }
  };
  $2("#pc-choose").onclick = chooseFile;
  $2("#pc-reread").onclick = () => confirmDiscard(() => readFile(core, path));
  $2("#pc-check").onclick = async () => {
    setBusy(true);
    result("working", "正在执行核心校验…");
    try {
      await check();
    } catch (error) {
      report(error);
    } finally {
      setBusy(false);
    }
  };
  $2("#pc-save").onclick = () => compare(true);
  $2("#pc-diff").onclick = () => compare();
  $2("#pc-search").onclick = () => editor == null ? void 0 : editor.search();
  $2("#pc-focus").onclick = () => {
    const focus = !root.classList.contains("pc-focused");
    root.classList.toggle("pc-focused", focus);
    $2("#pc-focus").setAttribute("aria-pressed", String(focus));
    $2("#pc-focus").setAttribute("aria-label", focus ? "退出专注编辑" : "专注编辑");
    editor == null ? void 0 : editor.view.requestMeasure();
  };
  const beforeUnload = (event) => {
    if (dirty() || busy) {
      event.preventDefault();
      event.returnValue = "";
    }
  };
  const resize = () => editor == null ? void 0 : editor.view.requestMeasure();
  window.addEventListener("beforeunload", beforeUnload);
  window.addEventListener("localdns:layoutchange", resize);
  window.addEventListener("resize", resize);
  const dispose = () => {
    alive = false;
    abort.abort();
    editor == null ? void 0 : editor.destroy();
    root.classList.remove("pc-focused");
    window.removeEventListener("beforeunload", beforeUnload);
    window.removeEventListener("localdns:layoutchange", resize);
    window.removeEventListener("resize", resize);
    document.querySelectorAll(".pc-dialog").forEach((element) => element.close());
    if (active === current) active = null;
  };
  scope == null ? void 0 : scope.add(dispose);
  sync();
  try {
    tools = await vendor();
    if (alive) await loadCores(true);
  } catch (error) {
    if (alive) report(error);
  }
  if (!scope) return dispose;
}
function requestLeave() {
  if (active == null ? void 0 : active.isBusy()) {
    active.notify("配置操作尚未完成，请等待结果。", "info");
    return false;
  }
  if (!(active == null ? void 0 : active.dirty())) return true;
  return new Promise((resolve) => {
    let discarded = false;
    const element = dialog("放弃尚未保存的修改？", "<p>离开后，当前未保存的修改将丢失。</p>", '<button class="button" data-pc-close>继续编辑</button><button class="button danger" id="pc-discard">放弃修改并离开</button>');
    element.querySelector("#pc-discard").onclick = () => {
      discarded = true;
      element.close();
    };
    element.addEventListener("close", () => resolve(discarded), { once: true });
  });
}
const proxyConfigRoute = { mount, canLeave: requestLeave };
function setApiStatus(ok, text2) {
  const box = $("#sidebar-status"), dot = $(".status-dot", box), strong = $("strong", box);
  dot.className = `status-dot ${ok ? "online" : "offline"}`;
  strong.textContent = ((identityService == null ? void 0 : identityService.getName()) || "LocalDNS") + (ok ? " 运行正常" : " 连接异常");
  $("#api-endpoint-label").textContent = text2 || (API_BASE || location.host);
  shellInterfaceService == null ? void 0 : shellInterfaceService.connection(ok, text2);
}
let navigationSeq = 0;
function routeModule(id) {
  return { overview: overviewRoute, logs: logsRoute, upstreams: upstreamsRoute, rules: rulesRoute, management: managementRoute, "proxy-config": proxyConfigRoute }[id];
}
async function navigate(id, write = true) {
  const sequence = ++navigationSeq;
  id = resolveRoute(id);
  const active2 = routeModule(state.route);
  if (active2.canLeave) {
    const decision = active2.canLeave();
    if (location.hash !== `#/${state.route}`) {
      history.replaceState(null, "", `#/${state.route}`);
      write = true;
    }
    if (!await decision || sequence !== navigationSeq) return;
  }
  state.route = id;
  if (write && location.hash !== `#/${id}`) history.pushState(null, "", `#/${id}`);
  return renderRoute(false, false, true);
}
function updateNav() {
  const r = routeDefs.find((x) => x.id === state.route);
  $("#page-title").textContent = r.label;
  $("#page-subtitle").textContent = r.subtitle;
  $$("[data-route]").forEach((x) => x.classList.toggle("active", x.dataset.route === state.route));
}
function trackRouteCleanup(fn) {
  return currentScope().add(fn);
}
function cleanupRouteUi() {
  currentScope().dispose();
}
function viewSnapshot() {
  const scrollers = [...page.querySelectorAll(".rank-list,.table-wrap,.overview-donut-legend,textarea")];
  const fields = [...page.querySelectorAll("input[id],select[id],textarea[id]")];
  return {
    y: window.scrollY,
    inner: scrollers.map((el) => [el.scrollTop, el.scrollLeft]),
    fields: fields.map((el) => [el.id, el.type === "checkbox" ? el.checked : el.value])
  };
}
function viewRestore(snap) {
  if (!snap) return;
  const el = document.documentElement, prev = el.style.scrollBehavior;
  el.style.scrollBehavior = "auto";
  window.scrollTo(0, snap.y);
  el.style.scrollBehavior = prev;
  const scrollers = [...page.querySelectorAll(".rank-list,.table-wrap,.overview-donut-legend,textarea")];
  if (scrollers.length === snap.inner.length) scrollers.forEach((n, i) => {
    n.scrollTop = snap.inner[i][0];
    n.scrollLeft = snap.inner[i][1];
  });
  snap.fields.forEach(([id, v]) => {
    const n = document.getElementById(id);
    if (!n || !page.contains(n)) return;
    if (n.type === "checkbox") n.checked = v;
    else if (n.value !== v) n.value = v;
  });
}
let pendingScroll = null;
let scrollSaveTimer = 0, userScrolled = false;
const saveScroll = () => {
  if (pendingScroll) return;
  try {
    sessionPreferences.setItem("localdnsScroll", JSON.stringify({ route: state.route, y: Math.round(window.scrollY) }));
  } catch {
  }
};
function restoreScroll() {
  const want = pendingScroll;
  if (!want) return;
  if (want.route !== state.route) {
    pendingScroll = null;
    return;
  }
  userScrolled = false;
  const scope = currentScope();
  const go = () => {
    if (scope.signal.aborted || userScrolled || pendingScroll !== want) return;
    window.scrollTo({ top: want.y, behavior: "instant" });
  };
  requestAnimationFrame(() => requestAnimationFrame(go));
  for (const t of [150, 400, 900]) scope.timeout(go, t);
  scope.timeout(() => {
    if (pendingScroll === want) pendingScroll = null;
  }, 1200);
}
async function renderRoute(force = false, silent = false, approved = false) {
  const activeRoute = state.route;
  if (!approved && routeModule(activeRoute).canLeave && !await routeModule(activeRoute).canLeave()) return;
  if (state.route !== activeRoute) return;
  shellInterfaceService == null ? void 0 : shellInterfaceService.rememberDraft();
  const scope = beginRoute();
  scope.add(() => {
    topologyFlowService == null ? void 0 : topologyFlowService.stop();
    closeUpstreamErrorPopover();
    closeSlowTypePopover();
    closeDrawer();
    modalClose();
  });
  topologyFlowService == null ? void 0 : topologyFlowService.stop();
  closeUpstreamErrorPopover();
  const seq = (state.renderSeq || 0) + 1;
  state.renderSeq = seq;
  const snap = silent ? viewSnapshot() : null;
  const oldCharts = silent ? takeCharts() : null;
  scope.add(() => {
    if (oldCharts) {
      oldCharts.forEach((chart2) => {
        try {
          chart2.destroy();
        } catch {
        }
      });
      oldCharts.length = 0;
    }
  });
  state.silent = silent;
  if (silent) {
    page.style.minHeight = page.offsetHeight + "px";
  } else {
    destroyCharts();
    page.style.minHeight = "";
  }
  updateNav();
  if (!silent) setHTML(page, loadingPage());
  try {
    const route = routeModule(state.route);
    const cleanup = await route.mount(page, { signal: scope.signal, scope, navigate, notify: toast });
    if (typeof cleanup === "function") scope.add(cleanup);
    if (seq !== state.renderSeq) return;
    shellInterfaceService == null ? void 0 : shellInterfaceService.apply();
    workspaceService.finish(page);
    if (!silent) {
      playViewEnter();
      animateCountUps(page);
    }
    syncAllSegThumbs();
    state.silent = false;
    viewRestore(snap);
    setApiStatus(true);
  } catch (e) {
    if (seq !== state.renderSeq || (e == null ? void 0 : e.name) === "AbortError") return;
    console.error(e);
    setApiStatus(false, e.message);
    if (silent) {
      if (oldCharts) {
        restoreCharts(oldCharts);
        oldCharts.length = 0;
      }
    } else {
      setHTML(page, `<div class="error-panel"><strong>无法加载当前页面</strong><p>${esc$1(e.message)}</p><button class="button" id="retry-page">${icon$1("refresh")}重新加载</button></div>`);
      $("#retry-page").onclick = () => renderRoute(true);
    }
  }
  if (oldCharts) oldCharts.forEach((c) => {
    try {
      c.destroy();
    } catch {
    }
  });
  if (seq !== state.renderSeq) return;
  state.silent = false;
  if (silent) scope.timeout(() => {
    if (seq === state.renderSeq) page.style.minHeight = "";
  }, 1500);
  if (!silent) restoreScroll();
  if (["logs", "overview"].includes(state.route)) {
    scope.interval(() => {
      if (document.visibilityState === "visible" && !busyViewing() && !(state.route === "logs" && state.logsPaused)) renderRoute(true, true);
    }, CONFIG.refreshInterval * 1e3);
  }
}
function busyViewing() {
  var _a2;
  const a = document.activeElement;
  if (a && ((_a2 = a.closest) == null ? void 0 : _a2.call(a, "main")) && ["INPUT", "TEXTAREA", "SELECT"].includes(a.tagName)) return true;
  return !!document.querySelector("dialog[open], .drawer.open");
}
function initialize$3() {
  try {
    history.scrollRestoration = "manual";
  } catch {
  }
  try {
    const v = JSON.parse(sessionPreferences.getItem("localdnsScroll") || "null");
    if (v && typeof v.route === "string" && v.y > 0) pendingScroll = v;
  } catch {
  }
  window.addEventListener("scroll", () => {
    clearTimeout(scrollSaveTimer);
    scrollSaveTimer = setTimeout(saveScroll, 120);
  }, { passive: true });
  window.addEventListener("pagehide", () => {
    saveScroll();
    currentScope().dispose();
    destroyCharts();
  });
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) renderRoute(true);
  });
  for (const ev of ["wheel", "touchstart", "keydown", "mousedown"]) window.addEventListener(ev, () => {
    userScrolled = true;
    pendingScroll = null;
  }, { passive: true, capture: true });
}
function initialize$2() {
  "use strict";
  function setup() {
    var _a2, _b2, _c, _d, _e, _f, _g, _h;
    const panel = document.querySelector("#bg-customizer-popover");
    if (!panel || panel.querySelector(".appearance-tabs")) return;
    panel.classList.add("appearance-panel");
    const title = panel.querySelector(".bcp-title");
    title.id = "appearance-title";
    panel.setAttribute("aria-labelledby", title.id);
    const tabs = document.createElement("div");
    tabs.className = "appearance-tabs";
    tabs.setAttribute("role", "tablist");
    tabs.setAttribute("aria-label", "外观设置分栏");
    const content = document.createElement("div");
    content.className = "appearance-content";
    const definitions = [["theme", "主题背景"], ["material", "材质与布局"], ["brand", "品牌与字体"]];
    const panes = /* @__PURE__ */ new Map();
    for (const [key, label] of definitions) {
      const button = document.createElement("button");
      button.type = "button";
      button.id = "appearance-tab-" + key;
      button.className = "appearance-tab";
      button.dataset.appearanceTab = key;
      button.setAttribute("role", "tab");
      button.setAttribute("aria-controls", "appearance-pane-" + key);
      button.textContent = label;
      tabs.append(button);
      const pane = document.createElement("section");
      pane.id = "appearance-pane-" + key;
      pane.className = "appearance-pane";
      pane.setAttribute("role", "tabpanel");
      pane.setAttribute("aria-labelledby", button.id);
      panes.set(key, pane);
      content.append(pane);
    }
    title.after(tabs, content);
    const move = (selector, key) => {
      const element = panel.querySelector(selector);
      if (element) panes.get(key).append(element);
    };
    const group = (id, name, key) => {
      const element = document.createElement("div");
      element.className = "bcp-group";
      element.id = id;
      const heading = document.createElement("div");
      heading.className = "bcp-group-title";
      heading.textContent = name;
      element.append(heading);
      panes.get(key).append(element);
      return element;
    };
    move("#bcp-group-skin", "theme");
    move("#bcp-group-claude", "theme");
    move("#bcp-group-glass-bg", "theme");
    move("#bcp-group-navigation", "material");
    move("#bcp-group-glass-material", "material");
    const paper = group("bcp-group-paper-material", "纸张质感", "material");
    paper.dataset.appearanceSkin = "claude";
    for (const id of ["slider-paper-grain", "slider-paper-warmth"]) {
      const row = (_a2 = panel.querySelector("#" + id)) == null ? void 0 : _a2.closest(".bcp-row");
      if (row) paper.append(row);
    }
    const geometry = group("bcp-group-geometry", "界面形态", "material");
    const radius = (_b2 = panel.querySelector("#slider-radius")) == null ? void 0 : _b2.closest(".bcp-row");
    if (radius) geometry.append(radius);
    move("#bcp-group-interface", "brand");
    move(".bcp-fonts", "brand");
    move(".shared-ui-settings", "brand");
    panel.querySelectorAll(".bcp-row:has(input[type=range])").forEach((row) => {
      const label = row.querySelector("label"), slider = row.querySelector("input[type=range]"), value = row.querySelector("strong");
      if (!label || !slider || !value) return;
      row.classList.add("appearance-slider");
      row.replaceChildren(label, slider, value);
    });
    for (const [id, text2] of [["slider-blur", "模糊半径"], ["slider-alpha", "面板遮盖度"], ["slider-dimmer", "背景暗化"], ["slider-paper-grain", "纸张肌理"], ["slider-paper-warmth", "温润层次"]]) {
      const label = panel.querySelector(`label[for="${id}"]`);
      if (label) {
        label.title = label.textContent;
        label.textContent = text2;
      }
    }
    (_c = panel.querySelector('label[for="bg-url-input"]')) == null ? void 0 : _c.parentElement.classList.add("appearance-visually-hidden");
    (_d = panel.querySelector("#bg-url-input")) == null ? void 0 : _d.setAttribute("placeholder", "在线图片 URL（https://…）");
    const verRow = (_e = panel.querySelector("#select-brand-ver")) == null ? void 0 : _e.closest(".bcp-row");
    if (verRow) {
      verRow.classList.add("appearance-select");
      const label = verRow.querySelector("label"), select2 = verRow.querySelector("select");
      const value = verRow.querySelector("#val-brand-ver"), input = verRow.querySelector("#input-brand-ver");
      const fields = document.createElement("div");
      fields.className = "appearance-select-fields";
      fields.append(select2, input);
      input.setAttribute("aria-label", "自定义版本标签文字");
      value.classList.add("appearance-visually-hidden");
      verRow.replaceChildren(label, fields, value);
    }
    const uploadRow = (_f = panel.querySelector("#btn-font-upload")) == null ? void 0 : _f.closest(".bcp-row");
    if (uploadRow) {
      uploadRow.classList.add("appearance-upload");
      const heading = uploadRow.querySelector(".bcp-row-head"), actions = uploadRow.querySelector(".bcp-inline");
      const status = heading.querySelector("#val-font-upload");
      heading.querySelector("span").textContent = "自定义字体";
      heading.append(status, actions);
    }
    const fonts = panel.querySelector(".bcp-fonts");
    if (fonts) {
      const notes = [...fonts.querySelectorAll(".font-note")];
      const help = document.createElement("details");
      help.className = "appearance-font-help";
      const summary = document.createElement("summary");
      summary.textContent = "字体说明与上传限制";
      help.append(summary, ...notes);
      (_g = fonts.querySelector("#typography-save-status")) == null ? void 0 : _g.before(help);
    }
    panel.querySelectorAll("#bcp-group-glass-bg .bcp-inline").forEach((row) => row.classList.add("appearance-inline"));
    (_h = panel.querySelector(".identity-settings")) == null ? void 0 : _h.addEventListener("toggle", () => {
      content.scrollTop = 0;
    });
    let selected = "theme";
    function select(key, focus = false) {
      if (!panes.has(key)) return;
      selected = key;
      content.scrollTop = 0;
      for (const [id, pane] of panes) {
        pane.hidden = id !== key;
        pane.inert = id !== key;
      }
      tabs.querySelectorAll("button").forEach((button) => {
        const active2 = button.dataset.appearanceTab === key;
        button.setAttribute("aria-selected", String(active2));
        button.tabIndex = active2 ? 0 : -1;
        if (active2 && focus) button.focus();
      });
    }
    tabs.addEventListener("click", (event) => {
      const button = event.target.closest("[data-appearance-tab]");
      if (button) select(button.dataset.appearanceTab);
    });
    tabs.addEventListener("keydown", (event) => {
      const keys = definitions.map(([key]) => key), index = keys.indexOf(selected);
      let next;
      if (event.key === "ArrowRight") next = keys[(index + 1) % keys.length];
      if (event.key === "ArrowLeft") next = keys[(index + keys.length - 1) % keys.length];
      if (event.key === "Home") next = keys[0];
      if (event.key === "End") next = keys.at(-1);
      if (next) {
        event.preventDefault();
        event.stopPropagation();
        select(next, true);
      }
    });
    select("theme");
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", setup, { once: true });
  else setup();
}
function initialize$1() {
  "use strict";
  let saved = {};
  try {
    saved = JSON.parse(preferences.getItem("localdns-material-v2") || "{}");
  } catch {
  }
  if (!saved || typeof saved !== "object" || Array.isArray(saved)) saved = {};
  const store = (patch) => {
    saved = { ...saved, ...patch };
    try {
      preferences.setItem("localdns-material-v2", JSON.stringify(saved));
    } catch {
    }
    ;
  };
  const BRAND_VER_MODES = ["hidden", "version", "custom"];
  const BRAND_VER_LABELS = { hidden: "隐藏", version: "跟随版本", custom: "自定义" };
  const brandVerMode = () => BRAND_VER_MODES.includes(saved.brandVer) ? saved.brandVer : "version";
  function applyBrand() {
    const mode = brandVerMode();
    const custom = String(saved.brandVerText || "").trim();
    document.documentElement.dataset.brandVerMode = mode;
    const tag = document.querySelector("#brand-version-tag");
    if (tag) {
      const visible = mode === "version" || mode === "custom" && !!custom;
      tag.style.display = visible ? "" : "none";
      if (mode === "custom") tag.textContent = custom;
      else if (mode === "version") tag.textContent = tag.dataset.backendVersion || "—";
    }
    const verVal = document.querySelector("#val-brand-ver");
    if (verVal) verVal.textContent = BRAND_VER_LABELS[mode];
    const sel = document.querySelector("#select-brand-ver");
    if (sel && sel.value !== mode) sel.value = mode;
    const verInput = document.querySelector("#input-brand-ver");
    if (verInput) {
      verInput.hidden = mode !== "custom";
      if (verInput.value !== custom) verInput.value = custom;
    }
  }
  function initBrand() {
    const verSel = document.querySelector("#select-brand-ver");
    if (verSel) verSel.addEventListener("change", () => {
      store({ brandVer: verSel.value });
      applyBrand();
    });
    const verInput = document.querySelector("#input-brand-ver");
    if (verInput) verInput.addEventListener("input", () => {
      store({ brandVerText: verInput.value });
      applyBrand();
    });
    applyBrand();
  }
  function syncPresetLabel() {
    const el = document.querySelector("#val-preset");
    if (!el) return;
    const wall = document.querySelector("#wallpaper-layer");
    const preset = wall && wall.dataset.preset ? wall.dataset.preset : "cosmos";
    const btn = document.querySelector(`[data-bg-preset="${preset}"]`);
    el.textContent = btn ? String(btn.getAttribute("aria-label") || preset).replace(/\s*[（(].*$/, "") : "自定义壁纸";
  }
  {
    const wall = document.querySelector("#wallpaper-layer");
    if (wall) new MutationObserver(syncPresetLabel).observe(wall, { attributes: true, attributeFilter: ["data-preset"] });
    syncPresetLabel();
  }
  applyBrand();
  const init = () => {
    const wall = document.querySelector("#wallpaper-layer");
    if (!wall) return;
    const canvas = document.createElement("canvas");
    canvas.id = "ambient-orbit";
    canvas.setAttribute("aria-hidden", "true");
    wall.append(canvas);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let scheduled = false;
    function draw() {
      scheduled = false;
      const w = innerWidth, h = innerHeight, dpr = Math.min(devicePixelRatio || 1, 1.5);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const light = document.documentElement.dataset.theme === "light-glass";
      const cx = w * 0.54, cy = h * 1.1, r = Math.max(h * 0.88, w * 0.45);
      let seed = 91353;
      const rand = () => {
        seed = Math.imul(seed, 1664525) + 1013904223 >>> 0;
        return seed / 4294967296;
      };
      const atmosphere = ctx.createRadialGradient(cx - r * 0.34, cy - r * 0.72, r * 0.08, cx, cy, r * 1.13);
      atmosphere.addColorStop(0, light ? "rgba(154,119,72,.12)" : "rgba(173,132,80,.14)");
      atmosphere.addColorStop(0.65, light ? "rgba(148,112,69,.04)" : "rgba(139,102,57,.06)");
      atmosphere.addColorStop(1, "rgba(100,74,42,0)");
      ctx.fillStyle = atmosphere;
      ctx.fillRect(0, 0, w, h);
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.clip();
      const body = ctx.createRadialGradient(cx - r * 0.43, cy - r * 0.85, r * 0.03, cx + r * 0.15, cy + r * 0.15, r * 1.3);
      body.addColorStop(0, light ? "rgba(124,96,60,.13)" : "rgba(166,126,73,.24)");
      body.addColorStop(0.28, light ? "rgba(155,137,112,.06)" : "rgba(83,65,42,.11)");
      body.addColorStop(0.7, light ? "rgba(230,235,244,.02)" : "rgba(8,10,12,.05)");
      body.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = body;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
      for (let i = 0; i < 7200; i++) {
        const angle = -Math.PI + rand() * Math.PI, spread = (rand() - 0.5) * r * 0.105;
        const radius = r + spread, x = cx + Math.cos(angle) * radius, y = cy + Math.sin(angle) * radius;
        if (x < 0 || x > w || y < 0 || y > h) continue;
        const rim = Math.exp(-Math.abs(spread) / (r * 0.023)), upper = Math.max(0.05, -Math.sin(angle) * 0.85 - Math.cos(angle) * 0.24);
        const a = (0.025 + rim * upper * 0.34) * (light ? 0.4 : 1), size = 0.35 + rand() * 1.1;
        ctx.fillStyle = light ? `rgba(112,83,45,${a})` : `rgba(209,172,111,${a})`;
        ctx.fillRect(x, y, size, size);
      }
      for (let i = 0; i < 2600; i++) {
        const x = (rand() * 2 - 1) * r, y = -rand() * r, dist = (x * x + y * y) / (r * r);
        if (dist > 1) continue;
        const px = cx + x, py = cy + y;
        if (px < 0 || px > w || py < 0 || py > h) continue;
        const edge = Math.pow(dist, 4), bright = Math.max(0.01, -y / r - x / r * 0.28);
        ctx.fillStyle = light ? `rgba(126,93,51,${edge * bright * 0.055})` : `rgba(170,135,81,${edge * bright * 0.13})`;
        ctx.fillRect(px, py, 0.5 + rand() * 0.7, 0.5 + rand() * 0.7);
      }
    }
    const schedule = () => {
      if (!scheduled) {
        scheduled = true;
        requestAnimationFrame(draw);
      }
    };
    window.addEventListener("resize", schedule, { passive: true });
    new MutationObserver(schedule).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    draw();
    function applyMaterial(name, value) {
      const root = document.documentElement.style;
      if (name === "dimmer") root.setProperty("--bg-dimmer", (value / 100).toFixed(2));
      else if (name === "radius") root.setProperty("--radius-scale", (value / 100).toFixed(2));
      else root.setProperty("--glass-" + name, name === "blur" ? value + "px" : (value / 100).toFixed(2));
    }
    const defaults = { blur: 14, alpha: 48, dimmer: 22, radius: 100 }, units = { blur: "px", alpha: "%", dimmer: "%", radius: "%" };
    for (const name of ["blur", "alpha", "dimmer", "radius"]) {
      const input = document.querySelector("#slider-" + name), label = document.querySelector("#val-" + name);
      if (!input) continue;
      const value = Math.min(+input.max, Math.max(+input.min, Number.isFinite(+saved[name]) ? +saved[name] : defaults[name]));
      input.value = value;
      applyMaterial(name, value);
      if (label) label.textContent = value + units[name];
      input.addEventListener("input", () => {
        const v = +input.value;
        applyMaterial(name, v);
        if (label) label.textContent = v + units[name];
        store({ [name]: v });
      });
    }
  };
  const initAll = () => {
    initBrand();
    syncPresetLabel();
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
    document.addEventListener("DOMContentLoaded", initAll, { once: true });
  } else {
    init();
    initAll();
  }
}
function initialize() {
  "use strict";
  const header = document.querySelector(".top-header-grid");
  if (!header) return;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)");
  let width = document.documentElement.clientWidth;
  let current = 0, target = 0, frame = 0, previousTime = 0;
  const clamp = (value) => Math.max(0, Math.min(1, value));
  function paint() {
    const mobile = width <= 600;
    const inset = mobile ? 8 : 16;
    const topGutter = mobile ? 14 : width <= 1120 ? 18 : Math.max(24, (width - 1720) / 2 + 24);
    const floatingGutter = mobile ? 22 : width <= 900 ? 28 : 40;
    header.style.setProperty("--navbar-progress", current.toFixed(4));
    header.style.setProperty("--navbar-offset", `${(current * (mobile ? 8 : 12)).toFixed(2)}px`);
    header.style.setProperty("--navbar-scale", (1 - 2 * inset * current / width).toFixed(6));
    header.style.setProperty("--navbar-radius", `${(current * 16).toFixed(2)}px`);
    header.style.setProperty("--navbar-gutter", `${(topGutter + (floatingGutter - topGutter) * current).toFixed(2)}px`);
    header.dataset.floating = String(current > 0.01);
  }
  function tick(time) {
    const dt = Math.min(64, previousTime ? time - previousTime : 16.67);
    previousTime = time;
    current += (target - current) * (1 - Math.exp(-dt / 70));
    if (Math.abs(target - current) < 5e-4) current = target;
    paint();
    if (current !== target) frame = requestAnimationFrame(tick);
    else {
      frame = 0;
      previousTime = 0;
    }
  }
  function update() {
    const scroll = Math.max(0, window.scrollY);
    target = reduce.matches ? Number(scroll > 12) : clamp(scroll / 120);
    if (reduce.matches || document.hidden) {
      cancelAnimationFrame(frame);
      frame = 0;
      previousTime = 0;
      current = target;
      paint();
    } else if (!frame && current !== target) frame = requestAnimationFrame(tick);
  }
  window.addEventListener("scroll", update, { passive: true });
  window.addEventListener("resize", () => {
    width = document.documentElement.clientWidth;
    paint();
    update();
  }, { passive: true });
  window.addEventListener("pageshow", update);
  document.addEventListener("visibilitychange", update);
  reduce.addEventListener("change", update);
  document.addEventListener("keydown", (event) => {
    var _a2;
    if (event.key !== "Escape") return;
    const popover = document.querySelector("#bg-customizer-popover");
    if (popover == null ? void 0 : popover.classList.contains("open")) {
      document.querySelector("#btn-close-bg-popover").click();
      document.querySelector("#btn-open-bg-customizer").focus();
    } else {
      const search = document.querySelector(".cmd-search-bar.console-search-open");
      if (search) {
        search.classList.remove("console-search-open");
        (_a2 = document.querySelector(".console-search-button")) == null ? void 0 : _a2.focus();
      }
    }
  });
  current = target = reduce.matches ? Number(window.scrollY > 12) : clamp(window.scrollY / 120);
  paint();
}
initialize$n();
initialize$r();
initialize$j();
initialize$i();
initialize$m();
initialize$l();
initialize$q();
initialize$h();
initialize$k();
initialize$g();
initialize$p();
initialize$f();
initialize$e();
initialize$d();
initialize$c();
initialize$b();
initialize$a();
initialize$9();
initialize$8();
initialize$o();
initialize$7();
initialize$3();
initialize$4();
initialize$2();
initialize$1();
initialize();
initialize$5();
initialize$6();
