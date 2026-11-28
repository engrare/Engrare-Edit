// Timeline: cetvel + video seridi (filmstrip) + metin + muzik seritleri.
// Imlec ortada sabittir, icerik kayar (kaydirmak = zamanda gezinmek). Tum hareketler
// pointer olaylariyla yonetilir (dokunma ve fare ayni):
//   - surukle: kaydir (birakinca ataletle devam eder), cetvele dokun: o ana git
//   - iki parmak / Ctrl+tekerlek: zoom
//   - secili klibin kenarlari: kirp (imlece miknatis, kenarda otomatik kaydirma)
//   - klibe uzun bas: siralama modu
//   - secili metin cubugu: surukle = tasi, kenarlar = sure
import { $, clamp, el, fmtDur, fmtTime, icon, round3, url, vibrate } from "./api.js";
import {
  MIN_CLIP, S, changed, emit, entryOf, frame, isSel, layerMaxEnd, layout, moveClip, on, select, setTime, total,
} from "./state.js";
import * as M from "./media.js";
import * as player from "./player.js";

const root = $("#timeline");
const cv = $("#tlCanvas");
const ctx = cv.getContext("2d");
const lay = $("#tlLayer");
const ro = $("#tlReorder");
const tip = $("#tlTip");

const ZMIN = 4;
const ZMAX = 600;
const RULER = 22;
const TEXT_H = 22;
const AUDIO_H = 24;
const SNAP_PX = 10;

let rows = null; // satir geometrisi
let laneOf = new Map(); // metin id -> serit
let W = 0; // gorunur genislik

// ---- geometri ----
function computeRows() {
  const vh = matchMedia("(min-width: 900px)").matches ? 64 : 54;
  // ust uste binen katmanlar (metin + gorsel) alt alta seritlere (en fazla 3)
  laneOf = new Map();
  const ends = [];
  const items = [
    ...S.project.texts.map((t) => ({ key: `text:${t.id}`, start: t.start, end: t.end })),
    ...S.project.images.map((t) => ({ key: `image:${t.id}`, start: t.start, end: t.end })),
  ].sort((a, b) => a.start - b.start);
  for (const t of items) {
    let k = ends.findIndex((e) => e <= t.start + 1e-6);
    if (k < 0) {
      k = Math.min(ends.length, 2);
      if (k === ends.length) ends.push(0);
    }
    ends[k] = Math.max(ends[k], t.end);
    laneOf.set(t.key, k);
  }
  const lanes = Math.max(1, ends.length);
  const vTop = RULER + 4;
  const tTop = vTop + vh + 6;
  const aTop = tTop + lanes * TEXT_H + 4;
  return { vh, vTop, tTop, aTop, H: aTop + AUDIO_H + 8, lanes };
}

const originX = () => W / 2 - S.time * S.pps; // ekranda zaman 0'in x'i
export const timeAtX = (x) => S.time + (x - W / 2) / S.pps;

// ---- DOM katmani (klip cerceveleri, metin/muzik cubuklari) ----
function handle(side, kind, id) {
  const h = el("div", `tl-h ${side}`);
  h.dataset.handle = side;
  h.dataset.kind = kind;
  if (id) h.dataset.id = id;
  return h;
}

function place(d, left, width, top, height) {
  d.style.cssText = `left:${left}px;width:${width}px;top:${top}px;height:${height}px`;
  d._l = left;
  d._w = width;
}

