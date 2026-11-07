// Metin yazi tipleri: sunucudaki liste, tarayiciya yukleme ve render (ffmpeg drawtext) ile ayni metin olculeri.
import { API } from "./api.js";

export const DEFAULT_FONT = "dejavu";

// Liste sunucudan gelir (GET /api/fonts); gelene kadar yalnizca varsayilan font vardir.
let list = [{ id: DEFAULT_FONT, label: "Standart", weight: 700, line: 1.164 }];
const loading = new Map(); // id -> Promise
const loaded = new Set();
export const events = new EventTarget(); // "list" | "font" (detail: id)

export async function loadFontList() {
  try {
    const r = await fetch(`${API}/api/fonts`, { credentials: "include" });
    if (r.ok) list = await r.json();
  } catch (e) { /* varsayilan font ile devam */ }
  events.dispatchEvent(new Event("list"));
}

export const fontList = () => list;
export const fontOf = (id) => list.find((f) => f.id === id) || list.find((f) => f.id === DEFAULT_FONT) || list[0];
export const familyOf = (id) => `EngrareFont-${fontOf(id).id}`;
export const fontReady = (id) => loaded.has(fontOf(id).id);

// Yazi tipini tarayiciya yukler; bitince "font" olayi gelir.
export function ensureFont(id) {
  const f = fontOf(id);
  if (!loading.has(f.id)) {
    const face = new FontFace(familyOf(f.id), `url(${API}/api/fonts/${f.id}/file)`, { weight: String(f.weight) });
    loading.set(f.id, face.load().then((ff) => {
      document.fonts.add(ff);
      loaded.add(f.id);
      events.dispatchEvent(new CustomEvent("font", { detail: f.id }));
    }).catch(() => { loading.delete(f.id); }));
  }
  return loading.get(f.id);
}

// ---- yerlesim ----
// ffmpeg drawtext: metin kutusu = ilk satirin murekkep yuksekligi + (satir sayisi - 1) * aralik + son satirin
// murekkep inisi. Aralik = yazi tipi satir yuksekligi (yuvarlanmis) + line_spacing. Kutu (x,y) etrafinda ortalanir.
const cv = document.createElement("canvas").getContext("2d");

export const lineSpacing = (size) => Math.round(size * 0.15);
export const boxPad = (size) => Math.round(size * 0.3);

// Script fontlarda render, kutu disina tasan kivrimi keser: her satirin iki yanina bosluk eklenir
// (backend render.shape_text ile ayni).
export function shapeText(text, fontId) {
  return fontOf(fontId).pad ? String(text).split("\n").map((l) => ` ${l} `).join("\n") : String(text);
}

export function layoutText(text, fontId, size) {
  const f = fontOf(fontId);
  cv.font = `${f.weight} ${size}px "${familyOf(f.id)}"`;
  const lines = shapeText(text, fontId).split("\n");
  const pitch = Math.round(f.line * size) + lineSpacing(size);
  let tw = 0;
  let asc1 = 0;
  let descN = 0;
  let A = 0;
  let D = 0;
  lines.forEach((ln, i) => {
    const m = cv.measureText(ln || " ");
    tw = Math.max(tw, m.width);
    if (i === 0) {
      asc1 = ln.trim() ? Math.ceil(m.actualBoundingBoxAscent) : 0;
      A = m.fontBoundingBoxAscent;
      D = m.fontBoundingBoxDescent;
    }
    if (i === lines.length - 1) descN = ln.trim() ? Math.ceil(m.actualBoundingBoxDescent) : 0;
  });
  const th = asc1 + (lines.length - 1) * pitch + descN;
  return { lines, tw, th, pitch, asc1, A, D };
}
