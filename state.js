// Proje modeli (v2), zaman hesaplari, duzenleme islemleri, geri al/yinele ve otomatik kayit.
//
// Sema (render.py ile ayni):
//   clips: [{id, path, name, kind: video|image, in, out, srcDur, speed, volume, mute,
//            fadeIn, fadeOut, fit: contain|cover, trans: {type, duration}}]   in/out kaynak saniyesi
//            trans: bu klipten SONRAKI klibe gecis (klip bazli)
//   texts: [{id, text, start, end, x, y (0-1, metnin merkezi), size (yukseklik orani),
//            color, style: plain|box|outline|shadow, font, cap, words, kara, dim}]   start/end timeline saniyesi
//            cap: otomatik altyazidan geldi (toplu silinir/yeniden olusturulur)
//            words: kelime basina [baslangic, bitis] (timeline sn); kara: kelime kelime renklensin (soylenmemis
//            kelimeler dim rengindedir, soylenince color'a doner). Kelime sayisi metinle uyusmazsa vurgu kapanir.
//   images: katmanlar, ana seridin ustune binen ogeler: [{id, kind: image|video, path, name, start, end,
//            x, y (0-1, merkez), size (genislik orani), opacity,
//            video icin: in, srcDur, speed, volume, mute, ar (en/boy)}]   start/end timeline saniyesi
//   audio: {path, name, offset, volume, loop, fadeOut, srcDur} | null
import { API, api, clamp, round3, sleep, uid } from "./api.js";
import { DEFAULT_FONT } from "./fonts.js";

// Kelime vurgusu alanlari (gecersizse words: null)
function karaOf(t) {
  const n = String(t.text ?? "").split(/\s+/).filter(Boolean).length;
  const ok = n > 0 && Array.isArray(t.words) && t.words.length === n
    && t.words.every((w) => Array.isArray(w) && w.length === 2 && w.every(Number.isFinite));
  return {
    words: ok ? t.words.map((w) => [round3(w[0]), round3(w[1])]) : null,
    kara: ok && t.kara !== false,
    dim: /^#[0-9a-f]{6}$/i.test(t.dim || "") ? t.dim.toLowerCase() : "#9a9a9a",
  };
}

export const DEFAULT_SETTINGS = {
  width: 1080, height: 1920, fps: 30, codec: "h264",
};
// Klip gecisi: her klip KENDISINDEN SONRAKI klibe gecis turunu/suresini tasir.
export const DEFAULT_TRANS = { type: "none", duration: 0.5 };
export const FORMATS = [
  { w: 1080, h: 1920, label: "9:16", hint: "Reels · TikTok" },
  { w: 1080, h: 1350, label: "4:5", hint: "Gönderi" },
  { w: 1080, h: 1080, label: "1:1", hint: "Kare" },
  { w: 1920, h: 1080, label: "16:9", hint: "YouTube" },
];

// Gecis turleri: [xfade adi, etiket]. Hepsi ayni (tek) sure ile uygulanir.
export const TRANSITIONS = [
  ["none", "Kesme"],
  ["fade", "Erime"],
  ["dissolve", "Çözülme"],
  ["fadeblack", "Siyaha"],
  ["fadewhite", "Beyaza"],
  ["fadegrays", "Griler"],
  ["wipeleft", "Sil ◀"],
  ["wiperight", "Sil ▶"],
  ["wipeup", "Sil ▲"],
  ["wipedown", "Sil ▼"],
  ["slideleft", "Kaydır ◀"],
  ["slideright", "Kaydır ▶"],
  ["slideup", "Kaydır ▲"],
  ["slidedown", "Kaydır ▼"],
  ["smoothleft", "Yumuşak ◀"],
  ["smoothright", "Yumuşak ▶"],
  ["smoothup", "Yumuşak ▲"],
  ["smoothdown", "Yumuşak ▼"],
  ["circleopen", "Daire aç"],
  ["circleclose", "Daire kapa"],
  ["circlecrop", "Daire kırp"],
  ["radial", "Işınsal"],
  ["rectcrop", "Dikdörtgen"],
  ["distance", "Uzaklık"],
  ["pixelize", "Piksel"],
  ["diagtl", "Çapraz ↖"],
  ["diagtr", "Çapraz ↗"],
  ["diagbl", "Çapraz ↙"],
  ["diagbr", "Çapraz ↘"],
  ["squeezeh", "Sıkıştır ↔"],
  ["squeezev", "Sıkıştır ↕"],
  ["zoomin", "Yakınlaş"],
  ["hblur", "Bulanıklaş"],
];
export const TRANSITION_TYPES = new Set(TRANSITIONS.map((t) => t[0]));
export const MIN_CLIP = 0.1;
const LAST_KEY = "engrare:lastProject";
const HISTORY_MAX = 60;

