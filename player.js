// Onizleme oynaticisi.
// Iki video ogesi donusumlu calisir: sonraki klip arkadaki ogede onceden yuklenip
// ilk karesine sarilir, gecis aninda one alinir (siyah ekran/bekleme yok). Ayni dosyadan
// bolunmus ardisik klipler tek ogede kesintisiz oynar. Metinler render ile ayni oranlarla
// (cikti yuksekligine gore) cizilir ve onizlemede surukleyerek tasinabilir.
import { $, clamp, el } from "./api.js";
import {
  S, changed, emit, entryAt, layout, on, select, setTime, srcTimeAt, total, transitionAt,
} from "./state.js";
import * as M from "./media.js";
import { ensureFont, events as fontEvents, fontReady } from "./fonts.js";
import { karaDone, karaWords, paintText } from "./textbox.js";
import { clear as clearStyle, look as transLook, paint } from "./transitions.js";
import * as dbg from "./pvdebug.js";

const stage = $("#stage");
const box = $("#preview");
const media = $("#pvMedia");
const vids = [$("#va"), $("#vb")];
const img = $("#pimg");
const music = $("#music");
const layer = $("#textLayer");
const imgLayer = $("#imgLayer");
const guides = $("#guides");
const msg = $("#pvMsg");

let shown = null; // gorunen oge (video/resim)
let cur = null; // oynatmada aktif klip girdisi
let curVid = null; // oynatmada aktif video
let raf = 0;
let clock0 = 0; // resim klipleri: duvar saati referansi
let time0 = 0;
let showRaf = 0;
let peeking = false;
let held = false; // video veri beklerken her sey (muzik, katmanlar, gecis ogesi) durur; zaman atlamaz
// Saat videodan okunur. Klip degisince yeni videonun konumu cogu zaman biraz geride kalir (play gecikmesi);
// zaman cizgisi geri sicramasin diye devirde fark "skew" olarak saklanir ve sureklilik korunur.
let skew = 0;
let pendingT = null; // devirden sonra yeni videonun ilk hazir olusunda skew bu zamana gore hesaplanir
const STALL_MS = 250; // currentTime bu kadar suredir ilerlemediyse takilma sayilir

// ---- ogeler ----
// Tek ogeyi gosterir; digerlerini ve gecis stillerini temizler.
function showOnly(node) {
  for (const n of [...vids, img]) {
    n.classList.toggle("on", n === node);
    clearStyle(n);
  }
  media.style.background = "";
  shown = node;
  transEls = null;
}

function reveal(node) {
  node._reveal = false;
  msg.hidden = true;
  showOnly(node);
}

function hideAll() {
  for (const n of [...vids, img]) {
    n.classList.remove("on");
    clearStyle(n);
  }
  media.style.background = "";
  shown = null;
  transEls = null;
}

for (const v of vids) {
  v.muted = true;
  v.addEventListener("seeked", () => {
    if (v._next != null) {
      const t = v._next;
      v._next = null;
      v.currentTime = t;
      return;
    }
    if (v._reveal) reveal(v);
  });
  v.addEventListener("loadeddata", () => {
    if (v._reveal && !v.seeking && Math.abs(v.currentTime - (v._want ?? 0)) < 0.05) reveal(v);
  });
  v.addEventListener("error", () => {
    if (M.proxyBroken(v._src)) { // proxy bozuksa orijinal dosyayla tekrar dene
      v._src = null;
      if (!S.playing) scheduleShow();
      return;
    }
    if (v._reveal || v === shown) {
      msg.textContent = "Video açılamadı";
      msg.hidden = false;
    }
  });
}
dbg.init(vids);
img.addEventListener("error", () => {
  if (img._want) {
    msg.textContent = "Resim açılamadı";
    msg.hidden = false;
  }
});

function loadInto(v, src) {
  if (v._src === src) return;
  v._src = src;
  v._next = null;
  v.src = src;
}

// Oynayan video STALL_MS'tir ilerlemediyse takilmistir (readyState tek basina guvenilir degil)
function stuck(v, now) {
  if (v.paused || v.ended || v.error || !v.src) {
    v._ctAt = now;
    return false;
  }
  if (v.currentTime !== v._ct) {
    v._ct = v.currentTime;
    v._ctAt = now;
  }
  return now - (v._ctAt ?? now) > STALL_MS;
}

function markMoving(v) {
  v._playAt = performance.now();
  v._ct = v.currentTime;
  v._ctAt = performance.now();
}

