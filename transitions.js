// Gecis onizlemesi: ffmpeg xfade turlerinin CSS karsiliklari.
// look(type, q) -> { bg, a, b }: q 0..1 ilerleme; a = cikan klip, b = giren klip.
// Her oge icin { opacity, transform, clipPath, mask, filter, top } alanlari (hepsi istege bagli);
// top: bu oge ustte durur (varsayilan: giren klip b). bg: gecis alaninin zemin rengi (siyaha/beyaza
// gecis, daire/dikdortgen kirpma). hblur ve pixelize gibi icerige bagli turler capraz erime olarak gosterilir.
// Degerler gercek ffmpeg ciktisindan olculerek ayarlandi (bkz. tools/visual/transitions.mjs).
import { clamp } from "./api.js";

const ss = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const pc = (v) => `${(v * 100).toFixed(2)}%`;

// Yumusak kenarli ogeler ffmpeg ciktisina uydurulmustur: alfa = smoothstep((f - g) / w), g giris kenarindan
// (merkezden, kosedenden) normalize uzaklik, f = a*q - b ilerleyen cizgi, w kenar genisligi.
// CSS gradyani dogrusal oldugu icin smoothstep egrisi ara duraklarla taklit edilir.
const edge = (f, w, inv = false) => {
  const stops = [];
  for (let i = 0; i <= 8; i++) {
    const a = 1 - ss(0, 1, i / 8);
    stops.push(`rgba(0,0,0,${(inv ? 1 - a : a).toFixed(3)}) ${pc(f - w / 2 + (w * i) / 8)}`);
  }
  return stops.join(", ");
};

// Kenardan girip ilerleyen perde. dir: gradyanin giren kenardan uzak kenara yonu.
function softEdge(dir, q) {
  return { mask: `linear-gradient(to ${dir}, ${edge(2 * q - 0.5, 1)})` };
}

// Merkezden acilan (open) ya da disaridan kapanan (close) yumusak daire (100% = yarim kosegen).
function softCircle(q, open) {
  const f = 3 * (open ? q : 1 - q) - 1;
  return { mask: `radial-gradient(circle farthest-corner at 50% 50%, ${edge(f, 1, !open)})` };
}

// Kosegen perde: B bir koseden girer, yumusak kenar o koseden uzaklasir.
function softDiag(corner, q) {
  return { mask: `radial-gradient(circle farthest-corner at ${corner}, ${edge(1.9 * q - 0.65, 1)})` };
}

const CROSS = (q) => ({ b: { opacity: q } });

// Kosegen perdeler: giren klip adi belirtilen kosenin KARSISINDAN girer (diagtl: B sag alttan).
const DIAG = { diagtl: "bottom right", diagtr: "bottom left", diagbl: "top right", diagbr: "top left" };

export function look(type, q) {
  q = clamp(q, 0, 1);
  const inset = (t, r, b, l) => `inset(${pc(t)} ${pc(r)} ${pc(b)} ${pc(l)})`;
  switch (type) {
    case "fade": case "dissolve": case "distance": case "pixelize":
      return CROSS(q);

    case "fadeblack": case "fadewhite": {
      // A once zemin rengine erir, sonra B zeminden belirir
      const bg = type === "fadeblack" ? "#000" : "#fff";
      return { bg, a: { opacity: 1 - ss(0, 0.2, q) }, b: { opacity: ss(0.2, 1, q) } };
    }
    case "fadegrays": // A griye doner, sonra gri zeminden B belirir
      return { a: { filter: `grayscale(${ss(0, 0.2, q)})` }, b: { opacity: ss(0.2, 1, q) } };

    // sert kenarli perdeler: B belirtilen kenardan girer
    case "wipeleft": return { b: { clipPath: inset(0, 0, 0, 1 - q) } };
    case "wiperight": return { b: { clipPath: inset(0, 1 - q, 0, 0) } };
    case "wipeup": return { b: { clipPath: inset(1 - q, 0, 0, 0) } };
    case "wipedown": return { b: { clipPath: inset(0, 0, 1 - q, 0) } };

    // kaydirma: iki klip birlikte hareket eder
    case "slideleft": return { a: { transform: `translateX(${pc(-q)})` }, b: { transform: `translateX(${pc(1 - q)})` } };
    case "slideright": return { a: { transform: `translateX(${pc(q)})` }, b: { transform: `translateX(${pc(q - 1)})` } };
    case "slideup": return { a: { transform: `translateY(${pc(-q)})` }, b: { transform: `translateY(${pc(1 - q)})` } };
    case "slidedown": return { a: { transform: `translateY(${pc(q)})` }, b: { transform: `translateY(${pc(q - 1)})` } };

    // yumusak perdeler
    case "smoothleft": return { b: { ...softEdge("left", q) } };
    case "smoothright": return { b: { ...softEdge("right", q) } };
    case "smoothup": return { b: { ...softEdge("top", q) } };
    case "smoothdown": return { b: { ...softEdge("bottom", q) } };

    case "circleopen": return { b: { ...softCircle(q, true) } };
    case "circleclose": return { b: { ...softCircle(q, false) } };

    case "circlecrop": { // A kuculerek kaybolur, sonra B siyahtan buyur
      const r = 70.71 * Math.abs(1 - 2 * q) ** 3;
      const st = { clipPath: `circle(${r.toFixed(2)}%)` };
      return q < 0.5 ? { bg: "#000", a: st, b: { opacity: 0 } } : { bg: "#000", a: { opacity: 0 }, b: { ...st } };
    }
    case "rectcrop": {
      const s = Math.abs(1 - 2 * q);
      const st = { clipPath: inset((1 - s) / 2, (1 - s) / 2, (1 - s) / 2, (1 - s) / 2) };
      return q < 0.5 ? { bg: "#000", a: st, b: { opacity: 0 } } : { bg: "#000", a: { opacity: 0 }, b: { ...st } };
    }
    case "radial": { // saat yonunde, 12'den baslayan supurme
      const f = 450 * q - 72;
      return { b: { mask: `conic-gradient(from 0deg at 50% 50%, #000 ${(f - 36).toFixed(1)}deg, transparent ${(f + 36).toFixed(1)}deg)` } };
    }

    case "diagtl": case "diagtr": case "diagbl": case "diagbr":
      return { b: { ...softDiag(DIAG[type], q) } };

    // sikistirma: A merkezde incelir, B arkada sabit
    case "squeezeh": return { a: { transform: `scaleY(${1 - q})`, top: true } };
    case "squeezev": return { a: { transform: `scaleX(${1 - q})`, top: true } };

    case "zoomin": // A buyuyerek yaklasir, B ustten belirir
      return { a: { transform: `scale(${1 + 3 * ss(0, 0.6, q)})` }, b: { opacity: ss(0.5, 1, q) } };
    default:
      return CROSS(q);
  }
}

// look() sonucunu bir ogeye uygular (verilmeyen alanlar temizlenir). top: ogeyi uste alir.
export function paint(node, st = {}, top = false) {
  node.style.opacity = st.opacity == null ? "" : String(st.opacity);
  node.style.transform = st.transform || "";
  node.style.clipPath = st.clipPath || "";
  node.style.filter = st.filter || "";
  node.style.webkitMaskImage = node.style.maskImage = st.mask || "";
  node.style.zIndex = top ? "2" : "1";
}

// Gecis stillerini tamamen temizler.
export function clear(node) {
  node.style.opacity = "";
  node.style.transform = "";
  node.style.clipPath = "";
  node.style.filter = "";
  node.style.webkitMaskImage = node.style.maskImage = "";
  node.style.zIndex = "";
}
