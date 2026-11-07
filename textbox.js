// Bir metin ogesinin DOM karsiligi: render'daki drawtext ile ayni yerlesim ve olculer.
// d: .ptext elemani; k: cikti pikseli -> ekran pikseli orani.
import { boxPad, familyOf, fontOf, layoutText, shapeText } from "./fonts.js";

export const KARA_DIM = "#9a9a9a"; // henuz soylenmemis kelimelerin rengi

// Kelime kelime renklenen altyazi: words = kelime basina [baslangic, bitis] (timeline sn). Kelime sayisi metinle
// uyusmuyorsa (metin duzenlenmis) vurgu kapanir (render'da backend ayni kurali uygular).
export function karaWords(x) {
  const n = String(x.text ?? "").split(/\s+/).filter(Boolean).length;
  return x.kara !== false && n && Array.isArray(x.words) && x.words.length === n ? x.words : null;
}

// t anina kadar baslamis kelime sayisi
export function karaDone(x, t) {
  const w = karaWords(x);
  if (!w) return 0;
  let n = 0;
  while (n < w.length && t >= w[n][0]) n++;
  return n;
}

// Satir metni: kelimeler span; soylenenler secilen renkte, gerisi gri
function karaLines(lines, x, text, done) {
  const frag = document.createDocumentFragment();
  let wi = 0;
  shapeText(text, x.font).split("\n").forEach((ln, li) => {
    if (li) frag.append("\n");
    for (const part of ln.split(/(\s+)/)) {
      if (!part) continue;
      if (/^\s+$/.test(part)) {
        frag.append(part);
        continue;
      }
      const sp = document.createElement("span");
      sp.textContent = part;
      sp.style.color = wi < done ? x.color : (x.dim || KARA_DIM);
      frag.append(sp);
      wi++;
    }
  });
  lines.replaceChildren(frag);
}

export function paintText(d, x, { outH, k, selected = false, active = true, done = 0 }) {
  const size = Math.max(8, Math.round(x.size * outH)); // render: fontsize
  const f = fontOf(x.font);
  const L = layoutText(x.text, x.font, size);
  const bw = x.style === "box" ? boxPad(size) : 0;

  d.className = `ptext s-${x.style}${selected ? " sel" : ""}${active ? "" : " ghost"}`;
  d.style.left = `${x.x * 100}%`;
  d.style.top = `${x.y * 100}%`;
  // bos metinde kutu cokmesin (secilebilir/surukelenebilir kalsin)
  d.style.width = `${(L.tw || size) * k}px`;
  d.style.height = `${(L.th || size) * k}px`;
  d.style.fontFamily = `"${familyOf(f.id)}", "DejaVu Sans", Verdana, sans-serif`;
  d.style.fontWeight = String(f.weight);
  d.style.fontSize = `${size * k}px`;
  d.style.color = x.color;
  d.style.outlineOffset = `${bw * k + 3}px`;

  // satir kutusunda taban cizgisi: yarim bosluk + yazi tipi ascent; ilk taban cizgisi kutu ustunden asc1 asagida
  const base = (L.pitch - (L.A + L.D)) / 2 + L.A;
  const lines = document.createElement("div");
  lines.className = "ptext-lines";
  lines.style.top = `${(L.asc1 - base) * k}px`;
  lines.style.lineHeight = `${L.pitch * k}px`;
  if (karaWords(x)) karaLines(lines, x, x.text, done);
  else lines.textContent = shapeText(x.text, x.font) || " ";
  const sh = Math.max(2, Math.round(size * 0.05)) * k;
  lines.style.webkitTextStroke = x.style === "outline" ? `${2 * Math.max(2, Math.round(size * 0.08)) * k}px #000` : "";
  lines.style.textShadow = x.style === "shadow" ? `${sh}px ${sh}px 0 rgba(0,0,0,.7)` : "";

  const kids = [];
  if (bw) {
    const bg = document.createElement("div");
    bg.className = "ptext-bg";
    bg.style.inset = `${-bw * k}px`;
    kids.push(bg);
  }
  kids.push(lines);
  d.replaceChildren(...kids);
}