function build() {
  if (!(g?.mode === "move" && rows)) rows = computeRows(); // tasirken seritler sabit kalsin
  root.style.height = `${rows.H}px`;
  W = root.clientWidth;
  lay.textContent = "";
  const pps = S.pps;
  const L = layout();
  const T = total();

  for (const e of L) {
    const c = e.c;
    const sel = isSel("clip", c.id);
    const w = Math.max(2, e.dur * pps - 2);
    const d = el("div", `tl-clip${sel ? " sel" : ""}${w < 46 ? " narrow" : ""}`);
    d.dataset.kind = "clip";
    d.dataset.id = c.id;
    place(d, e.start * pps + 1, w, rows.vTop, rows.vh);
    const info = el("div", "tl-info");
    info.append(el("span", null, fmtDur(e.dur)));
    if (c.speed !== 1) info.append(el("span", "tl-badge", `${c.speed}×`));
    if (c.kind === "video" && (c.mute || c.volume === 0)) info.insertAdjacentHTML("beforeend", icon("mute", "ic tl-ic"));
    d.append(info);
    if (sel) d.append(handle("l", "clip", c.id), handle("r", "clip", c.id));
    lay.append(d);
  }

  // gecis bolgeleri (kliplerin ust uste bindigi aralik)
  for (const e of L) {
    if (e.trans > 0) {
      const d = el("div", "tl-trans");
      d.title = "Geçiş";
      place(d, (e.end - e.trans) * pps, e.trans * pps, rows.vTop, rows.vh);
      lay.append(d);
    }
  }

  if (L.length) {
    const add = el("button", "tl-add");
    add.dataset.kind = "add";
    add.title = "Medya ekle";
    add.innerHTML = icon("plus");
    place(add, T * pps + 10, rows.vh, rows.vTop, rows.vh);
    lay.append(add);
  } else {
    const add = el("button", "tl-empty");
    add.dataset.kind = "add";
    add.innerHTML = `${icon("plus")}<span>Medya ekle</span>`;
    place(add, 0, 220, rows.vTop, rows.vh);
    lay.append(add);
  }

  if (S.project.texts.length) {
    for (const t of S.project.texts) {
      const sel = isSel("text", t.id);
      const d = el("div", `tl-bar text${t.cap ? " cap" : ""}${sel ? " sel" : ""}`);
      d.dataset.kind = "text";
      d.dataset.id = t.id;
      const lane = Math.min(laneOf.get(`text:${t.id}`) ?? 0, rows.lanes - 1);
      place(d, t.start * pps, Math.max(6, (t.end - t.start) * pps), rows.tTop + lane * TEXT_H, TEXT_H - 3);
      d.append(el("span", null, (t.text || "Metin").replace(/\s+/g, " ")));
      if (sel) d.append(handle("l", "text", t.id), handle("r", "text", t.id));
      lay.append(d);
    }
  } else if (!S.project.images.length) { // yalnizca ikisi de bosken: ustuste binmesin
    const ph = el("button", "tl-ph");
    ph.dataset.kind = "add-text";
    ph.innerHTML = `${icon("text")}<span>Metin ekle</span>`;
    place(ph, 0, 132, rows.tTop, TEXT_H - 3);
    lay.append(ph);
  }

  if (S.project.images.length) {
    for (const im of S.project.images) {
      const sel = isSel("image", im.id);
      const d = el("div", `tl-bar image${im.kind === "video" ? " video" : ""}${sel ? " sel" : ""}`);
      d.dataset.kind = "image";
      d.dataset.id = im.id;
      const lane = Math.min(laneOf.get(`image:${im.id}`) ?? 0, rows.lanes - 1);
      place(d, im.start * pps, Math.max(6, (im.end - im.start) * pps), rows.tTop + lane * TEXT_H, TEXT_H - 3);
      d.append(el("span", null, im.name || "Görsel"));
      if (sel) d.append(handle("l", "image", im.id), handle("r", "image", im.id));
      lay.append(d);
    }
  } else if (!S.project.texts.length) {
    const ph = el("button", "tl-ph");
    ph.dataset.kind = "add-image";
    ph.innerHTML = `${icon("layers")}<span>Katman ekle</span>`;
    place(ph, 138, 132, rows.tTop, TEXT_H - 3);
    lay.append(ph);
  }

  const a = S.project.audio;
  if (a) {
    const d = el("div", `tl-bar audio${isSel("audio") ? " sel" : ""}`);
    d.dataset.kind = "audio";
    const left = a.srcDur > 0 ? a.srcDur - a.offset : Infinity;
    const len = a.loop ? T : Math.min(T, left);
    place(d, 0, Math.max(40, len * pps), rows.aTop, AUDIO_H - 3);
    d.innerHTML = `${icon("music", "ic tl-ic")}<span></span>`;
    d.querySelector("span").textContent = a.name + (a.loop ? " · döngü" : "");
    lay.append(d);
  } else {
    const ph = el("button", "tl-ph");
    ph.dataset.kind = "add-music";
    ph.innerHTML = `${icon("music")}<span>Müzik ekle</span>`;
    place(ph, 0, 132, rows.aTop, AUDIO_H - 3);
    lay.append(ph);
  }
  draw();
}