// Ust uste seek istekleri birikmesin: seek surerken son hedef saklanir
function seekVid(v, t) {
  v._want = t;
  if (v.seeking) {
    v._next = t;
    return;
  }
  if (v.readyState >= 1 && Math.abs(v.currentTime - t) < 0.0005) return;
  v.currentTime = t;
}

// Bu adresi yuklemis oge; yoksa gorunmeyen ogeye yukle
function pickVid(src, avoid = null) {
  let v = vids.find((x) => x._src === src && x !== avoid);
  if (!v) {
    v = vids.find((x) => x !== shown && x !== avoid) || vids.find((x) => x !== avoid) || vids[0];
    loadInto(v, src);
  }
  return v;
}

// Klibi kaynak zamani st'de gosterir; yeni oge karesi hazir olunca one alinir
function showEntry(e, st) {
  const c = e.c;
  if (c.kind === "image") {
    const src = M.imageUrl(c.path);
    vids.forEach((v) => { v._reveal = false; });
    img.style.objectFit = c.fit;
    img._want = true;
    if (img._src !== src) {
      img._src = src;
      img.onload = () => { if (img._src === src && img._want) reveal(img); };
      img.src = src;
    } else if (img.complete && img.naturalWidth) {
      reveal(img);
    }
    return img;
  }
  img._want = false;
  const v = pickVid(M.videoUrl(c.path));
  v.style.objectFit = c.fit;
  seekVid(v, st);
  vids.forEach((x) => { x._reveal = x === v && x !== shown; });
  if (v !== shown && v.readyState >= 2 && !v.seeking) reveal(v);
  return v;
}

function fadeAt(e, t) {
  const c = e.c;
  let f = 1;
  const fi = Math.min(c.fadeIn, e.dur / 2);
  const fo = Math.min(c.fadeOut, e.dur / 2);
  if (fi > 0) f = Math.min(f, (t - e.start) / fi);
  if (fo > 0) f = Math.min(f, (e.end - t) / fo);
  return clamp(f, 0, 1);
}

// Gecis (fade) ve klip sesi. Fade yalnizca oynatirken: duraklatinca kare hep gorunsun.
function look(e, t) {
  const f = S.playing ? fadeAt(e, t) : 1;
  media.style.opacity = f;
  if (curVid && e.c.kind === "video") {
    if (curVid.playbackRate !== e.c.speed) curVid.playbackRate = e.c.speed;
    curVid.muted = e.c.mute || e.c.volume <= 0;
    curVid.volume = clamp(e.c.volume, 0, 1) * f * (transEls ? outGain : 1);
  }
}

// ---- gecis onizlemesi (iki klip ust uste) ----
let transEls = null; // gecis sirasinda gorunen ogeler [cikan, giren]
let outGain = 1; // gecis sirasinda cikan klibin ses payi (render: acrossfade)

function clearTrans() {
  if (!transEls) return;
  const [ea, eb] = transEls;
  clearStyle(ea);
  clearStyle(eb);
  if (ea !== eb && ea !== shown) ea.classList.remove("on"); // cikan klip gorunmez (yoksa yeni klibin ustunde kalabilir)
  media.style.background = "";
  transEls = null;
}

// Gecis icin ogeyi hazirlar (oynatirken seek etmez).
function elFor(e, st, avoid = null, seek = true) {
  const c = e.c;
  if (c.kind === "image") {
    const src = M.imageUrl(c.path);
    img.style.objectFit = c.fit;
    if (img._src !== src) {
      img._src = src;
      img.src = src;
    }
    return img;
  }
  const v = pickVid(M.videoUrl(c.path), avoid);
  v.style.objectFit = c.fit;
  if (seek) seekVid(v, st);
  return v;
}

