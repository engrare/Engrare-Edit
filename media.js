// Medya onbellegi: probe, onizleme proxy'si, filmstrip sprite'i, kucuk resim.
// Proxy hazir olana kadar orijinal dosya oynatilir; hazir olunca "proxy" olayi gelir.
import { api, enc, sleep, url } from "./api.js";

export const events = new EventTarget();
const fire = (type, detail) => events.dispatchEvent(new CustomEvent(type, { detail }));

const probes = new Map(); // path -> Promise<info | null>
const proxies = new Map(); // path -> pending | ready | failed
const sprites = new Map(); // path|n -> {img, n, ok, tw, th}
const thumbs = new Map(); // path -> {img, ok}

export function probe(path) {
  if (!probes.has(path)) {
    probes.set(path, api(`/drive/api/probe?path=${enc(path)}`).catch(() => null));
  }
  return probes.get(path);
}

async function watchProxy(path) {
  proxies.set(path, "pending");
  for (let i = 0; i < 600; i++) {
    let r;
    try {
      r = await api(`/drive/api/proxy/status?path=${enc(path)}`);
    } catch (e) {
      proxies.set(path, "failed");
      return;
    }
    if (r.ready) {
      proxies.set(path, "ready");
      fire("proxy", path);
      return;
    }
    if (r.state === "failed") {
      proxies.set(path, "failed");
      return;
    }
    await sleep(i < 20 ? 1500 : 5000);
  }
}

// Onizleme icin video adresi (proxy hazirsa proxy, degilse orijinal)
export function videoUrl(path) {
  const st = proxies.get(path);
  if (st === undefined) watchProxy(path);
  return st === "ready" ? url.proxy(path) : url.original(path);
}
// Proxy tarayicida cozulemezse (bozuk dosya) bir daha kullanma: orijinale don
export function proxyBroken(src) {
  for (const [path, st] of proxies) {
    if (st === "ready" && url.proxy(path) === src) {
      proxies.set(path, "failed");
      fire("proxy", path);
      return true;
    }
  }
  return false;
}
export const imageUrl = (path) => url.original(path);
export const audioUrl = (path) => url.original(path);
export const proxyReady = (path) => proxies.get(path) === "ready";

// Filmstrip: ~saniyede bir kare (8-120). Kare k = kaynak suresi * k / n ani.
export function sprite(path, dur) {
  const n = Math.max(8, Math.min(120, Math.ceil(dur || 8)));
  const key = `${path}|${n}`;
  let s = sprites.get(key);
  if (!s) {
    s = { img: new Image(), n, ok: false, tw: 0, th: 0 };
    s.img.decoding = "async";
    s.img.onload = () => {
      s.ok = true;
      s.tw = s.img.naturalWidth / n;
      s.th = s.img.naturalHeight;
      fire("image");
    };
    s.img.src = url.strip(path, n);
    sprites.set(key, s);
  }
  return s;
}

export function thumb(path) {
  let t = thumbs.get(path);
  if (!t) {
    t = { img: new Image(), ok: false };
    t.img.decoding = "async";
    t.img.onload = () => {
      t.ok = true;
      fire("image");
    };
    t.img.src = url.thumb(path);
    thumbs.set(path, t);
  }
  return t;
}

// Bir sonraki resim klibi gelmeden once tarayici onbellegine al
const preloaded = new Set();
export function preloadImage(path) {
  if (preloaded.has(path)) return;
  preloaded.add(path);
  const i = new Image();
  i.src = imageUrl(path);
}