let buildRaf = 0;
function requestBuild() {
  if (!buildRaf) buildRaf = requestAnimationFrame(() => {
    buildRaf = 0;
    build();
  });
}

// ---- canvas: cetvel + filmstrip ----
const STEPS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];

function drawRuler(X0) {
  const pps = S.pps;
  const major = STEPS.find((s) => s * pps >= 64) || 600;
  const minor = (major / 5) * pps >= 7 ? major / 5 : major / 2;
  ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.textBaseline = "top";
  const k0 = Math.max(0, Math.floor(-X0 / pps / minor));
  const k1 = Math.ceil((W - X0) / pps / minor);
  for (let k = k0; k <= k1; k++) {
    const t = k * minor;
    const x = Math.round(X0 + t * pps) + 0.5;
    const q = t / major;
    const isMajor = Math.abs(q - Math.round(q)) < 1e-6;
    ctx.fillStyle = isMajor ? "#7d8596" : "#3f4555";
    ctx.fillRect(x - 0.5, isMajor ? 13 : 17, 1, isMajor ? 8 : 4);
    if (isMajor) {
      ctx.fillStyle = "#8b92a2";
      ctx.fillText(major < 1 ? fmtTime(t, 1) : fmtTime(t, 0), x + 3, 2);
    }
  }
}

function tileImage(im, sx, sw, sh, x0, x1, top, h, xs) {
  // im karelerini [x0, x1) araliginda klip basina (xs) hizali doser
  const tw = Math.max(8, (h * sw) / sh);
  let x = xs + Math.max(0, Math.floor((x0 - xs) / tw)) * tw;
  for (; x < x1; x += tw) ctx.drawImage(im, sx, 0, sw, sh, x, top, tw, h);
}

function drawStrips(X0) {
  const { vTop: top, vh: h } = rows;
  const pps = S.pps;
  for (const e of layout()) {
    const xs = X0 + e.start * pps + 1;
    const xe = X0 + e.end * pps - 1;
    if (xe < 0 || xs > W) continue;
    const c = e.c;
    const v0 = Math.max(xs, 0);
    const v1 = Math.min(xe, W);
    ctx.save();
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(xs, top, Math.max(1, xe - xs), h, 6);
    else ctx.rect(xs, top, Math.max(1, xe - xs), h);
    ctx.clip();
    ctx.fillStyle = "#232838";
    ctx.fillRect(v0, top, v1 - v0, h);
    const sp = c.kind === "video" ? M.sprite(c.path, c.srcDur) : null;
    if (sp?.ok) {
      const tw = Math.max(8, (h * sp.tw) / sp.th);
      const dur = c.srcDur || sp.n;
      let k = Math.max(0, Math.floor((v0 - xs) / tw));
      for (let x = xs + k * tw; x < v1; x += tw, k++) {
        const st = c.in + ((x - xs + tw / 2) / pps) * c.speed; // karo ortasindaki kaynak ani
        const j = clamp(Math.round((st / dur) * sp.n), 0, sp.n - 1);
        ctx.drawImage(sp.img, j * sp.tw, 0, sp.tw, sp.th, x, top, tw, h);
      }
    } else {
      const th = M.thumb(c.path);
      if (th.ok) tileImage(th.img, 0, th.img.naturalWidth, th.img.naturalHeight, v0, v1, top, h, xs);
    }
    // gecis (fade) gostergesi
    const fi = Math.min(c.fadeIn, e.dur / 2) * pps;
    const fo = Math.min(c.fadeOut, e.dur / 2) * pps;
    if (fi > 0) {
      const gr = ctx.createLinearGradient(xs, 0, xs + fi, 0);
      gr.addColorStop(0, "rgba(0,0,0,.8)");
      gr.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = gr;
      ctx.fillRect(xs, top, fi, h);
    }
    if (fo > 0) {
      const gr = ctx.createLinearGradient(xe - fo, 0, xe, 0);
      gr.addColorStop(0, "rgba(0,0,0,0)");
      gr.addColorStop(1, "rgba(0,0,0,.8)");
      ctx.fillStyle = gr;
      ctx.fillRect(xe - fo, top, fo, h);
    }
    ctx.restore();
  }
}