function showTransition(tr, t, playing = false) {
  const { a, b, p } = tr;
  const ea = elFor(a, srcTimeAt(a, t), null, !playing);
  const eb = elFor(b, srcTimeAt(b, t), ea, !playing);
  if (ea === eb) { // ayni oge (bolunmus klip): gecis gosterilemez
    clearTrans();
    return false;
  }
  for (const n of [...vids, img]) {
    n.classList.toggle("on", n === ea || n === eb);
    if (n !== ea && n !== eb) clearStyle(n);
  }
  const L = transLook(a.c.trans?.type || "none", p);
  const aTop = Boolean(L.a?.top);
  if (dbg.on && !transEls) {
    dbg.log(`GECIS basladi: giren rs=${eb.readyState} ${eb.paused ? "DURAKLI" : "oynuyor"} konum=${eb.currentTime.toFixed(2)} istenen=${srcTimeAt(b, t).toFixed(2)} sure=${a.trans.toFixed(2)}`);
  }
  paint(ea, L.a, aTop);
  paint(eb, L.b, !aTop);
  media.style.background = L.bg || "";
  media.style.opacity = 1;
  shown = eb;
  transEls = [ea, eb];
  if (playing) {
    outGain = 1 - p;
    if (!held) {
      for (const n of [ea, eb]) {
        if (n.tagName === "VIDEO" && n.paused) {
          const sp = (n === ea ? a : b).c.speed;
          if (n.playbackRate !== sp) n.playbackRate = sp; // onizleme ogesi onceki klibin hiziyla kalmasin
          markMoving(n);
          n.play().catch(() => {});
        }
      }
    }
    if (eb.tagName === "VIDEO") { // giren klibin sesi gecisle birlikte acilir
      eb.muted = b.c.mute || b.c.volume <= 0;
      eb.volume = clamp(b.c.volume, 0, 1) * p;
      const want = srcTimeAt(b, t);
      if (!held && !eb.seeking) {
        const lag = want - eb.currentTime; // >0: giren klip geride
        if (Math.abs(lag) > 0.35) {
          seekVid(eb, want);
        } else if (eb.readyState >= 2 && !(performance.now() - (eb._rateAt || 0) < 200)) {
          // seek yerine gecis suresince hizi ayarlayip yakala (takilma yok). lag kaynak saniyesi,
          // hiz kaynak sn / zaman cizgisi sn: sp + lag/kalan. Sik hiz degisimi sesi bozar: 200 ms'de bir, olu bantli.
          eb._rateAt = performance.now();
          const sp = b.c.speed;
          const r = Math.abs(lag) < 0.03 * sp ? sp : Math.min(16, clamp(sp + lag / Math.max(0.25, a.end - t), sp * 0.25, sp * 5));
          if (Math.abs(eb.playbackRate - r) > 0.01) {
            eb.playbackRate = r;
            dbg.log(`giren hiz ${r.toFixed(2)} (lag ${lag.toFixed(3)})`);
          }
        }
      }
    }
  }
  return true;
}

function showAt(t) {
  const tr = transitionAt(t);
  if (tr && showTransition(tr, t)) {
    renderTexts(t);
    renderImages(t);
    return;
  }
  clearTrans();
  const e = entryAt(t);
  if (!e) {
    hideAll();
    media.style.opacity = 1;
  } else {
    const el0 = showEntry(e, srcTimeAt(e, t));
    const ready = el0 === img
      ? Boolean(el0.complete && el0.naturalWidth)
      : el0.readyState >= 2 && !el0.seeking;
    if (ready) showOnly(el0);
    else clearStyle(el0);
    look(e, t);
  }
  renderTexts(t);
  renderImages(t);
}

function scheduleShow() {
  if (showRaf) return;
  showRaf = requestAnimationFrame(() => {
    showRaf = 0;
    if (!S.playing && !peeking) showAt(S.time);
  });
}

// ---- oynatma ----
const unlocked = new WeakSet();
// iOS: sesli oynatma her oge icin bir kez dokunmayla baslatilmali. Ilk Oynat dokunusunda
// arkadaki ogeyi de kisa bir play/pause ile acariz; sonraki gecisler dokunmasiz calisir.
function unlockAll() {
  const layerVids = [...imgEls.values()].filter((n) => n.tagName === "VIDEO");
  for (const v of [...vids, ...layerVids]) {
    if (unlocked.has(v) || v === curVid || !v.src) continue;
    unlocked.add(v);
    const m = v.muted;
    v.muted = false;
    v.play().catch(() => {});
    v.pause();
    v.muted = m;
  }
}

function startVideo(v, e) {
  if (v.playbackRate !== e.c.speed) v.playbackRate = e.c.speed;
  v.muted = e.c.mute || e.c.volume <= 0;
  v.volume = clamp(e.c.volume, 0, 1);
  unlocked.add(v);
  markMoving(v);
  v.play().catch((err) => {
    // Tarayici sesli oynatmaya izin vermediyse sessiz devam et
    if (err?.name === "NotAllowedError" && S.playing && curVid === v) {
      v.muted = true;
      v.play().catch(() => {});
    }
  });
}