// ---- olaylar ----
// project: yapi degisti | time: imlec (detail = kaynak) | select | history | save | load | restore | playing
const bus = new EventTarget();
export function on(type, fn) { bus.addEventListener(type, (e) => fn(e.detail)); }
export function emit(type, detail) { bus.dispatchEvent(new CustomEvent(type, { detail })); }

export const S = {
  project: blank(),
  sel: null,         // { type: "clip" | "text" | "audio", id }
  time: 0,           // imlec (sn)
  pps: 60,           // zoom: saniye basina piksel
  playing: false,
  trimShift: null,   // { id, dt }: soldan kirparken gecici bosluk (birakinca kapanir)
  save: "saved",     // saved | pending | saving | error
};

export function blank() {
  return {
    id: null, name: "Yeni proje", version: 2,
    settings: { ...DEFAULT_SETTINGS },
    clips: [], texts: [], images: [], audio: null,
  };
}

// ---- v1 -> v2 donusumu (render.normalize_project ile ayni kurallar) ----
const IMAGE_RE = /\.(jpe?g|jpe|png|webp|bmp|gif|tiff?|heic|heif|avif|svg)$/i;
const COLOR_NAMES = { white: "#ffffff", black: "#000000", yellow: "#ffd400", red: "#ff3b30", blue: "#2f80ff", green: "#34c759" };
const num = (v, d = 0) => (v !== null && v !== "" && Number.isFinite(+v) ? +v : d);

export function relPath(src) {
  return String(src || "").replace(/^\/drive\/engrare-video\/engrare-video-upload\/?/, "").replace(/^\/drive\/?/, "");
}