function draw() {
  if (!rows) return;
  const dpr = window.devicePixelRatio || 1;
  W = root.clientWidth;
  const H = rows.H;
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    cv.style.width = `${W}px`;
    cv.style.height = `${H}px`;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  const X0 = originX();
  lay.style.transform = `translate3d(${X0}px,0,0)`;
  // bos serit dugmeleri gorunen alanin solunda kalsin (saga kaydirinca kaybolmasin)
  for (const ph of lay.querySelectorAll(".tl-ph")) ph.style.left = `${Math.max(0, 8 - X0) + ph._l}px`;
  // cubuk basi ekranin solunda kaldiysa etiketi gorunen kenara kaydir
  for (const b of lay.querySelectorAll(".tl-bar")) {
    const hidden = -(X0 + b._l);
    b.style.paddingLeft = hidden > 0 ? `${7 + Math.max(0, Math.min(hidden, b._w - 70))}px` : "";
  }
  drawRuler(X0);
  drawStrips(X0);
}

let drawRaf = 0;
function requestDraw() {
  if (!drawRaf) drawRaf = requestAnimationFrame(() => {
    drawRaf = 0;
    draw();
  });
}

// ---- zoom ----
export function zoomTo(pps) {
  const v = clamp(pps, ZMIN, ZMAX);
  if (Math.abs(v - S.pps) < 1e-3) return;
  S.pps = v;
  emit("zoom");
}
export const zoomBy = (f) => zoomTo(S.pps * f);
export function zoomFit() {
  W = root.clientWidth || window.innerWidth;
  const T = total();
  S.pps = T > 0 ? clamp((W * 0.45) / T, 10, 120) : 60;
  emit("zoom");
}

// ---- hareketler ----
const pointers = new Map();
let g = null; // tek parmak hareketi
let pinch = null;
let inertia = 0;
let autoRaf = 0;
let lastTap = { id: null, t: 0 };

function hit(target) {
  const h = target.closest("[data-handle]");
  if (h) return { kind: h.dataset.kind, id: h.dataset.id || null, handle: h.dataset.handle };
  const k = target.closest("[data-kind]");
  if (k) return { kind: k.dataset.kind, id: k.dataset.id || null };
  return { kind: "empty", id: null };
}

const localX = (clientX) => clientX - g.left;

root.addEventListener("pointerdown", (ev) => {
  if (ev.pointerType === "mouse" && ev.button !== 0) return;
  ev.preventDefault();
  root.setPointerCapture(ev.pointerId);
  pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
  stopInertia();
  player.pause();
  if (pointers.size === 2) {
    startPinch();
    return;
  }
  if (pointers.size > 2 || pinch) return;
  const r = root.getBoundingClientRect();
  g = {
    id: ev.pointerId, x0: ev.clientX, y0: ev.clientY, left: r.left, top: r.top, t0: S.time,
    hit: hit(ev.target), mode: null, lp: 0, trail: [[performance.now(), ev.clientX]],
    lastX: ev.clientX, snapped: null, mouse: ev.pointerType === "mouse",
  };
  if (g.hit.handle) beginTrim();
  else if (g.hit.kind === "clip") g.lp = setTimeout(beginReorder, 420);
});

root.addEventListener("pointermove", (ev) => {
  if (!pointers.has(ev.pointerId)) return;
  pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
  if (pinch) {
    movePinch();
    return;
  }
  if (!g || ev.pointerId !== g.id) return;
  g.lastX = ev.clientX;
  const dx = ev.clientX - g.x0;
  const dy = ev.clientY - g.y0;
  if (!g.mode && Math.hypot(dx, dy) > 6) {
    clearTimeout(g.lp);
    if ((g.hit.kind === "text" || g.hit.kind === "image") && isSel(g.hit.kind, g.hit.id)) beginMoveText();
    else g.mode = "pan";
  }
  if (g.mode === "pan") {
    setTime(g.t0 - dx / S.pps, "pan");
    g.trail.push([performance.now(), ev.clientX]);
    if (g.trail.length > 6) g.trail.shift();
  } else if (g.mode === "trim") {
    moveTrim();
  } else if (g.mode === "reorder") {
    moveReorder();
  } else if (g.mode === "move") {
    moveText();
  }
});