const contiguous = (a, b) => a.c.kind === "video" && b.c.kind === "video" && a.c.path === b.c.path
  && a.c.speed === b.c.speed && Math.abs((a.c.out ?? a.c.srcDur) - b.c.in) < 0.05;

function preloadNext(e) {
  const next = layout()[e.i + 1];
  if (!next) return;
  if (next.c.kind === "image") {
    M.preloadImage(next.c.path);
    return;
  }
  if (curVid && contiguous(e, next)) return; // ayni ogede kaldigi yerden devam edecek
  const v = pickVid(M.videoUrl(next.c.path), curVid);
  v.muted = true;
  if (!v.paused) v.pause();
  v.style.objectFit = next.c.fit;
  seekVid(v, next.c.in);
}

function startAt(t) {
  const e = entryAt(t);
  if (!e) return;
  held = false;
  skew = 0;
  pendingT = null;
  cur = e;
  if (e.c.kind === "image") {
    curVid = null;
    for (const v of vids) v.pause();
    showEntry(e, 0);
    clock0 = performance.now();
    time0 = t;
  } else {
    const v = showEntry(e, srcTimeAt(e, t));
    curVid = v;
    for (const x of vids) if (x !== v) x.pause();
    startVideo(v, e);
  }
  look(e, t);
  preloadNext(e);
}

function advance(e, next, now, t) {
  const prev = curVid;
  const wasTrans = transEls !== null;
  dbg.log(`${wasTrans ? "gecis sonu" : "KESME"} -> klip ${next.i + 1}`);
  cur = next;
  pendingT = next.c.kind === "image" ? null : t;
  skew = 0;
  const st = srcTimeAt(next, e.end); // gecis varsa giren klip zaten ilerlemis olur
  if (next.c.kind === "image") {
    if (prev) {
      prev.pause();
      prev.muted = true;
    }
    curVid = null;
    showEntry(next, 0);
    clock0 = now;
    time0 = next.start;
  } else if (prev && contiguous(e, next)) {
    prev.style.objectFit = next.c.fit; // ayni oge oynamaya devam eder
  } else {
    const v = pickVid(M.videoUrl(next.c.path), prev);
    if (prev) {
      prev.pause();
      prev.muted = true;
    }
    curVid = v;
    v.style.objectFit = next.c.fit;
    // gecisle zaten oynayan (veya ilk karesine hazirlanmis) oge yakinsa geri sarma: kare atlamasi/takilma yapar
    const near = v.readyState >= 2 && !v.seeking && Math.abs(v.currentTime - st) < (v.paused ? 0.04 : 0.35);
    if (!near) seekVid(v, st);
    vids.forEach((x) => { x._reveal = x === v && x !== shown; });
    if (v !== shown && v.readyState >= 2 && !v.seeking) reveal(v);
    startVideo(v, next);
  }
  if (wasTrans) { // gecis bitti: cikan ogeyi gizle, stilleri temizle
    const keep = curVid || img;
    for (const x of [...vids, img]) {
      if (x !== keep) x.classList.remove("on");
      clearStyle(x);
    }
    media.style.background = "";
    shown = keep;
    transEls = null;
  }
  preloadNext(next);
}

let heldAt = 0;
// Takilmada saat, muzik ve diger tum medya durur; veri gelince kaldigi yerden birlikte devam eder
function holdMedia(on, stuckEls) { // stuckEls: Set | []
  if (on === held) return;
  held = on;
  if (dbg.on) {
    if (on) heldAt = performance.now();
    dbg.log(on ? "TAKILMA: her sey durdu" : `devam (${Math.round(performance.now() - heldAt)}ms bekledi)`);
  }
  if (on) {
    music.pause();
    for (const v of vids) if (!stuckEls.has?.(v) && !v.paused) v.pause();
    for (const d of imgEls.values()) if (d.tagName === "VIDEO" && !d.paused) d.pause();
    return;
  }
  const now = performance.now();
  for (const v of vids) {
    v._ctAt = now;
    if (v.paused && (v === curVid || (transEls && transEls.includes(v)))) v.play().catch(() => {});
  }
  startMusic(S.time);
}