export function migrate(p) {
  const out = blank();
  out.id = p.id || null;
  out.name = p.name || "Yeni proje";
  out.settings = { ...DEFAULT_SETTINGS, ...(p.settings || {}) };
  delete out.settings.transition; // gecis artik klip bazli
  // Eski (global) gecis ayari varsa tum kliplere uygulanir (geriye donuk uyum).
  const oldTr = (p.settings || {}).transition || {};
  const oldType = TRANSITION_TYPES.has(oldTr.type) ? oldTr.type : "none";
  const oldDur = clamp(num(oldTr.duration, 0.5), 0, 5);
  const { width: W, height: H } = out.settings;
  out.clips = (p.clips || []).map((c) => {
    const path = c.path || relPath(c.src);
    const kind = c.kind || (c.image || IMAGE_RE.test(path) ? "image" : "video");
    const ct = c.trans || {};
    const n = {
      id: c.id || uid(), path, src: c.src || "", name: c.name || path.split("/").pop(), kind,
      in: Math.max(0, num(c.in)), out: c.out == null ? null : num(c.out, null),
      srcDur: num(c.srcDur ?? c.duration), speed: clamp(num(c.speed, 1), 0.25, 4),
      volume: clamp(num(c.volume, 1), 0, 2), mute: Boolean(c.mute ?? kind === "image"),
      fadeIn: Math.max(0, num(c.fadeIn)), fadeOut: Math.max(0, num(c.fadeOut)),
      fit: c.fit === "cover" ? "cover" : "contain",
      trans: {
        type: TRANSITION_TYPES.has(ct.type) ? ct.type : oldType,
        duration: clamp(num(ct.duration, oldDur), 0, 5),
      },
    };
    if (kind === "image") {
      const d = (n.out ?? 3) - n.in; // v1'de bolunmus resim: sure = out - in
      Object.assign(n, { in: 0, out: d > 0 ? d : 3, srcDur: 0 });
    } else if (n.out != null && n.out <= n.in) {
      n.out = null;
    }
    if (kind === "video" && n.srcDur > n.in && (n.out == null || n.out > n.srcDur)) n.out = n.srcDur;
    return n;
  });
  out.texts = (p.texts || []).map((t) => {
    let { x = 0.5, y = 0.8, size = 0.05 } = t;
    if (typeof x === "string") x = { left: 0.25, right: 0.75 }[x] ?? 0.5;
    else if (x > 1) x /= W;
    if (typeof y === "string") y = { top: 0.12, center: 0.5 }[y] ?? 0.85;
    else if (y > 1) y /= H;
    size = num(size, 0.05);
    if (size > 1) size /= H; // v1: piksel
    let color = String(t.color || "#ffffff").toLowerCase();
    color = COLOR_NAMES[color] || color;
    if (!/^#[0-9a-f]{6}$/.test(color)) color = "#ffffff";
    const style = t.style || (t.box ? "box" : "shadow");
    const start = Math.max(0, num(t.start));
    return {
      id: t.id || uid(), text: String(t.text ?? ""), start, end: Math.max(start + 0.1, num(t.end, start + 3)),
      x: clamp(num(x, 0.5), 0, 1), y: clamp(num(y, 0.8), 0, 1), size: clamp(size, 0.01, 0.3), color,
      style: ["plain", "box", "outline", "shadow"].includes(style) ? style : "shadow",
      font: t.font || DEFAULT_FONT, cap: Boolean(t.cap), ...karaOf(t),
    };
  });
  out.images = (p.images || []).map((im) => {
    const start = Math.max(0, num(im.start));
    const path = im.path || relPath(im.src);
    const kind = im.kind === "video" ? "video" : "image";
    const layer = {
      id: im.id || uid(), kind, path, src: im.src || "",
      name: im.name || String(path || "").split("/").pop(),
      start, end: Math.max(start + 0.1, num(im.end, start + 3)),
      x: clamp(num(im.x, 0.5), 0, 1), y: clamp(num(im.y, 0.5), 0, 1),
      size: clamp(num(im.size, 0.3), 0.02, 1), opacity: clamp(num(im.opacity, 1), 0, 1),
    };
    if (kind === "video") {
      Object.assign(layer, {
        in: Math.max(0, num(im.in)), srcDur: num(im.srcDur), speed: clamp(num(im.speed, 1), 0.25, 4),
        volume: clamp(num(im.volume, 1), 0, 2), mute: Boolean(im.mute), ar: num(im.ar, 16 / 9) || 16 / 9,
      });
    }
    return layer;
  });
  const a = p.audio;
  out.audio = a && (a.path || a.src) ? {
    path: a.path || relPath(a.src), src: a.src || "", name: a.name || String(a.path || a.src).split("/").pop(),
    offset: Math.max(0, num(a.offset)), volume: clamp(num(a.volume, 0.3), 0, 2), loop: a.loop ?? true,
    fadeOut: Math.max(0, num(a.fadeOut, 1.5)), srcDur: num(a.srcDur),
  } : null;
  return out;
}

// ---- zaman hesaplari ----
export function clipDur(c) {
  if (c.kind === "image") return Math.max(MIN_CLIP, c.out - c.in);
  let out = c.out ?? (c.srcDur > c.in ? c.srcDur : c.in + 3);
  if (c.srcDur > c.in) out = Math.min(out, c.srcDur); // render da kaynak suresiyle sinirlar
  return Math.max(0.05, (out - c.in) / c.speed);
}

// Bir klibin SONRAKI klibe gecis suresi (tur "none" ise 0).
export function clipTransDur(c) {
  const tr = c?.trans;
  if (!tr || tr.type === "none") return 0;
  return Math.max(0, tr.duration || 0);
}

let cache = null;
// Kliplerin timeline'daki yerleri: [{c, i, start, dur, end, trans}]
// trans: bu klipten SONRAKI klibe gecis suresi (klipler bu kadar ust uste biner).
export function layout() {
  if (cache) return cache;
  const sh = S.trimShift;
  const clips = S.project.clips;
  const durs = clips.map(clipDur);
  const ds = [];
  for (let i = 0; i < clips.length - 1; i++) {
    const gd = clipTransDur(clips[i]); // bu klipten sonrakine gecis
    ds.push(gd > 0 ? Math.min(gd, durs[i] / 2, durs[i + 1] / 2) : 0);
  }
  // 1) sirali yerlesim (trimShift dahil)
  let t = 0;
  const seq = clips.map((c, i) => {
    const dur = durs[i];
    const start = sh && sh.id === c.id ? t + sh.dt : t;
    t = start + dur;
    return { c, i, start, dur };
  });
  // 2) gecis suresi kadar geri kaydir (klipler ust uste biner)
  let shift = 0;
  cache = seq.map((e, i) => {
    const start = e.start - shift;
    const end = start + e.dur;
    shift += ds[i] || 0;
    return { c: e.c, i, start, dur: e.dur, end, trans: ds[i] || 0 };
  });
  return cache;
}
export function invalidate() { cache = null; }
export function total() {
  const L = layout();
  return L.length ? L[L.length - 1].end : 0;
}
export function entryAt(t) {
  const L = layout();
  for (const e of L) if (t < e.end) return e;
  return L[L.length - 1] || null;
}
export const entryOf = (id) => layout().find((e) => e.c.id === id) || null;
export const srcTimeAt = (e, t) => (e.c.kind === "image" ? 0 : e.c.in + (t - e.start) * e.c.speed);
export const frame = () => 1 / (S.project.settings.fps || 30);

// t aninda aktif klipler (gecis bolgesinde iki klip birden).
export function entriesAt(t) {
  return layout().filter((e) => t >= e.start && t < e.end);
}
// t bir gecis bolgesindeyse {a, b, p} (a: cikan, b: giren, p: 0-1 ilerleme).
export function transitionAt(t) {
  const L = layout();
  for (let i = 0; i < L.length - 1; i++) {
    const a = L[i];
    const b = L[i + 1];
    if (a.trans > 0 && t >= b.start && t < a.end) {
      return { a, b, p: clamp((t - b.start) / a.trans, 0, 1) };
    }
  }
  return null;
}

export function setTime(t, src = "") {
  const v = clamp(t, 0, total());
  if (v === S.time) return;
  S.time = v;
  emit("time", src);
}

// ---- secim ----
export function select(type = null, id = null) {
  const next = type ? { type, id } : null;
  if ((next && S.sel && next.type === S.sel.type && next.id === S.sel.id) || (!next && !S.sel)) return;
  S.sel = next;
  emit("select");
}
export function selected() {
  const s = S.sel;
  if (!s) return null;
  if (s.type === "clip") return S.project.clips.find((c) => c.id === s.id) || null;
  if (s.type === "text") return S.project.texts.find((t) => t.id === s.id) || null;
  if (s.type === "image") return S.project.images.find((t) => t.id === s.id) || null;
  return S.project.audio;
}
export const isSel = (type, id) => S.sel?.type === type && (type === "audio" || S.sel.id === id);

// ---- degisiklik + gecmis ----
const past = [];
const future = [];
let base = "";
const snapshot = () => JSON.stringify({
  name: S.project.name, settings: S.project.settings, clips: S.project.clips,
  texts: S.project.texts, images: S.project.images, audio: S.project.audio,
});

// commit=false: canli onizleme (slider surukleme vb.); birakinca changed() ile kaydedilir
export function changed(commit = true) {
  invalidate();
  if (S.time > total()) S.time = total();
  emit("project");
  if (commit) {
    const s = snapshot();
    if (s !== base) {
      past.push(base);
      if (past.length > HISTORY_MAX) past.shift();
      future.length = 0;
      base = s;
      emit("history");
      scheduleSave();
    }
  }
}

function restore(s) {
  Object.assign(S.project, JSON.parse(s));
  invalidate();
  if (S.sel && !selected()) S.sel = null;
  if (S.time > total()) S.time = total();
  emit("restore");
  emit("project");
  emit("select");
  emit("history");
  emit("time", "restore");
  scheduleSave();
}
export function undo() {
  const cur = snapshot();
  if (cur !== base) { past.push(base); base = cur; } // kaydedilmemis canli degisiklik
  if (!past.length) return false;
  future.push(base);
  base = past.pop();
  restore(base);
  return true;
}
export function redo() {
  if (!future.length) return false;
  past.push(base);
  base = future.pop();
  restore(base);
  return true;
}
export const canUndo = () => past.length > 0;
export const canRedo = () => future.length > 0;
function resetHistory() {
  past.length = 0;
  future.length = 0;
  base = snapshot();
  emit("history");
}

// ---- kesme islemleri ----
// Hedef: secili klip (imlec icindeyse) ya da secim yoksa imlecin altindaki klip.
function inside(e, t) {
  const eps = frame() / 2;
  return Boolean(e) && t - e.start >= eps && e.end - t >= eps;
}
export function cutTarget() {
  const s = S.sel;
  if (s && s.type !== "clip") return inside(entryAt(S.time), S.time) ? entryAt(S.time) : null;
  const e = s ? entryOf(s.id) : entryAt(S.time);
  return inside(e, S.time) ? e : null;
}

export function split() {
  const e = cutTarget();
  if (!e) return false;
  const c = e.c;
  const local = S.time - e.start;
  const right = { ...c, id: uid(), fadeIn: 0 };
  if (c.kind === "image") {
    c.out = round3(local);
    right.out = round3(e.dur - local);
  } else {
    const cut = round3(c.in + local * c.speed);
    right.in = cut;
    right.out = c.out ?? c.srcDur;
    c.out = cut;
  }
  c.fadeOut = 0;
  // sag parca sonraki klibe gecisi korur; sol parca kendi devamina kesme ile baglanir
  right.trans = { ...(c.trans || DEFAULT_TRANS) };
  c.trans = { ...DEFAULT_TRANS };
  S.project.clips.splice(e.i + 1, 0, right);
  S.sel = { type: "clip", id: right.id };
  changed();
  S.time = entryOf(right.id).start;
  emit("select");
  emit("time", "edit");
  return true;
}

// "Basini sil": imlecin solundaki kismi atar; klip imlecin eski yerinden baslar
export function trimStart() {
  const e = cutTarget();
  if (!e) return false;
  const c = e.c;
  const local = S.time - e.start;
  if (c.kind === "image") c.out = round3(e.dur - local);
  else c.in = round3(c.in + local * c.speed);
  changed();
  S.time = e.start;
  emit("time", "edit");
  return true;
}

// "Sonunu sil": imlecin sagindaki kismi atar
export function trimEnd() {
  const e = cutTarget();
  if (!e) return false;
  const c = e.c;
  const local = S.time - e.start;
  if (c.kind === "image") c.out = round3(local);
  else c.out = round3(c.in + local * c.speed);
  changed();
  return true;
}

export function removeSelected() {
  const s = S.sel;
  if (!s || !selected()) return false;
  const P = S.project;
  if (s.type === "clip") P.clips = P.clips.filter((c) => c.id !== s.id);
  else if (s.type === "text") P.texts = P.texts.filter((t) => t.id !== s.id);
  else if (s.type === "image") P.images = P.images.filter((t) => t.id !== s.id);
  else P.audio = null;
  S.sel = null;
  changed();
  emit("select");
  return true;
}

export function duplicateSelected() {
  const s = S.sel;
  const P = S.project;
  if (s?.type === "clip") {
    const i = P.clips.findIndex((c) => c.id === s.id);
    if (i < 0) return false;
    const cp = { ...P.clips[i], id: uid(), trans: { ...(P.clips[i].trans || DEFAULT_TRANS) } };
    P.clips.splice(i + 1, 0, cp);
    S.sel = { type: "clip", id: cp.id };
  } else if (s?.type === "text") {
    const t = P.texts.find((x) => x.id === s.id);
    if (!t) return false;
    const cp = { ...t, id: uid(), start: t.end, end: round3(t.end + (t.end - t.start)) };
    P.texts.push(cp);
    S.sel = { type: "text", id: cp.id };
  } else if (s?.type === "image") {
    const t = P.images.find((x) => x.id === s.id);
    if (!t) return false;
    const cp = { ...t, id: uid(), start: t.end, end: round3(t.end + (t.end - t.start)) };
    P.images.push(cp);
    S.sel = { type: "image", id: cp.id };
  } else {
    return false;
  }
  changed();
  emit("select");
  return true;
}

export function moveClip(from, to) {
  const cl = S.project.clips;
  if (from === to || from < 0 || to < 0 || from >= cl.length || to >= cl.length) return;
  const [c] = cl.splice(from, 1);
  cl.splice(to, 0, c);
  changed();
}

// Yeni klip imlecin en yakin klip sinirina eklenir; imlec yeni klibin sonuna gecer
// (art arda eklenenler sirayla dizilir).
export function insertClip(c) {
  if (!c.trans) c.trans = { ...DEFAULT_TRANS };
  const L = layout();
  let i = L.length;
  const e = entryAt(S.time);
  if (e && S.time < e.end) i = S.time - e.start < e.dur / 2 ? e.i : e.i + 1;
  S.project.clips.splice(i, 0, c);
  changed();
  S.time = entryOf(c.id).end;
  emit("time", "edit");
}

const FONT_KEY = "engrare:textFont";
export const lastTextFont = () => localStorage.getItem(FONT_KEY) || DEFAULT_FONT;
export const rememberTextFont = (id) => localStorage.setItem(FONT_KEY, id);

export function addText() {
  const T = total();
  let start = round3(S.time);
  if (T > 0 && start >= T - 0.1) start = Math.max(0, round3(T - 3));
  const t = {
    id: uid(), text: "Metin", start, end: round3(start + 3),
    x: 0.5, y: 0.75, size: 0.055, color: "#ffffff", style: "box", font: lastTextFont(), cap: false,
  };
  S.project.texts.push(t);
  S.sel = { type: "text", id: t.id };
  changed();
  emit("select");
  return t;
}

// Katman ekler: resim (logo/sticker) ya da video (ana serinin ustune binen). info: video icin probe sonucu.
export function addImage(f, info = null) {
  const T = total();
  let start = round3(S.time);
  if (T > 0 && start >= T - 0.1) start = Math.max(0, round3(T - 3));
  const im = {
    id: uid(), kind: "image", path: f.path, src: f.abs || "", name: f.name,
    start, end: round3(start + 3), x: 0.5, y: 0.5, size: 0.3, opacity: 1,
  };
  if (f.type === "video" && info?.duration) {
    // ana seridin kalan suresine kadar (cok kisaysa kaynagin tamami)
    const left = T - start >= 0.5 ? T - start : info.duration;
    Object.assign(im, {
      kind: "video", end: round3(start + Math.min(info.duration, left)), size: 0.5,
      in: 0, srcDur: info.duration, speed: 1, volume: 1, mute: false,
      ar: info.width && info.height ? info.width / info.height : 16 / 9,
    });
  }
  S.project.images.push(im);
  S.sel = { type: "image", id: im.id };
  changed();
  emit("select");
  return im;
}

// Katmanin medyasini degistirir (resim <-> video olabilir); konum, boyut ve sure korunur.
export function replaceLayerMedia(im, f, info = null) {
  Object.assign(im, { path: f.path, src: f.abs || "", name: f.name });
  if (f.type === "video" && info?.duration) {
    Object.assign(im, {
      kind: "video", in: 0, srcDur: info.duration, speed: 1, volume: im.volume ?? 1, mute: im.mute ?? false,
      ar: info.width && info.height ? info.width / info.height : 16 / 9,
    });
    im.end = round3(Math.min(im.end, im.start + info.duration));
  } else {
    im.kind = "image";
    for (const k of ["in", "srcDur", "speed", "volume", "mute", "ar"]) delete im[k];
  }
  changed();
}

// Video katmaninin kaynakla sinirli en gec bitisi
export const layerMaxEnd = (im) => (im.kind === "video" && im.srcDur > 0
  ? im.start + (im.srcDur - im.in) / im.speed : Infinity);

// Video katmaninin hizini degistirir; kaynaktan okunan aralik ayni kalir, sure buna gore uzar/kisalir.
export function setLayerSpeed(im, speed) {
  const srcLen = (im.end - im.start) * im.speed;
  im.speed = round3(speed);
  im.end = round3(Math.min(im.start + srcLen / im.speed, layerMaxEnd(im)));
}

// Katmani one (+1) ya da arkaya (-1) alir; dizideki sira ust uste binme sirasidir.
export function moveLayer(id, dir) {
  const arr = S.project.images;
  const i = arr.findIndex((x) => x.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= arr.length) return false;
  [arr[i], arr[j]] = [arr[j], arr[i]];
  changed();
  return true;
}

// Otomatik altyazilari yerlestirir: onceki altyazilar (cap) silinir, yenileri tek geri-al adiminda eklenir.
// style: { font, color, size, y, style }; caps: [{start, end, text}] (timeline saniyesi)
export function applyCaptions(caps, style) {
  const P = S.project;
  P.texts = P.texts.filter((t) => !t.cap);
  for (const c of caps) {
    P.texts.push({
      id: uid(), text: c.text, start: round3(c.start), end: round3(Math.max(c.end, c.start + 0.2)),
      x: 0.5, y: style.y, size: style.size, color: style.color, style: style.style, font: style.font, cap: true,
      ...karaOf({ text: c.text, words: style.kara ? c.words : null }),
    });
  }
  if (S.sel?.type === "text" && !selected()) S.sel = null;
  changed();
  emit("select");
}

// Tum otomatik altyazilara ortak bicim uygular. patch: { font, color, size, style, x, y } alt kumesi.
// commit=false: canli onizleme (slider surukleme); gecmise yazmaz.
export function styleCaptions(patch, commit = true) {
  const caps = S.project.texts.filter((t) => t.cap);
  for (const t of caps) Object.assign(t, patch);
  if (caps.length) changed(commit);
  return caps.length;
}

export function removeCaptions() {
  const P = S.project;
  const n = P.texts.filter((t) => t.cap).length;
  if (!n) return 0;
  P.texts = P.texts.filter((t) => !t.cap);
  if (S.sel?.type === "text" && !selected()) S.sel = null;
  changed();
  emit("select");
  return n;
}

export function setAudio(f, srcDur = 0) {
  const old = S.project.audio;
  S.project.audio = {
    path: f.path, src: f.abs || "", name: f.name, offset: 0,
    volume: old?.volume ?? 0.4, loop: old?.loop ?? true, fadeOut: old?.fadeOut ?? 1.5, srcDur,
  };
  S.sel = { type: "audio", id: null };
  changed();
  emit("select");
}

export function setFormat(w, h) {
  Object.assign(S.project.settings, { width: w, height: h });
  changed();
}

// Secili klibin (veya verilen klibin) SONRAKI klibe gecisini ayarlar.
export function setTransition(type, duration, clipId = null) {
  const id = clipId || (S.sel?.type === "clip" ? S.sel.id : null);
  const c = S.project.clips.find((x) => x.id === id);
  if (!c) return;
  if (!c.trans) c.trans = { ...DEFAULT_TRANS };
  if (type != null) c.trans.type = type;
  if (duration != null) c.trans.duration = duration;
  changed();
}

// ---- kayit ----
let saveTimer = 0;
let saving = false;
let dirty = false;

function setSave(v) {
  S.save = v;
  emit("save");
}
export function scheduleSave(delay = 800) {
  dirty = true;
  setSave("pending");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, delay);
}
function body() {
  const P = S.project;
  return { name: P.name, version: 2, settings: P.settings, clips: P.clips, texts: P.texts, images: P.images, audio: P.audio };
}
let keepEmpty = false; // adi/formati secilmis bos proje de kaydedilir
const isEmpty = (P) => !keepEmpty && !P.id && !P.clips.length && !P.texts.length && !P.images.length && !P.audio;