function up(ev) {
  if (!pointers.delete(ev.pointerId)) return;
  if (pinch) {
    if (pointers.size < 2) pinch = null;
    g = null;
    return;
  }
  if (!g || ev.pointerId !== g.id) return;
  clearTimeout(g.lp);
  const cancel = ev.type === "pointercancel";
  if (g.mode === "pan") {
    if (!cancel && !g.mouse) startInertia(); // fareyle surukleme ataletsiz (masaustu alisikligi)
  } else if (g.mode === "trim") {
    endTrim(cancel);
  } else if (g.mode === "reorder") {
    endReorder(cancel);
  } else if (g.mode === "move") {
    endMoveText(cancel);
  } else if (!cancel) {
    tap(ev);
  }
  stopAuto();
  g = null;
}
root.addEventListener("pointerup", up);
root.addEventListener("pointercancel", up);

function tap(ev) {
  const h = g.hit;
  const now = performance.now();
  if (h.kind === "clip") select("clip", h.id);
  else if (h.kind === "text") {
    const dbl = lastTap.id === h.id && now - lastTap.t < 350;
    select("text", h.id);
    if (dbl) emit("edit-text");
  } else if (h.kind === "image") {
    const dbl = lastTap.id === h.id && now - lastTap.t < 350;
    select("image", h.id);
    if (dbl) emit("edit-image");
  } else if (h.kind === "audio") select("audio");
  else if (h.kind === "add") emit("ui", "media");
  else if (h.kind === "add-text") emit("ui", "add-text");
  else if (h.kind === "add-image") emit("ui", "image");
  else if (h.kind === "add-music") emit("ui", "music");
  else if (ev.clientY - g.top < RULER + 2) setTime(timeAtX(localX(ev.clientX)), "ruler");
  else select(null);
  lastTap = { id: h.id, t: now };
}

root.addEventListener("wheel", (ev) => {
  ev.preventDefault();
  stopInertia();
  player.pause();
  const unit = ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? W : 1;
  if (ev.ctrlKey || ev.metaKey) { // trackpad pinch da ctrl+tekerlek olarak gelir
    zoomBy(clamp(Math.exp(-ev.deltaY * unit * 0.01), 0.7, 1.4));
    return;
  }
  const d = (Math.abs(ev.deltaX) > Math.abs(ev.deltaY) ? ev.deltaX : ev.deltaY) * unit;
  setTime(S.time + d / S.pps, "pan");
}, { passive: false });

// -- atalet --
function startInertia() {
  const tr = g.trail;
  if (tr.length < 2) return;
  const [ta, xa] = tr[0];
  const [tb, xb] = tr[tr.length - 1];
  if (tb - ta <= 0 || performance.now() - tb > 80) return;
  let v = (xb - xa) / (tb - ta); // px/ms
  if (Math.abs(v) < 0.25) return;
  let last = performance.now();
  const step = (now) => {
    const d = now - last;
    last = now;
    setTime(S.time - (v * d) / S.pps, "pan");
    v *= 0.996 ** d;
    if (Math.abs(v) < 0.03 || S.time <= 0 || S.time >= total()) {
      inertia = 0;
      return;
    }
    inertia = requestAnimationFrame(step);
  };
  inertia = requestAnimationFrame(step);
}
export function stopInertia() {
  cancelAnimationFrame(inertia);
  inertia = 0;
}

// -- pinch zoom --
function startPinch() {
  if (g) {
    clearTimeout(g.lp);
    if (g.mode === "trim") endTrim(true);
    else if (g.mode === "reorder") endReorder(true);
    else if (g.mode === "move") endMoveText(true);
    stopAuto();
  }
  g = null;
  const [a, b] = [...pointers.values()];
  pinch = { d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, pps0: S.pps };
}
function movePinch() {
  const [a, b] = [...pointers.values()];
  zoomTo((pinch.pps0 * Math.hypot(a.x - b.x, a.y - b.y)) / pinch.d0);
}

// -- kenarda otomatik kaydirma (kirpma, tasima, siralama) --
function startAuto() {
  const step = () => {
    if (!g || !["trim", "move", "reorder"].includes(g.mode)) {
      autoRaf = 0;
      return;
    }
    const x = localX(g.lastX);
    const zone = 44;
    let v = 0;
    if (x < zone) v = -(zone - x) / zone;
    else if (x > W - zone) v = (x - (W - zone)) / zone;
    if (v) {
      if (g.mode === "reorder") {
        g.ro.base -= v * 8;
        moveReorder();
      } else {
        setTime(S.time + (v * 8) / S.pps, "pan");
        if (g.mode === "trim") moveTrim();
        else moveText();
      }
    }
    autoRaf = requestAnimationFrame(step);
  };
  if (!autoRaf) autoRaf = requestAnimationFrame(step);
}
function stopAuto() {
  cancelAnimationFrame(autoRaf);
  autoRaf = 0;
}