function tick(now) {
  if (!S.playing) return;
  const e = cur;
  if (dbg.on) {
    dbg.ctx.phase = held ? "BEKLE" : transEls ? "GECIS" : "oyn";
    dbg.ctx.t = S.time;
    dbg.raf(now);
  }
  if (curVid) {
    const bad = new Set([curVid, ...(transEls || [])]);
    for (const v of bad) if (v.tagName !== "VIDEO" || !stuck(v, now)) bad.delete(v);
    holdMedia(bad.size > 0, bad);
  } else {
    holdMedia(false, []);
  }
  let t;
  if (!curVid) {
    t = time0 + (now - clock0) / 1000;
  } else if (held) {
    t = S.time; // veri bekleniyor: zaman ilerlemez
  } else if (curVid.ended) {
    t = e.end;
  } else if (curVid.readyState >= 2 && !curVid.seeking) {
    t = e.start + (curVid.currentTime - e.c.in) / e.c.speed;
    if (pendingT != null) {
      const d = pendingT - t;
      skew = Math.abs(d) <= 0.5 ? d : 0;
      pendingT = null;
      dbg.log(`saat devri: skew ${skew.toFixed(3)}`);
    }
    t += skew;
    if (curVid.paused) curVid.play().catch(() => {});
  } else {
    t = S.time; // tamponlaniyor
  }
  const tr = transitionAt(t);
  if (tr && showTransition(tr, t, true)) {
    // gecis: iki klip birlikte gosterilir, saat cikan klipten surer
    look(cur, S.time);
    media.style.opacity = 1;
  } else {
    clearTrans();
    look(cur, S.time);
  }
  const lim = e.trans > 0 ? e.end : e.end - 0.01;
  if (t >= lim) {
    const next = layout()[e.i + 1];
    if (!next) {
      setTime(total(), "player");
      pause();
      return;
    }
    advance(e, next, now, t);
    t = Math.max(t, next.start); // gecisli klipte next.start < t: zaman geri sarmasin
  }
  if (S.time - t > 0 && S.time - t < 0.25) t = S.time; // video saatindeki kucuk gerilemeler zaman cizgisini geri oynatmasin
  setTime(clamp(t, cur.start, cur.end), "player");
  syncMusic(S.time);
  renderTexts(S.time);
  renderImages(S.time);
  raf = requestAnimationFrame(tick);
}

export function play() {
  if (S.playing || !S.project.clips.length) return;
  if (S.time >= total() - 0.02) setTime(0, "player");
  peeking = false;
  S.playing = true;
  held = false;
  dbg.resetRaf();
  startAt(S.time);
  unlockAll();
  startMusic(S.time);
  emit("playing");
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(tick);
}

export function pause() {
  if (!S.playing) return;
  S.playing = false;
  held = false;
  skew = 0;
  pendingT = null;
  cancelAnimationFrame(raf);
  for (const v of vids) {
    v.pause();
    v.muted = true;
  }
  music.pause();
  cur = null;
  curVid = null;
  emit("playing");
  showAt(S.time);
}

export const toggle = () => (S.playing ? pause() : play());

// ---- arka plan muzigi (render ile ayni: offset'ten baslar, sonda dosya basina doner) ----
function musicPos(t) {
  const a = S.project.audio;
  const d = Number.isFinite(music.duration) && music.duration > 0 ? music.duration : a.srcDur || Infinity;
  const p = a.offset + t;
  if (p < d) return p;
  return a.loop ? (p - d) % d : d;
}

function musicVol(t) {
  const a = S.project.audio;
  const T = total();
  let v = clamp(a.volume, 0, 1);
  const fo = Math.min(a.fadeOut, T / 2);
  if (fo > 0 && t > T - fo) v *= clamp((T - t) / fo, 0, 1);
  return v;
}

function startMusic(t) {
  const a = S.project.audio;
  if (!a || !S.playing) {
    music.pause();
    return;
  }
  const src = M.audioUrl(a.path);
  if (music._src !== src) {
    music._src = src;
    music.src = src;
  }
  music.loop = a.loop;
  const p = musicPos(t);
  if (!a.loop && Number.isFinite(music.duration) && p >= music.duration) {
    music.pause();
    return;
  }
  music.currentTime = p;
  music.volume = musicVol(t);
  music.play().catch(() => {});
}

function syncMusic(t) {
  const a = S.project.audio;
  if (!a || music.paused || music.seeking || held) return;
  music.volume = musicVol(t);
  const want = musicPos(t);
  if (Math.abs(music.currentTime - want) > 0.3) music.currentTime = want;
}

// ---- kirpma onizlemesi: belirli bir kaynak karesini goster ----
export function peek(clipId, st) {
  const e = layout().find((x) => x.c.id === clipId);
  if (!e) return;
  peeking = true;
  showEntry(e, st);
  media.style.opacity = 1;
}

