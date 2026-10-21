// Engrare Edit: ortak yardimcilar (API istegi, DOM, bicimlendirme, ikonlar).

export const API = window.API || location.origin;

export const $ = (s, root = document) => root.querySelector(s);
export const $$ = (s, root = document) => [...root.querySelectorAll(s)];

export function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const round3 = (v) => Math.round(v * 1000) / 1000;
export const uid = () => Math.random().toString(36).slice(2, 10);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const enc = encodeURIComponent;

export class HttpError extends Error {
  constructor(status, msg) {
    super(msg);
    this.status = status;
  }
}

export async function api(path, opts = {}) {
  const o = { credentials: "include", ...opts };
  if (o.body && typeof o.body !== "string") {
    o.headers = { ...(o.headers || {}), "content-type": "application/json" };
    o.body = JSON.stringify(o.body);
  }
  const r = await fetch(API + path, o);
  if (!r.ok) {
    let msg = r.statusText;
    try { msg = (await r.json()).detail || msg; } catch (e) { /* govde yok */ }
    if (r.status === 401 && !path.startsWith("/api/auth/")) window.dispatchEvent(new Event("auth:required"));
    throw new HttpError(r.status, msg);
  }
  const ct = r.headers.get("content-type") || "";
  return ct.includes("json") ? r.json() : r.text();
}

export const url = {
  original: (p) => `${API}/drive/api/download?path=${enc(p)}`,
  proxy: (p) => `${API}/drive/api/proxy?path=${enc(p)}`,
  thumb: (p) => `${API}/drive/api/thumb?path=${enc(p)}`,
  strip: (p, n) => `${API}/drive/api/filmstrip?path=${enc(p)}&n=${n}`,
  render: (file) => `${API}/api/renders/${enc(file)}`,
};

// 75.5 -> "1:15.50" (frac = ondalik hane)
export function fmtTime(t, frac = 2) {
  const k = 10 ** frac;
  const u = Math.floor(Math.max(0, t || 0) * k + 1e-6);
  const m = Math.floor(u / (60 * k));
  const s = (u % (60 * k)) / k;
  return `${m}:${s.toFixed(frac).padStart(frac ? frac + 3 : 2, "0")}`;
}

// Kisa sure etiketi: 3.2s, 14s, 1:05
export function fmtDur(t) {
  if (t < 10) return `${t.toFixed(1)}s`;
  if (t < 60) return `${Math.round(t)}s`;
  return fmtTime(t, 0);
}

export function fmtAgo(ts) {
  const d = Date.now() / 1000 - ts;
  if (d < 60) return "az önce";
  if (d < 3600) return `${Math.floor(d / 60)} dk önce`;
  if (d < 86400) return `${Math.floor(d / 3600)} sa önce`;
  return new Date(ts * 1000).toLocaleDateString("tr-TR", { day: "numeric", month: "short" });
}

let toastTimer = 0;
export function toast(msg, ms = 2200) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

export function vibrate(ms = 10) {
  try { navigator.vibrate?.(ms); } catch (e) { /* desteklenmiyor */ }
}

// ---- ikonlar (24x24 cizgi) ----
const ICONS = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
  play: '<path d="M7 4.5v15l12.5-7.5z" fill="currentColor" stroke="none"/>',
  pause: '<path d="M6.5 5H10v14H6.5zM14 5h3.5v14H14z" fill="currentColor" stroke="none"/>',
  prev: '<path d="M18 6v12l-8.5-6z" fill="currentColor" stroke="none"/><path d="M6 6v12"/>',
  next: '<path d="M6 6v12l8.5-6z" fill="currentColor" stroke="none"/><path d="M18 6v12"/>',
  zoomIn: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2M11 8.5v5M8.5 11h5"/>',
  zoomOut: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2M8.5 11h5"/>',
  split: '<circle cx="6" cy="6" r="2.6"/><circle cx="6" cy="18" r="2.6"/><path d="M20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12"/>',
  trimL: '<path d="M4 4v16"/><path d="M20 12H9M13 8l-4 4 4 4"/>',
  trimR: '<path d="M20 4v16"/><path d="M4 12h11M11 8l4 4-4 4"/>',
  speed: '<path d="M4.5 17a8 8 0 1 1 15 0"/><path d="m12 13 3.5-4"/>',
  volume: '<path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>',
  mute: '<path d="M11 5 6 9H3v6h3l5 4z"/><path d="m16 9 5 6M21 9l-5 6"/>',
  fade: '<path d="M3 19h18"/><path d="M3 19 9 7h6l6 12"/>',
  fit: '<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>',
  cover: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  text: '<path d="M5 7V5h14v2M12 5v14M9 19h6"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.8"/><path d="m4 18 5-5 4 4 3-3 4 4"/>',
  music: '<path d="M9 18V6l11-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>',
  format: '<rect x="6.5" y="3" width="11" height="18" rx="2"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  replace: '<path d="M4 9a8 8 0 0 1 14.3-3.3L20 8"/><path d="M20 3v5h-5"/><path d="M20 15a8 8 0 0 1-14.3 3.3L4 16"/><path d="M4 21v-5h5"/>',
  sliders: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
  download: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5"/><path d="M5 20h14"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7"/>',
  film: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/>',
  magic: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 16l.7 1.8L21.5 18.5l-1.8.7L19 21l-.7-1.8-1.8-.7 1.8-.7z"/>',
  cc: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M10.2 10.3a2.3 2.3 0 1 0 0 3.4M16.4 10.3a2.3 2.3 0 1 0 0 3.4"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 12.5 9 5 9-5"/><path d="m3 17 9 5 9-5" opacity=".5"/>',
  up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  down: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  logout: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l5-5-5-5M15 12H3"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  attach: '<path d="m20.5 11.5-8.4 8.4a5.5 5.5 0 0 1-7.8-7.8l8.4-8.4a3.7 3.7 0 0 1 5.2 5.2l-8.4 8.4a1.8 1.8 0 0 1-2.6-2.6l7.8-7.8"/>',
  drive: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
};

export function icon(name, cls = "ic") {
  return `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ""}</svg>`;
}

// Butonu ikon (+ istege bagli etiket) ile doldurur
export function iconBtn(btn, name, label) {
  btn.innerHTML = icon(name) + (label ? `<span>${label}</span>` : "");
  return btn;
}