export async function saveNow() {
  clearTimeout(saveTimer);
  if (saving) return; // calisan kayit bitince dirty ise tekrar kaydeder
  saving = true;
  try {
    while (dirty) {
      dirty = false;
      const P = S.project;
      if (isEmpty(P)) break; // bos projeyi sunucuya yazma
      setSave("saving");
      const d = await api(P.id ? `/api/projects/${P.id}` : "/api/projects", {
        method: P.id ? "PUT" : "POST", body: body(),
      });
      if (!P.id) {
        P.id = d.id;
        localStorage.setItem(LAST_KEY, d.id);
      }
      keepEmpty = false;
    }
    setSave("saved");
  } catch (e) {
    dirty = true;
    setSave("error");
    saveTimer = setTimeout(saveNow, 5000);
  } finally {
    saving = false;
  }
}

// Bekleyen kaydi bitir (proje degistirmeden / render'dan once)
export async function flush() {
  while (saving) await sleep(40);
  if (dirty) await saveNow();
  while (saving) await sleep(40);
}

// Sayfa kapanirken: keepalive ile son hali gonder
export function flushOnExit() {
  if (!dirty || !S.project.id) return;
  try {
    fetch(`${API}/api/projects/${S.project.id}`, {
      method: "PUT", credentials: "include", keepalive: true,
      headers: { "content-type": "application/json" }, body: JSON.stringify(body()),
    });
  } catch (e) { /* sayfa kapaniyor */ }
}