export function endPeek() {
  peeking = false;
  scheduleShow();
}

// ---- metin katmani ----
const textEls = new Map(); // id -> div (secimde yeniden olusturulmaz: surukleme kopmasin)

export function renderTexts(t = S.time, force = false) {
  const P = S.project;
  const H = box.clientHeight;
  const outH = P.settings.height;
  const k = H / outH; // cikti pikseli -> onizleme pikseli
  const selId = S.sel?.type === "text" ? S.sel.id : null;
  const keep = new Set();
  for (const x of P.texts) {
    const active = t >= x.start && t < x.end;
    if (!active && x.id !== selId) continue;
    keep.add(x.id);
    let d = textEls.get(x.id);
    if (!d) {
      d = el("div", "ptext");
      d.dataset.id = x.id;
      layer.append(d);
      textEls.set(x.id, d);
    }
    // yazi tipi yuklenene kadar olculer yanlis cikar; yuklenince yeniden cizilir
    const ready = fontReady(x.font);
    if (!ready) ensureFont(x.font);
    const kw = karaWords(x);
    // kelime vurgusu: oynatma ilerledikce sayi degisir; secili ama aktif olmayan (hayalet) metin tamamen renkli
    const done = kw ? (active ? karaDone(x, t) : kw.length) : 0;
    const sig = `${x.text}|${x.x}|${x.y}|${x.size}|${x.color}|${x.style}|${x.font}|${ready}|${H}|${outH}|${x.id === selId}|${active}|${kw ? `${done}|${x.dim}` : ""}`;
    if (!force && d._sig === sig) continue;
    d._sig = sig;
    paintText(d, x, { outH, k, selected: x.id === selId, active, done });
  }
  for (const [id, d] of textEls) {
    if (!keep.has(id)) {
      d.remove();
      textEls.delete(id);
    }
  }
}
fontEvents.addEventListener("font", () => renderTexts(S.time, true));
fontEvents.addEventListener("list", () => renderTexts(S.time, true));

// ---- katmanlar (logo/sticker ve ana serinin ustune binen videolar) ----
const imgEls = new Map(); // id -> img | video

function dropLayer(d) {
  if (d.tagName === "VIDEO") d.pause(); // DOM'dan cikan video sesi calmaya devam eder
  d.remove();
}

// Video katmaninin oynatma konumu ve sesi: oynarken akar, durunca kareye gider
function syncLayerVideo(d, x, t, active) {
  const top = x.srcDur > 0 ? x.srcDur - 0.05 : Infinity;
  const want = clamp(x.in + (t - x.start) * x.speed, x.in, Math.max(x.in, top));
  if (d.playbackRate !== x.speed) d.playbackRate = x.speed;
  if (S.playing && active && !held) {
    const vol = clamp(x.volume, 0, 1);
    d.muted = x.mute || vol <= 0;
    d.volume = vol;
    if (Math.abs(d.currentTime - want) > 0.3 && !d.seeking) d.currentTime = want;
    if (d.paused) {
      d.play().catch((err) => {
        if (err?.name === "NotAllowedError") { d.muted = true; d.play().catch(() => {}); }
      });
    }
    return;
  }
  if (!d.paused) d.pause();
  d.muted = true;
  if (d.seeking) d._next = want;
  else if (Math.abs(d.currentTime - want) > 0.02) d.currentTime = want;
}

function makeLayerEl(x) {
  const v = x.kind === "video";
  const d = el(v ? "video" : "img", "pimg");
  d.dataset.id = x.id;
  d.draggable = false;
  if (v) {
    d.muted = true;
    d.playsInline = true;
    d.setAttribute("playsinline", "");
    d.preload = "auto";
    d.disablePictureInPicture = true;
    d.addEventListener("loadedmetadata", () => { d._sig = null; renderImages(S.time); });
    d.addEventListener("seeked", () => {
      if (d._next != null) {
        const t = d._next;
        d._next = null;
        d.currentTime = t;
      }
    });
  } else {
    d.alt = "";
    d.addEventListener("load", () => { d._sig = null; renderImages(S.time); });
  }
  imgLayer.append(d);
  return d;
}

// Katmanin en/boy orani (yuklenmisse gercek boyuttan, degilse kayitli degerden)
export function layerAspect(x) {
  const d = imgEls.get(x.id);
  const w = d && (x.kind === "video" ? d.videoWidth : d.naturalWidth);
  const h = d && (x.kind === "video" ? d.videoHeight : d.naturalHeight);
  return w && h ? w / h : x.ar || (x.kind === "video" ? 16 / 9 : 1);
}