function snapTo(v, cands) {
  for (const c of cands) {
    if (Math.abs(v - c) * S.pps < SNAP_PX) {
      if (g.snapped !== c) vibrate(6);
      g.snapped = c;
      return c;
    }
  }
  g.snapped = null;
  return v;
}

function showTip(text) {
  tip.textContent = text;
  tip.hidden = false;
  tip.style.left = `${clamp(localX(g.lastX), 44, W - 44)}px`;
}

// -- kirpma --
function beginTrim() {
  const { kind, id, handle: side } = g.hit;
  const tAt = timeAtX(localX(g.x0));
  if (kind === "clip") {
    const e = entryOf(id);
    if (!e) return;
    const c = e.c;
    g.tr = { kind, side, c, in0: c.in, out0: c.out ?? c.srcDur, start0: e.start, end0: e.end, dur0: e.dur };
    g.grab = (side === "l" ? e.start : e.end) - tAt;
  } else if (kind === "text" || kind === "image") {
    const arr = kind === "image" ? S.project.images : S.project.texts;
    const t = arr.find((x) => x.id === id);
    if (!t) return;
    g.tr = { kind, side, t, s0: t.start, e0: t.end, in0: t.in };
    g.grab = (side === "l" ? t.start : t.end) - tAt;
  } else {
    return;
  }
  g.mode = "trim";
  vibrate(8);
  startAuto();
}

function moveTrim() {
  const tr = g.tr;
  let edge = timeAtX(localX(g.lastX)) + g.grab;
  if (tr.kind === "clip") {
    const c = tr.c;
    const sp = c.speed;
    edge = snapTo(edge, [S.time]);
    if (tr.side === "l") {
      // sag kenar sabit, sol kenar parmagi izler; arada gecici bosluk (birakinca kapanir)
      if (c.kind === "image") {
        const dur = clamp(tr.end0 - edge, MIN_CLIP, 600);
        c.out = round3(dur);
        S.trimShift = { id: c.id, dt: tr.dur0 - dur };
      } else {
        c.in = round3(clamp(tr.in0 + (edge - tr.start0) * sp, 0, tr.out0 - MIN_CLIP * sp));
        S.trimShift = { id: c.id, dt: (c.in - tr.in0) / sp };
      }
    } else if (c.kind === "image") {
      c.out = round3(clamp(edge - tr.start0, MIN_CLIP, 600));
    } else {
      c.out = round3(clamp(c.in + (edge - tr.start0) * sp, c.in + MIN_CLIP * sp, c.srcDur || Infinity));
    }
    changed(false);
    const e = entryOf(c.id);
    showTip(fmtDur(e.dur));
    if (c.kind === "video") player.peek(c.id, tr.side === "l" ? c.in : Math.max(c.in, c.out - frame() * sp));
  } else {
    const t = tr.t;
    edge = snapTo(edge, [S.time, 0, total(), ...layout().flatMap((x) => [x.start, x.end])]);
    if (tr.side === "l") {
      let ns = clamp(edge, 0, t.end - 0.2);
      if (t.kind === "video") { // video katmani: sol kenar kaynaktan da kirpar (in >= 0)
        ns = Math.max(ns, tr.s0 - tr.in0 / t.speed);
        t.in = round3(tr.in0 + (ns - tr.s0) * t.speed);
      }
      t.start = round3(ns);
    } else {
      t.end = round3(Math.min(Math.max(t.start + 0.2, edge), layerMaxEnd(t)));
    }
    changed(false);
    showTip(`${fmtTime(t.start, 2)} – ${fmtTime(t.end, 2)}`);
  }
}

function endTrim(cancel) {
  const tr = g.tr;
  tip.hidden = true;
  player.endPeek();
  stopAuto();
  if (!tr) return;
  if (tr.kind === "clip") {
    if (cancel) {
      tr.c.in = tr.in0;
      tr.c.out = tr.c.kind === "image" ? tr.dur0 : tr.out0;
    }
    S.trimShift = null;
    changed(!cancel);
    const e = entryOf(tr.c.id);
    if (e && !cancel) setTime(tr.side === "l" ? e.start : Math.max(e.start, e.end - frame() / 2), "edit");
  } else {
    if (cancel) {
      tr.t.start = tr.s0;
      tr.t.end = tr.e0;
      if (tr.in0 != null) tr.t.in = tr.in0;
    }
    changed(!cancel);
  }
}