function load(p) {
  S.project = p;
  S.sel = null;
  S.time = 0;
  S.trimShift = null;
  invalidate();
  resetHistory();
  dirty = false;
  setSave("saved");
  emit("load");
  emit("project");
  emit("select");
  emit("time", "load");
}

export async function openProject(id) {
  await flush();
  const p = await api(`/api/projects/${id}`);
  load(migrate(p));
  localStorage.setItem(LAST_KEY, id);
}

// Ad/format verilirse proje hemen sunucuya yazilir (bos olsa da listede gorunsun, ad ve format kaybolmasin).
export async function newProject(opts = null) {
  await flush();
  const p = blank();
  if (opts) {
    if (opts.name) p.name = opts.name;
    if (opts.width && opts.height) Object.assign(p.settings, { width: opts.width, height: opts.height });
  }
  load(p);
  localStorage.removeItem(LAST_KEY);
  if (opts) {
    keepEmpty = true;
    scheduleSave(0);
  }
}

// Acik proje sunucuda silindiyse bekleyen kaydi birak (yeniden olusturulmasin)
export function discardPending() {
  clearTimeout(saveTimer);
  dirty = false;
}

export const lastProjectId = () => localStorage.getItem(LAST_KEY);
export const forgetLastProject = () => localStorage.removeItem(LAST_KEY);