export function renderImages(t = S.time, force = false) {
  const P = S.project;
  const H = box.clientHeight;
  const outH = P.settings.height;
  const outW = P.settings.width;
  const k = H / outH; // cikti pikseli -> onizleme pikseli
  const selId = S.sel?.type === "image" ? S.sel.id : null;
  const keep = new Set();
  for (const x of P.images) {
    const active = t >= x.start && t < x.end;
    // oynarken yaklasan video katmani onceden yuklenir (baslarken beklemesin), gorunmez bekler
    const soon = S.playing && x.kind === "video" && t < x.start && x.start - t < 2;
    if (!active && !soon && x.id !== selId) continue;
    keep.add(x.id);
    let d = imgEls.get(x.id);
    if (d && d.tagName !== (x.kind === "video" ? "VIDEO" : "IMG")) { // "Degistir" ile tur degisti
      dropLayer(d);
      d = null;
    }
    if (!d) {
      d = makeLayerEl(x);
      imgEls.set(x.id, d);
    }
    const video = x.kind === "video";
    if (d._path !== x.path) { // "Degistir": yeni dosya
      d._path = x.path;
      d._src = null;
    }
    const src = video ? d._src || M.videoUrl(x.path) : M.imageUrl(x.path); // video: ilk adres korunur (oynarken degismesin)
    if (d._src !== src) {
      d._src = src;
      d.src = src;
    }
    if (video) syncLayerVideo(d, x, t, active);
    const nw = video ? d.videoWidth : d.naturalWidth;
    const sig = `${x.path}|${x.x}|${x.y}|${x.size}|${x.opacity}|${H}|${outW}|${outH}|${x.id === selId}|${active}|${soon}|${nw}`;
    if (!force && d._sig === sig) continue;
    d._sig = sig;
    d.className = `pimg${x.id === selId ? " sel" : ""}`;
    d.style.left = `${x.x * 100}%`;
    d.style.top = `${x.y * 100}%`;
    // render ile ayni: iw x H kutusuna sigdir (en-boy korunur)
    const iw = x.size * outW;
    const ar = video
      ? (d.videoWidth && d.videoHeight ? d.videoWidth / d.videoHeight : x.ar || 16 / 9)
      : (d.naturalWidth && d.naturalHeight ? d.naturalWidth / d.naturalHeight : 1);
    let w = iw;
    let h = iw / ar;
    if (h > outH) {
      h = outH;
      w = outH * ar;
    }
    d.style.width = `${w * k}px`;
    d.style.height = `${h * k}px`;
    d.style.opacity = String(active ? x.opacity : x.id === selId ? x.opacity * 0.4 : 0);
  }
  for (const [id, d] of imgEls) {
    if (!keep.has(id)) {
      dropLayer(d);
      imgEls.delete(id);
    }
  }
  // dizideki sira = ust uste binme sirasi (sonraki ustte)
  P.images.forEach((x, i) => {
    const d = imgEls.get(x.id);
    if (d && d._z !== i) {
      d._z = i;
      d.style.zIndex = String(i);
    }
  });
}

// Onizlemede gorseli surukleyerek tasima (ortaya miknatis)
imgLayer.addEventListener("pointerdown", (ev) => {
  const d = ev.target.closest(".pimg");
  if (!d) return;
  ev.preventDefault();
  pause();
  const x = S.project.images.find((t) => t.id === d.dataset.id);
  if (!x) return;
  const wasSel = S.sel?.type === "image" && S.sel.id === x.id;
  select("image", x.id);
  const r = box.getBoundingClientRect();
  const g = { px: ev.clientX, py: ev.clientY, x0: x.x, y0: x.y, moved: false };
  d.setPointerCapture(ev.pointerId);
  const move = (e) => {
    if (!g.moved && Math.hypot(e.clientX - g.px, e.clientY - g.py) < 4) return;
    g.moved = true;
    let nx = clamp(g.x0 + (e.clientX - g.px) / r.width, 0, 1);
    let ny = clamp(g.y0 + (e.clientY - g.py) / r.height, 0, 1);
    const sx = Math.abs(nx - 0.5) < 0.015;
    const sy = Math.abs(ny - 0.5) < 0.015;
    if (sx) nx = 0.5;
    if (sy) ny = 0.5;
    guides.classList.toggle("gx-on", sx);
    guides.classList.toggle("gy-on", sy);
    x.x = Math.round(nx * 10000) / 10000;
    x.y = Math.round(ny * 10000) / 10000;
    renderImages(S.time);
  };
  const up = () => {
    d.removeEventListener("pointermove", move);
    d.removeEventListener("pointerup", up);
    d.removeEventListener("pointercancel", up);
    guides.className = "guides";
    if (g.moved) changed();
    else if (wasSel) emit("edit-image");
  };
  d.addEventListener("pointermove", move);
  d.addEventListener("pointerup", up);
  d.addEventListener("pointercancel", up);
});