// -- siralama (uzun bas) --
const TILE = 58;
const TGAP = 6;

function beginReorder() {
  if (!g || g.mode) return;
  const from = S.project.clips.findIndex((c) => c.id === g.hit.id);
  if (from < 0) return;
  g.mode = "reorder";
  vibrate(20);
  g.ro = { from, to: from, base: localX(g.lastX) - from * (TILE + TGAP) - TILE / 2 };
  ro.textContent = "";
  ro.style.top = `${rows.vTop}px`;
  ro.style.height = `${rows.vh}px`;
  S.project.clips.forEach((c, k) => {
    const d = el("div", `ro-tile${k === from ? " drag" : ""}`);
    const im = el("img");
    im.src = url.thumb(c.path);
    im.alt = "";
    im.draggable = false;
    d.append(im);
    ro.append(d);
  });
  ro.hidden = false;
  root.classList.add("reordering");
  moveReorder();
  startAuto();
}

function moveReorder() {
  const { from, base } = g.ro;
  const n = S.project.clips.length;
  const x = localX(g.lastX) - TILE / 2;
  const to = clamp(Math.round((x - base) / (TILE + TGAP)), 0, n - 1);
  if (to !== g.ro.to) {
    g.ro.to = to;
    vibrate(5);
  }
  [...ro.children].forEach((d, k) => {
    let slot = k;
    if (k === from) {
      d.style.transform = `translateX(${x}px)`;
      return;
    }
    if (from < to && k > from && k <= to) slot = k - 1;
    else if (from > to && k >= to && k < from) slot = k + 1;
    d.style.transform = `translateX(${base + slot * (TILE + TGAP)}px)`;
  });
}

function endReorder(cancel) {
  stopAuto();
  ro.hidden = true;
  root.classList.remove("reordering");
  const { from, to } = g.ro;
  if (cancel || from === to) return;
  const id = S.project.clips[from].id;
  moveClip(from, to);
  select("clip", id);
  setTime(entryOf(id).start, "edit");
}

// -- metin cubugunu tasima --
function beginMoveText() {
  const arr = g.hit.kind === "image" ? S.project.images : S.project.texts;
  const t = arr.find((x) => x.id === g.hit.id);
  if (!t) {
    g.mode = "pan";
    return;
  }
  g.mode = "move";
  g.mt = { t, s0: t.start, e0: t.end, w0: t.words || null, tDown: timeAtX(localX(g.x0)) };
  startAuto();
}

function moveText() {
  const { t, s0, e0, tDown } = g.mt;
  const len = e0 - s0;
  let ns = Math.max(0, s0 + timeAtX(localX(g.lastX)) - tDown);
  // baslangic ya da bitis imlece / klip sinirlarina yapisir
  const cands = [S.time, 0, ...layout().flatMap((x) => [x.start, x.end])];
  const a = snapTo(ns, cands);
  if (a !== ns) ns = a;
  else {
    const b = snapTo(ns + len, cands);
    if (b !== ns + len) ns = b - len;
  }
  t.start = round3(Math.max(0, ns));
  t.end = round3(t.start + len);
  if (g.mt.w0) t.words = g.mt.w0.map((w) => [round3(w[0] + t.start - s0), round3(w[1] + t.start - s0)]); // kelime vurgusu metinle birlikte kayar
  changed(false);
  showTip(fmtTime(t.start, 2));
}

function endMoveText(cancel) {
  tip.hidden = true;
  stopAuto();
  const { t, s0, e0, w0 } = g.mt;
  if (cancel) {
    t.start = s0;
    t.end = e0;
    if (w0) t.words = w0;
  }
  g.mode = null;
  changed(!cancel);
}

// ---- olaylar ----
on("project", requestBuild);
on("select", requestBuild);
on("zoom", requestBuild);
on("time", requestDraw);
on("load", () => {
  stopInertia();
  zoomFit();
});
M.events.addEventListener("image", requestDraw);
new ResizeObserver(requestBuild).observe(root);