// Onizlemede metni surukleyerek tasima (ortaya miknatis); secili metne tekrar dokunmak duzenler
layer.addEventListener("pointerdown", (ev) => {
  const d = ev.target.closest(".ptext");
  if (!d) return;
  ev.preventDefault();
  pause();
  const x = S.project.texts.find((t) => t.id === d.dataset.id);
  if (!x) return;
  const wasSel = S.sel?.type === "text" && S.sel.id === x.id;
  select("text", x.id);
  const r = box.getBoundingClientRect();
  const g = { px: ev.clientX, py: ev.clientY, x0: x.x, y0: x.y, moved: false };
  d.setPointerCapture(ev.pointerId);
  const move = (e) => {
    if (!g.moved && Math.hypot(e.clientX - g.px, e.clientY - g.py) < 4) return;
    g.moved = true;
    let nx = clamp(g.x0 + (e.clientX - g.px) / r.width, 0, 1);
    let ny = clamp(g.y0 + (e.clientY - g.py) / r.height, 0, 1);
    const sx = Math.abs(nx - 0.5) < 0.015;
    const sy = Math.abs(ny - 0.5) < 0.015;
    if (sx) nx = 0.5;
    if (sy) ny = 0.5;
    guides.classList.toggle("gx-on", sx);
    guides.classList.toggle("gy-on", sy);
    x.x = Math.round(nx * 10000) / 10000;
    x.y = Math.round(ny * 10000) / 10000;
    // otomatik altyazilar tek blok: biri tasininca hepsi ayni yere gider
    if (x.cap) for (const t of S.project.texts) if (t.cap) { t.x = x.x; t.y = x.y; }
    renderTexts(S.time);
  };
  const up = () => {
    d.removeEventListener("pointermove", move);
    d.removeEventListener("pointerup", up);
    d.removeEventListener("pointercancel", up);
    guides.className = "guides";
    if (g.moved) changed();
    else if (wasSel) emit("edit-text");
  };
  d.addEventListener("pointermove", move);
  d.addEventListener("pointerup", up);
  d.addEventListener("pointercancel", up);
});

box.addEventListener("click", (ev) => {
  if (ev.target.closest(".ptext, .pimg, button")) return;
  if (S.project.clips.length) toggle();
});

// ---- boyut: onizleme kutusu cikti en-boy oraninda, sahneye sigar ----
function fit() {
  const { width: W, height: H } = S.project.settings;
  const sw = stage.clientWidth - 16;
  const sh = stage.clientHeight - 16;
  if (sw <= 0 || sh <= 0) return;
  const k = Math.min(sw / W, sh / H);
  box.style.width = `${Math.floor(W * k)}px`;
  box.style.height = `${Math.floor(H * k)}px`;
  renderTexts(S.time, true);
  renderImages(S.time, true);
}
new ResizeObserver(fit).observe(stage);

// ---- durum olaylari ----
on("time", (src) => {
  if (src === "player") return;
  if (S.playing) {
    startAt(S.time);
    startMusic(S.time);
    return;
  }
  scheduleShow();
});

on("project", () => {
  fit();
  if (!S.playing) {
    scheduleShow();
    return;
  }
  const e = layout().find((x) => x.c.id === cur?.c.id);
  if (!e) {
    startAt(S.time);
    startMusic(S.time);
    return;
  }
  cur = e;
  const a = S.project.audio;
  if (!a) music.pause();
  else if (music._src !== M.audioUrl(a.path)) startMusic(S.time);
  else music.loop = a.loop;
});

on("select", () => {
  renderTexts(S.time, true);
  renderImages(S.time, true);
});
on("load", () => {
  pause();
  hideAll();
  clearTrans();
  fit();
});

M.events.addEventListener("proxy", () => {
  if (!S.playing) scheduleShow(); // proxy hazir: siradaki gosterimde hafif kopyaya gecilir
});
