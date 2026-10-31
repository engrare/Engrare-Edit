// Arac cubugu (secime gore degisir), ayar panelleri (onizlemeyi kapatmaz) ve alt
// cekmeceler: medya (Drive), disa aktarma + gecmis + Instagram, projeler.
import {
  $, $$, API, HttpError, api, clamp, el, fmtAgo, fmtDur, fmtTime, icon, iconBtn, round3, sleep, toast, uid, url,
} from "./api.js";
import {
  DEFAULT_TRANS, FORMATS, S, TRANSITIONS, addImage, addText, applyCaptions, canRedo, canUndo, changed,
  cutTarget, discardPending, duplicateSelected, entryOf, flush, forgetLastProject, insertClip, lastTextFont,
  moveLayer, newProject, on, openProject, rememberTextFont, removeSelected, replaceLayerMedia,
  scheduleSave, select, selected, setAudio, setFormat, setLayerSpeed, setTransition, split,
  removeCaptions, styleCaptions, total, trimEnd, trimStart,
} from "./state.js";
import { confirmBox } from "./dialog.js";
import { fmtAt, whenPicker } from "./igpick.js";
import { ensureFont, familyOf, fontList } from "./fonts.js";
import * as M from "./media.js";
import * as player from "./player.js";

const toolbar = $("#toolbar");
const panel = $("#panel");

// ---- arac cubugu ----
const TOOLS = {
  none: [
    ["media", "plus", "Medya"], ["split", "split", "Böl"], ["trimL", "trimL", "Başı sil"],
    ["trimR", "trimR", "Sonu sil"], ["text", "text", "Metin"], ["captions", "cc", "Altyazı"],
    ["image", "layers", "Katman"], ["music", "music", "Müzik"], ["format", "format", "Format"],
  ],
  clip: [
    ["close", "close", "Kapat"], ["split", "split", "Böl"], ["trimL", "trimL", "Başı sil"],
    ["trimR", "trimR", "Sonu sil"], ["speed", "speed", "Hız"], ["volume", "volume", "Ses"],
    ["transition", "fade", "Geçiş"], ["fit", "fit", "Sığdır"], ["dup", "copy", "Kopyala"],
    ["del", "trash", "Sil"],
  ],
  text: [["close", "close", "Kapat"], ["editText", "edit", "Düzenle"], ["dup", "copy", "Kopyala"], ["del", "trash", "Sil"]],
  caption: [
    ["close", "close", "Kapat"], ["editText", "edit", "Düzenle"], ["capAll", "cc", "Tüm altyazılar"],
    ["dup", "copy", "Kopyala"], ["del", "trash", "Sil"],
  ],
  image: [["close", "close", "Kapat"], ["editImage", "sliders", "Ayarlar"], ["dup", "copy", "Kopyala"], ["del", "trash", "Sil"]],
  vlayer: [
    ["close", "close", "Kapat"], ["editImage", "sliders", "Ayarlar"], ["speed", "speed", "Hız"],
    ["volume", "volume", "Ses"], ["dup", "copy", "Kopyala"], ["del", "trash", "Sil"],
  ],
  audio: [["close", "close", "Kapat"], ["musicEdit", "sliders", "Ayarlar"], ["music", "replace", "Değiştir"], ["del", "trash", "Sil"]],
};
const TIPS = {
  split: "Böl (S)", trimL: "İmlecin solunu sil (Q)", trimR: "İmlecin sağını sil (W)",
  del: "Sil (Delete)", close: "Seçimi kaldır (Esc)",
};
let shownMode = null;

// Video katmaninin hiz/ses araclari vardir; resim katmaninin yoktur
const toolMode = () => {
  const x = selected();
  if (S.sel?.type === "image" && x?.kind === "video") return "vlayer";
  if (S.sel?.type === "text" && x?.cap) return "caption";
  return S.sel?.type || "none";
};

function renderToolbar() {
  const mode = toolMode();
  if (mode !== shownMode) {
    shownMode = mode;
    toolbar.textContent = "";
    toolbar.dataset.mode = mode;
    for (const [a, ic, label] of TOOLS[mode]) {
      const b = el("button", `tool t-${a}`);
      b.dataset.act = a;
      if (TIPS[a]) b.title = TIPS[a];
      iconBtn(b, ic, label);
      toolbar.append(b);
    }
    toolbar.scrollLeft = 0;
  }
  const c = S.sel?.type === "clip" ? selected() : null;
  if (c) {
    const fit = toolbar.querySelector(".t-fit");
    iconBtn(fit, c.fit === "cover" ? "cover" : "fit", c.fit === "cover" ? "Doldur" : "Sığdır");
    for (const k of ["speed", "volume"]) toolbar.querySelector(`.t-${k}`).classList.toggle("off", c.kind === "image");
    const tb = toolbar.querySelector(".t-transition");
    if (tb) {
      const i = S.project.clips.findIndex((x) => x.id === c.id);
      const hasNext = i >= 0 && i < S.project.clips.length - 1;
      tb.classList.toggle("off", !hasNext);
      tb.title = hasNext ? "Geçiş (sonraki klibe)" : "Son klipte geçiş yok";
    }
  }
  updateCut();
}

function updateCut() {
  const ok = Boolean(cutTarget());
  for (const b of toolbar.querySelectorAll(".t-split, .t-trimL, .t-trimR")) b.classList.toggle("off", !ok);
}

toolbar.addEventListener("click", (ev) => {
  const b = ev.target.closest("button[data-act]");
  if (b) act(b.dataset.act);
});

function hintCut() {
  toast(S.project.clips.length ? "Beyaz çizgiyi (imleç) kesilecek klibin üzerine getir" : "Önce medya ekle");
}

export function act(a) {
  if (!["media", "music", "image", "format", "transition", "close", "captions", "capAll"].includes(a)) player.pause();
  const c = selected();
  switch (a) {
    case "media": openMedia(); break;
    case "split": if (!split()) hintCut(); break;
    case "trimL": if (!trimStart()) hintCut(); break;
    case "trimR": if (!trimEnd()) hintCut(); break;
    case "text": addText(); textPanel(true); break;
    case "captions": captionsPanel(); break;
    case "image": openMedia("video,image", "overlay"); break;
    case "music": openMedia("audio"); break;
    case "format": formatPanel(); break;
    case "transition": transitionPanel(); break;
    case "close": closePanel(); select(null); break;
    case "speed": if (c?.kind === "video") speedPanel(); else toast("Resimde hız yok; süreyi kenarından ayarla"); break;
    case "volume": if (c?.kind === "video") volumePanel(); else toast("Resmin sesi yok"); break;
    case "fit": toggleFit(); break;
    case "dup": duplicateSelected(); break;
    case "del": closePanel(); removeSelected(); break;
    case "editText": textPanel(); break;
    case "capAll": capStylePanel(); break;
    case "editImage": imagePanel(); break;
    case "musicEdit": musicPanel(); break;
    default: break;
  }
}

// ---- ayar paneli (arac cubugunun yerine acilir, onizleme gorunur kalir) ----
let panelKey = null;
let panelClose = null;
const selKey = () => (S.sel ? `${S.sel.type}:${S.sel.id}` : "");

function openPanel(title, build, { onClose = null, keepOnSelect = false } = {}) {
  closePanel();
  panel.textContent = "";
  const head = el("div", "panel-head");
  head.append(el("span", "panel-title", title));
  const ok = el("button", "panel-ok");
  ok.innerHTML = icon("check");
  ok.title = "Tamam";
  ok.onclick = () => closePanel();
  head.append(ok);
  const body = el("div", "panel-body");
  panel.append(head, body);
  build(body);
  panel.hidden = false;
  toolbar.hidden = true;
  panelKey = keepOnSelect ? null : selKey();
  panelClose = onClose;
}

export function closePanel() {
  if (panel.hidden) return;
  panel.hidden = true;
  toolbar.hidden = false;
  panel.textContent = "";
  const f = panelClose;
  panelClose = null;
  panelKey = null;
  f?.();
  changed(); // canli degisiklikleri gecmise yaz (degisiklik yoksa bir sey yapmaz)
}

function slider({ label, min, max, step, value, fmt, onInput, onChange }) {
  const wrap = el("label", "field");
  const head = el("div", "field-head");
  const val = el("b", null, fmt(value));
  head.append(el("span", null, label), val);
  const r = el("input");
  r.type = "range";
  Object.assign(r, { min, max, step, value });
  r.oninput = () => {
    val.textContent = fmt(+r.value);
    onInput(+r.value);
  };
  r.onchange = () => (onChange ? onChange(+r.value) : changed());
  wrap.append(head, r);
  return { wrap, set(v) { r.value = v; val.textContent = fmt(v); } };
}

function chips(options, current, onPick) {
  const row = el("div", "chips");
  for (const [v, label] of options) {
    const b = el("button", `chip${v === current ? " on" : ""}`, label);
    b.onclick = () => {
      row.querySelectorAll(".chip").forEach((x) => x.classList.toggle("on", x === b));
      onPick(v);
    };
    row.append(b);
  }
  return row;
}

function toggleRow(label, on0, onToggle) {
  const wrap = el("label", "switch-row");
  const cb = el("input");
  cb.type = "checkbox";
  cb.checked = on0;
  cb.onchange = () => onToggle(cb.checked);
  wrap.append(el("span", null, label), cb, el("i", "switch"));
  return wrap;
}

const labeled = (label, node) => {
  const w = el("div", "field");
  w.append(el("div", "field-head", label), node);
  return w;
};
const pct = (v) => `%${Math.round(v * 100)}`;

function speedPanel() {
  const c = selected();
  const layer = S.sel?.type === "image"; // video katmani: sure kaynaktan okunan aralik / hiz
  const set = (v) => { if (layer) setLayerSpeed(c, v); else c.speed = round3(v); };
  openPanel("Hız", (body) => {
    const note = el("div", "panel-note");
    const upd = () => {
      note.textContent = layer
        ? `Katmanın yeni süresi: ${fmtDur(c.end - c.start)}`
        : `Klibin yeni süresi: ${fmtDur(entryOf(c.id)?.dur || 0)}`;
    };
    const s = slider({
      label: "Hız", min: 0.25, max: 4, step: 0.05, value: c.speed, fmt: (v) => `${v.toFixed(2)}×`,
      onInput: (v) => { set(v); changed(false); upd(); },
    });
    const presets = chips([[0.25, "0.25×"], [0.5, "0.5×"], [1, "1×"], [1.5, "1.5×"], [2, "2×"], [3, "3×"], [4, "4×"]], c.speed, (v) => {
      set(v);
      s.set(v);
      changed();
      upd();
    });
    body.append(presets, s.wrap, note);
    upd();
  });
}

function volumePanel() {
  const c = selected();
  openPanel("Klip sesi", (body) => {
    let mute;
    const s = slider({
      label: "Ses düzeyi", min: 0, max: 2, step: 0.05, value: c.volume, fmt: pct,
      onInput: (v) => {
        c.volume = v;
        if (v > 0 && c.mute) {
          c.mute = false;
          mute.querySelector("input").checked = false;
        }
        changed(false);
      },
    });
    mute = toggleRow("Sessize al", c.mute, (v) => { c.mute = v; changed(); });
    body.append(s.wrap, mute, el("div", "panel-note", "Önizleme en fazla %100 çalar; üstü render'da uygulanır."));
  });
}

// Gecis turleri: her secenek kucuk bir video onizleme ile gosterilir.
let transObserver = null;

function transitionPanel() {
  const c = selected();
  if (!c || S.sel?.type !== "clip") return;
  const i = S.project.clips.findIndex((x) => x.id === c.id);
  const next = S.project.clips[i + 1];
  if (!next) {
    toast("Son klipte geçiş yok; geçiş için sonraki klibe ihtiyaç var");
    return;
  }
  if (!c.trans) c.trans = { ...DEFAULT_TRANS };
  const tr = c.trans;
  openPanel("Geçiş", (body) => {
    const info = el("div", "panel-note");
    info.textContent = `"${c.name}" → "${next.name}" arasındaki geçiş`;
    const grid = el("div", "trans-grid");
    const vids = [];
    for (const [type, label] of TRANSITIONS) {
      const b = el("button", `trans${type === tr.type ? " on" : ""}`);
      const v = el("video");
      v.muted = true;
      v.loop = true;
      v.playsInline = true;
      v.setAttribute("playsinline", "");
      v.preload = "none";
      v.src = `${API}/api/transitions/${type}.mp4`;
      b.append(v, el("span", null, label));
      b.onclick = () => {
        grid.querySelectorAll(".trans").forEach((x) => x.classList.toggle("on", x === b));
        setTransition(type);
        v.currentTime = 0;
        v.play().catch(() => {});
      };
      vids.push(v);
      grid.append(b);
    }
    const dur = slider({
      label: "Geçiş süresi", min: 0.1, max: 2, step: 0.1, value: tr.duration,
      fmt: (v) => `${v.toFixed(1)} sn`,
      onInput: (v) => { tr.duration = round3(v); changed(false); },
    });
    body.append(info, grid, dur.wrap,
      el("div", "panel-note", "Bu geçiş yalnızca seçili klip ile sonraki klip arasında uygulanır. Önizlemeler gerçek geçişi gösterir."));
    // yalnizca gorunen onizlemeler oynasin
    transObserver?.disconnect();
    transObserver = new IntersectionObserver((ents) => {
      for (const en of ents) {
        const v = en.target;
        if (en.isIntersecting) v.play().catch(() => {});
        else v.pause();
      }
    }, { root: body, threshold: 0.4 });
    for (const v of vids) transObserver.observe(v);
  }, { onClose: () => { transObserver?.disconnect(); transObserver = null; } });
}

// Katmani (ana serinin ustundeki resim/video) kenar boslugu birakarak yerlestirir
const EDGE = 0.04;
function placeLayer(im, hx, vy) {
  const { width: W, height: H } = S.project.settings;
  const ar = player.layerAspect(im);
  const hw = im.size / 2;
  const hh = Math.min((im.size * W) / ar, H) / H / 2;
  const pick = (c, half) => (c === "l" || c === "t" ? EDGE + half : c === "r" || c === "b" ? 1 - EDGE - half : 0.5);
  im.x = round3(clamp(pick(hx, hw), 0, 1));
  im.y = round3(clamp(pick(vy, hh), 0, 1));
  changed();
}

function imagePanel() {
  const im = selected();
  if (!im || S.sel?.type !== "image") return;
  const video = im.kind === "video";
  openPanel(video ? "Video katmanı" : "Görsel katmanı", (body) => {
    const name = el("div", "music-name");
    name.innerHTML = icon(video ? "film" : "image");
    name.append(el("span", null, im.name));
    const op = slider({
      label: "Saydamlık", min: 0, max: 1, step: 0.05, value: im.opacity, fmt: pct,
      onInput: (v) => { im.opacity = v; changed(false); },
    });
    const size = slider({
      label: "Boyut", min: 0.05, max: 1, step: 0.01, value: im.size, fmt: (v) => `%${Math.round(v * 100)}`,
      onInput: (v) => { im.size = v; changed(false); },
    });
    const sizes = chips([[0.25, "Küçük"], [0.5, "Orta"], [0.75, "Büyük"], [1, "Tam genişlik"]], null, (v) => {
      im.size = v;
      size.set(v);
      changed();
    });
    const pos = chips([
      [["l", "t"], "↖ Sol üst"], [["c", "t"], "↑ Üst"], [["r", "t"], "↗ Sağ üst"], [["c", "c"], "● Orta"],
      [["l", "b"], "↙ Sol alt"], [["c", "b"], "↓ Alt"], [["r", "b"], "↘ Sağ alt"],
    ].map(([k, l]) => [k.join(""), l]), null, (v) => placeLayer(im, v[0], v[1]));
    const row = el("div", "panel-row");
    const rep = el("button", "btn ghost", "Değiştir");
    rep.onclick = () => openMedia("video,image", "overlay-replace");
    const del = el("button", "btn danger", "Kaldır");
    del.onclick = () => {
      closePanel();
      select("image", im.id);
      removeSelected();
    };
    row.append(rep, del);
    const parts = [name, op.wrap, size.wrap, labeled("Hazır boyut", sizes), labeled("Konum", pos)];
    if (S.project.images.length > 1) {
      const ord = el("div", "panel-row");
      const front = el("button", "btn ghost");
      front.innerHTML = `${icon("up")}<span>Öne al</span>`;
      front.onclick = () => { if (moveLayer(im.id, 1)) toast("Öne alındı"); else toast("Zaten en üstte"); };
      const back = el("button", "btn ghost");
      back.innerHTML = `${icon("down")}<span>Arkaya al</span>`;
      back.onclick = () => { if (moveLayer(im.id, -1)) toast("Arkaya alındı"); else toast("Zaten en altta"); };
      ord.append(front, back);
      parts.push(labeled("Üst üste sırası", ord));
    }
    parts.push(row, el("div", "panel-note", video
      ? "Önizlemede sürükleyerek taşıyabilirsin. Başlangıcı ve süresini timeline'daki çubuktan ayarla; hız ve ses için araç çubuğunu kullan."
      : "Önizlemede sürükleyerek taşıyabilirsin. Süresini timeline'daki çubuğun kenarlarından ayarla."));
    body.append(...parts);
  });
}

function toggleFit() {
  const c = selected();
  if (!c) return;
  c.fit = c.fit === "cover" ? "contain" : "cover";
  changed();
  toast(c.fit === "cover" ? "Doldur: kare dolar, kenarlar kırpılır" : "Sığdır: görüntünün tamamı görünür");
}

const COLORS = ["#ffffff", "#000000", "#ffd400", "#ff9500", "#ff3b30", "#ff2d92", "#2f80ff", "#34c759"];
const STYLES = [["box", "Kutu"], ["shadow", "Gölge"], ["outline", "Çerçeve"], ["plain", "Düz"]];

// Yazi tipi secici: her secenek kendi yazi tipiyle gosterilir
function fontPicker(obj, onPick) {
  const row = el("div", "fonts");
  for (const f of fontList()) {
    const b = el("button", `font${f.id === obj.font ? " on" : ""}`, f.label);
    b.type = "button";
    b.style.fontFamily = `"${familyOf(f.id)}", "DejaVu Sans", sans-serif`;
    b.style.fontWeight = String(f.weight);
    ensureFont(f.id);
    b.onclick = () => {
      row.querySelectorAll(".font").forEach((x) => x.classList.toggle("on", x === b));
      obj.font = f.id;
      rememberTextFont(f.id);
      onPick();
    };
    row.append(b);
  }
  return row;
}

function textPanel(focus = false) {
  const t = selected();
  if (!t || S.sel?.type !== "text") return;
  openPanel("Metin", (body) => {
    const ta = el("textarea", "text-input");
    ta.rows = 2;
    ta.maxLength = 500;
    ta.placeholder = "Metin yaz…";
    ta.value = t.text;
    ta.oninput = () => { t.text = ta.value; changed(false); };
    ta.onchange = () => changed();
    const sw = swatches(t.color, (col) => { t.color = col; changed(); });
    const H = S.project.settings.height;
    const size = slider({
      label: "Boyut", min: 0.02, max: 0.15, step: 0.005, value: t.size, fmt: (v) => `${Math.round(v * H)} px`,
      onInput: (v) => { t.size = v; changed(false); },
    });
    const pos = chips([[0.15, "Üst"], [0.5, "Orta"], [0.8, "Alt"]], null, (v) => {
      t.x = 0.5;
      t.y = v;
      changed();
    });
    const parts = [
      ta, labeled("Yazı tipi", fontPicker(t, () => changed())),
      labeled("Stil", chips(STYLES, t.style, (v) => { t.style = v; changed(); })),
      labeled("Renk", sw), size.wrap, labeled("Konum", pos),
    ];
    if (t.cap) {
      const all = el("button", "btn ghost", "Tüm altyazıları birlikte düzenle");
      all.onclick = () => capStylePanel();
      parts.push(all);
    }
    parts.push(el("div", "panel-note", "Önizlemede sürükleyerek taşıyabilirsin. Süresini timeline'daki çubuğun kenarlarından ayarla."));
    body.append(...parts);
    if (focus) setTimeout(() => { ta.focus(); ta.select(); }, 60);
  });
}

function swatches(current, onPick, colors = COLORS) {
  const sw = el("div", "swatches");
  for (const col of colors) {
    const b = el("button", `swatch${col === current ? " on" : ""}`);
    b.style.background = col;
    b.title = col;
    b.onclick = () => {
      sw.querySelectorAll(".swatch").forEach((x) => x.classList.toggle("on", x === b));
      onPick(col);
    };
    sw.append(b);
  }
  return sw;
}

// ---- otomatik altyazi ----
const CAP_LANGS = [
  ["auto", "Otomatik"], ["tr", "Türkçe"], ["en", "English"], ["de", "Deutsch"], ["es", "Español"],
  ["fr", "Français"], ["ru", "Русский"], ["ar", "العربية"],
];
const capOpts = { lang: "auto", quality: "accurate", size: "normal" };
let capStyle = null; // { font, color, size, y, style }
let capRun = null; // { job, pid, ui }: panel kapansa da is surer, bitince altyazilar eklenir

// Calisan is tarayicida saklanir: sayfa kapanip acilsa da sonuc ayni projeye eklenir.
const CAPJOB_KEY = "engrare.capjob";
const CAPJOB_TTL = 24 * 3600 * 1000;
const readCapJob = () => {
  try {
    const r = JSON.parse(localStorage.getItem(CAPJOB_KEY) || "null");
    return r && Date.now() - r.at < CAPJOB_TTL ? r : null;
  } catch (e) { return null; }
};
const saveCapJob = (r) => (r ? localStorage.setItem(CAPJOB_KEY, JSON.stringify(r)) : localStorage.removeItem(CAPJOB_KEY));

function captionsPanel() {
  if (!S.project.clips.length) {
    toast("Önce medya ekle");
    return;
  }
  if (!capStyle) capStyle = { font: lastTextFont(), color: "#ffffff", size: 0.055, y: 0.72, style: "outline", kara: true };
  const have = S.project.texts.filter((t) => t.cap).length;
  openPanel("Otomatik altyazı", (body) => {
    const bar = el("div", "job-bar");
    const fill = el("i");
    bar.append(fill);
    const msg = el("span");
    const cancel = el("button", "btn danger sm", "İptal");
    const status = el("div", "job");
    const jrow = el("div", "job-row");
    jrow.append(msg, cancel);
    status.append(bar, jrow);
    status.hidden = true;
    const go = el("button", "btn primary", have ? "Altyazıları yeniden oluştur" : "Altyazı oluştur");

    const show = (j) => {
      const busy = ["queued", "running"].includes(j.status);
      status.hidden = false;
      fill.style.width = `${Math.round(j.progress || 0)}%`;
      const m = { queued: "Sırada…", running: `${j.message || "çalışıyor"} · %${Math.round(j.progress || 0)}` };
      msg.textContent = m[j.status] || j.message;
      cancel.hidden = !busy;
      go.disabled = busy;
    };
    if (capRun) {
      capRun.ui = { show };
      show({ status: "running", progress: 0, message: "devam ediyor" });
    }
    cancel.onclick = () => { if (capRun) api(`/api/captions/${capRun.job}`, { method: "DELETE" }).catch(() => {}); };
    go.onclick = () => runCaptions({ show }, go);

    body.append(
      labeled("Konuşma dili", chips(CAP_LANGS, capOpts.lang, (v) => { capOpts.lang = v; })),
      labeled("Doğruluk", chips([["fast", "Hızlı"], ["accurate", "Doğru"], ["best", "En doğru (yavaş)"]], capOpts.quality, (v) => { capOpts.quality = v; })),
      labeled("Altyazı uzunluğu", chips([["short", "Kısa"], ["normal", "Normal"], ["long", "Uzun"]], capOpts.size, (v) => { capOpts.size = v; })),
      labeled("Yazı tipi", fontPicker(capStyle, () => {})),
      labeled("Stil", chips(STYLES, capStyle.style, (v) => { capStyle.style = v; })),
      labeled("Renk", swatches(capStyle.color, (col) => { capStyle.color = col; })),
      labeled("Kelime vurgusu", chips([[1, "Açık: söylenmemiş gri, söylenince renkli"], [0, "Kapalı"]], capStyle.kara ? 1 : 0, (v) => { capStyle.kara = Boolean(v); })),
      go, status,
    );
    if (have) {
      const all = el("button", "btn ghost", `Mevcut ${have} altyazıyı birlikte düzenle`);
      all.onclick = () => capStylePanel();
      body.append(all);
    }
    body.append(el("div", "panel-note", have
      ? "Yeniden oluşturunca mevcut altyazılar silinip yenileri eklenir (geri alınabilir). Ses, videodaki konuşmadan çıkarılır; müzik dahil edilmez."
      : "Ses, videodaki konuşmadan çıkarılır; müzik dahil edilmez. Süre videonun uzunluğuna bağlıdır; ilk kullanımda model indirilir. Sayfayı kapatsan da iş sürer; geri döndüğünde altyazılar eklenir."));
  }, { keepOnSelect: true, onClose: () => { if (capRun) capRun.ui = null; } });
}

// Tum otomatik altyazilarin bicimi: her degisiklik hepsine uygulanir
function capStylePanel() {
  const caps = () => S.project.texts.filter((t) => t.cap);
  const ref = caps()[0];
  if (!ref) {
    toast("Henüz altyazı yok");
    return;
  }
  openPanel(`Tüm altyazılar (${caps().length})`, (body) => {
    const H = S.project.settings.height;
    const cur = { font: ref.font, color: ref.color, size: ref.size, style: ref.style, x: ref.x ?? 0.5, y: ref.y };
    const apply = (patch, commit = true) => styleCaptions(patch, commit);
    const size = slider({
      label: "Boyut", min: 0.02, max: 0.15, step: 0.005, value: cur.size, fmt: (v) => `${Math.round(v * H)} px`,
      onInput: (v) => apply({ size: v }, false),
    });
    const pos = chips([[0.15, "Üst"], [0.5, "Orta"], [0.72, "Alt"], [0.85, "En alt"]], cur.y, (v) => { apply({ x: 0.5, y: v }); xpos.set(0.5); ypos.set(v); });
    const ypos = slider({
      label: "Dikey konum", min: 0.05, max: 0.95, step: 0.01, value: cur.y, fmt: (v) => `%${Math.round(v * 100)}`,
      onInput: (v) => apply({ y: v }, false),
    });
    const xpos = slider({
      label: "Yatay konum", min: 0.05, max: 0.95, step: 0.01, value: cur.x, fmt: (v) => `%${Math.round(v * 100)}`,
      onInput: (v) => apply({ x: v }, false),
    });
    const del = el("button", "btn danger", "Tüm altyazıları sil");
    del.onclick = async () => {
      if (!(await confirmBox({ title: "Tüm altyazılar silinsin mi?", text: `${caps().length} altyazı kaldırılacak. Geri alabilirsin.`, ok: "Sil", danger: true }))) return;
      closePanel();
      removeCaptions();
      toast("Altyazılar silindi (geri alınabilir)");
    };
    body.append(
      labeled("Yazı tipi", fontPicker(cur, () => apply({ font: cur.font }))),
      labeled("Stil", chips(STYLES, cur.style, (v) => apply({ style: v }))),
      labeled("Renk", swatches(cur.color, (col) => apply({ color: col }))),
      labeled("Kelime vurgusu", chips([[1, "Açık"], [0, "Kapalı"]], ref.kara && ref.words ? 1 : 0, (v) => apply({ kara: Boolean(v) }))),
      labeled("Söylenmemiş kelime rengi", swatches(ref.dim || "#9a9a9a", (col) => apply({ dim: col }), ["#9a9a9a", "#6b6b6b", "#c8c8c8", "#ffffff"])),
      size.wrap, labeled("Konum", pos), ypos.wrap, xpos.wrap, del,
      el("div", "panel-note", "Buradaki her değişiklik tüm altyazılara uygulanır; önizlemede bir altyazıyı sürüklersen hepsi birlikte taşınır. Tek bir altyazıyı değiştirmek için onu seçip Düzenle'ye bas."),
    );
  }, { keepOnSelect: true });
}

async function runCaptions(ui, btn) {
  if (capRun?.job) return;
  btn.disabled = true;
  try {
    await flush();
    if (!S.project.id) throw new Error("proje kaydedilemedi");
    const { job } = await api(`/api/projects/${S.project.id}/captions`, { method: "POST", body: { ...capOpts } });
    const rec = { job, pid: S.project.id, style: { ...capStyle }, at: Date.now() };
    saveCapJob(rec);
    capRun = { job, pid: rec.pid, ui };
    await watchCaptions(rec);
  } catch (e) {
    toast(`Altyazı hatası: ${e.message}`, 4000);
  } finally {
    btn.disabled = false;
  }
}

// Isi bitene kadar sorgular. Proje degisirse takibi birakir (kayit durur, proje yeniden acilinca surer).
async function watchCaptions(rec) {
  capRun = capRun?.job === rec.job ? capRun : { job: rec.job, pid: rec.pid, ui: capRun?.ui || null };
  let fails = 0;
  try {
    for (;;) {
      if (S.project.id !== rec.pid) return;
      let j;
      try {
        j = await api(`/api/captions/${rec.job}`);
        fails = 0;
      } catch (e) {
        if (e instanceof HttpError && e.status === 404) {
          saveCapJob(null);
          toast("Altyazı işi bulunamadı (sunucu yeniden başlamış olabilir), yeniden başlat", 5000);
          capRun?.ui?.show({ status: "error", message: "iş bulunamadı" });
          return;
        }
        if (++fails > 20) return; // ag yok: kayit durur, sonra yeniden denenir
        await sleep(3000);
        continue;
      }
      capRun?.ui?.show(j);
      if (j.status === "queued" || j.status === "running") {
        await sleep(1000);
        continue;
      }
      saveCapJob(null);
      if (j.status === "done") {
        if (!j.captions.length) toast("Konuşma bulunamadı", 3500);
        else {
          applyCaptions(j.captions, rec.style);
          toast(`${j.captions.length} altyazı eklendi`, 3000);
        }
      } else if (j.status === "error") {
        toast(`Altyazı oluşturulamadı: ${j.error}`, 5000);
      }
      return;
    }
  } finally {
    if (capRun?.job === rec.job) capRun = null;
  }
}

// Proje acilinca: bu projeye ait bekleyen altyazi isi varsa takibi surdur
function resumeCaptions() {
  const rec = readCapJob();
  if (!rec) {
    saveCapJob(null);
    return;
  }
  if (rec.pid !== S.project.id || capRun) return;
  toast("Altyazı oluşturma sürüyor, bitince eklenecek", 3500);
  watchCaptions(rec);
}
on("load", resumeCaptions);

function musicPanel() {
  const a = S.project.audio;
  if (!a) {
    openMedia("audio");
    return;
  }
  if (!a.srcDur) { // eski projeler: sureyi ogren, slider dogru sinirla acilsin
    M.probe(a.path).then((i) => {
      if (i?.duration) {
        a.srcDur = i.duration;
        scheduleSave();
        musicPanel();
      }
    });
  }
  openPanel("Müzik", (body) => {
    const name = el("div", "music-name");
    name.innerHTML = icon("music");
    name.append(el("span", null, a.name));
    const vol = slider({ label: "Ses düzeyi", min: 0, max: 2, step: 0.05, value: a.volume, fmt: pct, onInput: (v) => { a.volume = v; changed(false); } });
    const maxOff = Math.max(0, Math.floor((a.srcDur || 0) - 1));
    const off = slider({ label: "Şarkının başlangıç noktası", min: 0, max: maxOff, step: 0.1, value: Math.min(a.offset, maxOff), fmt: (v) => fmtTime(v, 1), onInput: (v) => { a.offset = round3(v); changed(false); } });
    off.wrap.hidden = !maxOff;
    const loop = toggleRow("Video bitene kadar tekrarla", a.loop, (v) => { a.loop = v; changed(); });
    const fo = slider({ label: "Sonda azalarak bitir", min: 0, max: 5, step: 0.5, value: a.fadeOut, fmt: (v) => (v ? `${v} sn` : "Yok"), onInput: (v) => { a.fadeOut = v; changed(false); } });
    const row = el("div", "panel-row");
    const rep = el("button", "btn ghost", "Değiştir");
    rep.onclick = () => openMedia("audio");
    const del = el("button", "btn danger", "Kaldır");
    del.onclick = () => {
      closePanel();
      select("audio");
      removeSelected();
    };
    row.append(rep, del);
    body.append(name, vol.wrap, off.wrap, loop, fo.wrap, row);
  }, { keepOnSelect: true });
}

// Format secim izgarasi (Format paneli ve yeni proje penceresi ortak kullanir)
function formatGrid(w, h, onPick) {
  const grid = el("div", "formats");
  for (const f of FORMATS) {
    const b = el("button", `fmt${f.w === w && f.h === h ? " on" : ""}`);
    b.type = "button";
    const shape = el("i", "fmt-shape");
    shape.style.aspectRatio = `${f.w} / ${f.h}`;
    b.append(shape, el("b", null, f.label), el("small", null, f.hint));
    b.onclick = () => {
      grid.querySelectorAll(".fmt").forEach((x) => x.classList.toggle("on", x === b));
      onPick(f);
    };
    grid.append(b);
  }
  return grid;
}

function formatPanel() {
  const s = S.project.settings;
  openPanel("Format", (body) => {
    const grid = formatGrid(s.width, s.height, (f) => setFormat(f.w, f.h));
    const fit = chips([["contain", "Sığdır (tamamı görünür)"], ["cover", "Doldur (kenarları kırp)"]], null, (v) => {
      if (!S.project.clips.length) return;
      S.project.clips.forEach((c) => { c.fit = v; });
      changed();
      toast("Tüm kliplere uygulandı");
    });
    body.append(grid, labeled("Tüm klipler", fit));
  }, { keepOnSelect: true });
}

// ---- cekmeceler ----
export function openSheet(id) {
  player.pause();
  closePanel();
  $$(".sheet").forEach((s) => { s.hidden = s.id !== id; });
  $("#scrim").hidden = false;
}
// AI Stüdyo'dan Drive dosya seçmeye gidilince, medya çekmecesi kapanınca Stüdyo geri açılır
let mediaReturn = null;
export function closeSheet() {
  const back = !$("#sheetMedia").hidden ? mediaReturn : null;
  mediaReturn = null;
  $$(".sheet").forEach((s) => { s.hidden = true; });
  $("#scrim").hidden = true;
  if (back) openSheet(back);
}
$("#scrim").onclick = closeSheet;
$$("[data-close]").forEach((b) => { b.onclick = closeSheet; });

// -- medya (Drive iframe; dosyaya dokunmak ekler, cekmece acik kalir) --
let driveType = "";
let mediaIntent = "clip";
function openMedia(type = "video,image", intent = "clip") {
  mediaIntent = intent;
  mediaReturn = intent === "studio" || intent === "brand" ? "sheetStudio" : null;
  if (driveType !== type) {
    $("#drive").src = `${API}/drive?type=${type}&mode=select`;
    driveType = type;
  }
  const audio = type === "audio";
  const overlay = intent.startsWith("overlay");
  const studio = intent === "studio" || intent === "brand";
  $("#mediaTitle").textContent = intent === "brand" ? "Marka görseli seç" : studio ? "AI için dosya seç" : audio ? "Müzik seç" : overlay ? "Katman seç" : "Medya ekle";
  $("#mediaHint").textContent = intent === "brand"
    ? "Bir görsele dokun: marka kitine eklenir."
    : studio
    ? "Dosyalara dokun: AI isteğine eklenir. Birden fazla seçebilirsin."
    : audio
      ? "Bir ses dosyasına dokun."
      : overlay
        ? "Bir video ya da görsele dokun: imlecin olduğu yere ana videonun üstüne katman olarak eklenir."
        : "Dosyaya dokun: imlecin olduğu yere eklenir. Arka arkaya birden fazla ekleyebilirsin.";
  openSheet("sheetMedia");
}
export { openMedia };

const apiOrigin = new URL(API, location.href).origin;
window.addEventListener("message", async (e) => {
  const d = e.data;
  if (!d || d.type !== "drive:select" || e.origin !== apiOrigin || !d.file) return;
  const f = d.file;
  if (mediaIntent === "brand") { // Marka kiti gorseli (brand.js)
    window.dispatchEvent(new CustomEvent("brand:pick", { detail: f }));
    return;
  }
  if (mediaIntent === "studio") { // AI Studyo isteğine eklenir (studio.js)
    window.dispatchEvent(new CustomEvent("studio:pick", { detail: f }));
    return;
  }
  if (f.type === "audio") {
    const info = await M.probe(f.path);
    setAudio(f, info?.duration || 0);
    closeSheet();
    toast(`Müzik eklendi: ${f.name}`);
    return;
  }
  if ((f.type === "image" || f.type === "video") && mediaIntent.startsWith("overlay")) {
    let info = null;
    if (f.type === "video") {
      info = await M.probe(f.path);
      if (!info?.has_video || !info.duration) {
        toast("Video okunamadı");
        return;
      }
      M.videoUrl(f.path); // onizleme kopyasi hemen hazirlanmaya baslasin
    }
    if (mediaIntent === "overlay-replace") {
      const im = selected();
      if (im && S.sel?.type === "image") {
        replaceLayerMedia(im, f, info);
        closeSheet();
        toast(`Katman değiştirildi: ${f.name}`);
        return;
      }
    }
    addImage(f, info);
    closeSheet();
    toast(`Katman eklendi: ${f.name}`);
    return;
  }
  if (f.type !== "video" && f.type !== "image") return;
  const clip = {
    id: uid(), path: f.path, src: f.abs || "", name: f.name, kind: f.type, in: 0, out: 3, srcDur: 0,
    speed: 1, volume: 1, mute: f.type === "image", fadeIn: 0, fadeOut: 0, fit: "contain",
  };
  if (f.type === "video") {
    const info = await M.probe(f.path);
    if (!info?.has_video || !info.duration) {
      toast("Video okunamadı");
      return;
    }
    clip.srcDur = info.duration;
    clip.out = info.duration;
    M.videoUrl(f.path); // proxy uretimi hemen baslasin
  }
  insertClip(clip);
  toast(`Eklendi: ${f.name}`);
});
$("#mediaDone").onclick = closeSheet;
$("#emptyAdd").onclick = (ev) => {
  ev.stopPropagation();
  openMedia();
};

// -- projeler --
// Proje onizlemeleri: uygulama acilirken onceden istenir, liste acilinca onbellekten gelir
const projThumbs = new Map(); // yol -> Image (referans tutulur, tarayici onbellegi bosaltmasin)
function preloadProjThumbs(list) {
  for (const p of list) {
    if (!p.thumb || projThumbs.has(p.thumb)) continue;
    const im = new Image();
    im.decoding = "async";
    im.src = url.thumb(p.thumb);
    projThumbs.set(p.thumb, im);
  }
}
export async function warmProjects() {
  try {
    preloadProjThumbs(await api("/api/projects"));
  } catch (e) { /* oturum yoksa sessizce gec */ }
}

export async function openProjects() {
  openSheet("sheetProjects");
  const box = $("#projects");
  box.textContent = "";
  box.append(el("div", "muted", "Yükleniyor…"));
  let list = [];
  try {
    list = await api("/api/projects");
  } catch (e) {
    box.textContent = e.message;
    return;
  }
  box.textContent = "";
  preloadProjThumbs(list);
  if (!list.length) box.append(el("div", "muted", "Henüz proje yok."));
  for (const p of list) {
    const item = el("div", `proj${p.id === S.project.id ? " on" : ""}`);
    const th = el("div", "proj-thumb");
    th.innerHTML = icon("film");
    if (p.thumb) {
      const im = el("img");
      im.alt = "";
      im.decoding = "async";
      im.setAttribute("fetchpriority", "high");
      im.src = url.thumb(p.thumb);
      th.replaceChildren(im); // dogrudan DOM'da: istek hemen baslar
      im.onerror = () => { th.innerHTML = icon("film"); };
    }
    const meta = el("div", "proj-meta");
    meta.append(el("b", null, p.name || "Adsız"), el("small", null, `${p.clips} klip · ${fmtAgo(p.updated)}`));
    const del = el("button", "icon-btn sm danger");
    del.innerHTML = icon("trash");
    del.title = "Projeyi sil";
    del.onclick = async (ev) => {
      ev.stopPropagation();
      if (!(await confirmBox({ title: "Proje silinsin mi?", text: `"${p.name || "Adsız"}" kalıcı olarak silinir. Drive'daki dosyalar silinmez.`, ok: "Sil", danger: true, hold: 2000 }))) return;
      await api(`/api/projects/${p.id}`, { method: "DELETE" });
      if (p.id === S.project.id) {
        discardPending();
        forgetLastProject();
        await newProject();
      }
      openProjects();
    };
    item.onclick = async () => {
      closeSheet();
      try {
        await openProject(p.id);
      } catch (e) {
        toast(`Açılamadı: ${e.message}`);
      }
    };
    item.append(th, meta, del);
    box.append(item);
  }
}
// -- yeni proje: ad ve format sorulur --
const FMT_KEY = "engrare:lastFormat";
let npFormat = FORMATS[0];

export function openNewProject() {
  let last = null;
  try { last = JSON.parse(localStorage.getItem(FMT_KEY) || "null"); } catch (e) { /* bozuk kayit */ }
  npFormat = FORMATS.find((f) => last && f.w === last.w && f.h === last.h) || FORMATS[0];
  $("#npName").value = "";
  $("#npName").placeholder = "Yeni proje";
  $("#npFormats").replaceChildren(formatGrid(npFormat.w, npFormat.h, (f) => { npFormat = f; }));
  openSheet("sheetNew");
  setTimeout(() => $("#npName").focus(), 120);
}

$("#newForm").onsubmit = async (ev) => {
  ev.preventDefault();
  const name = $("#npName").value.trim() || "Yeni proje";
  localStorage.setItem(FMT_KEY, JSON.stringify({ w: npFormat.w, h: npFormat.h }));
  closeSheet();
  await newProject({ name, width: npFormat.w, height: npFormat.h });
  toast(`${name} · ${npFormat.label}`);
};
$("#npOpen").onclick = () => openProjects();
$("#newproj").onclick = () => openNewProject();
$("#logout").onclick = async () => {
  await flush();
  await api("/api/auth/logout", { method: "POST" }).catch(() => {});
  location.reload();
};

// -- disa aktarma --
let watching = null;

function exportChips() {
  const s = S.project.settings;
  const set = (k, v) => {
    s[k] = v;
    changed();
  };
  $("#exFps").replaceChildren(chips([[24, "24"], [25, "25"], [30, "30"], [60, "60"]], s.fps, (v) => set("fps", v)));
  $("#exCodec").replaceChildren(chips([["hevc", "H.265 (GPU)"], ["h264", "H.264 (GPU)"]], s.codec, (v) => {
    set("codec", v);
    updateExportSize();
  }));
  updateExportSize();
}

function updateExportSize() {
  const s = S.project.settings;
  $("#exSize").textContent = `${s.width}×${s.height} · ${fmtTime(total(), 1)}`;
}

export function openExport() {
  exportChips();
  openSheet("sheetExport");
  loadHistory();
}

async function startRender(draft) {
  if (!S.project.clips.length) {
    toast("Önce medya ekle");
    return;
  }
  if (watching) {
    toast("Bir render zaten sürüyor");
    return;
  }
  $("#btnRender").disabled = $("#btnDraft").disabled = true;
  try {
    await flush();
    if (!S.project.id) throw new Error("proje kaydedilemedi");
    const r = await api(`/api/projects/${S.project.id}/render?draft=${draft}`, { method: "POST" });
    watchJob(r.job);
  } catch (e) {
    toast(`Render başlatılamadı: ${e.message}`, 4000);
  } finally {
    $("#btnRender").disabled = $("#btnDraft").disabled = false;
  }
}
$("#btnRender").onclick = () => startRender(false);
$("#btnDraft").onclick = () => startRender(true);
$("#btnCancel").onclick = async () => {
  if (!watching) return;
  await api(`/api/jobs/${watching.jid}/cancel`, { method: "POST" }).catch(() => {});
};

function stopWatch() {
  if (!watching) return;
  clearInterval(watching.timer);
  try { watching.ws?.close(); } catch (e) { /* kapali */ }
  watching = null;
}

function watchJob(jid) {
  stopWatch();
  const w = { jid, ws: null, timer: 0, done: false };
  watching = w;
  showJob({ status: "queued", progress: 0, message: "" });
  const onJob = (j) => {
    if (watching !== w || !j.status) return;
    showJob(j);
    if (["done", "error", "cancelled"].includes(j.status)) {
      w.done = true;
      stopWatch();
      finished(j);
    }
  };
  const poll = () => {
    if (w.timer || w.done) return;
    w.timer = setInterval(async () => {
      try { onJob(await api(`/api/jobs/${jid}`)); } catch (e) { /* tekrar denenir */ }
    }, 1000);
  };
  try {
    w.ws = new WebSocket(`${API.replace(/^http/, "ws")}/ws/jobs/${jid}`);
    w.ws.onmessage = (ev) => onJob(JSON.parse(ev.data));
    w.ws.onerror = poll;
    w.ws.onclose = () => { if (!w.done && watching === w) poll(); };
  } catch (e) {
    poll();
  }
}

function showJob(j) {
  const run = j.status === "queued" || j.status === "running";
  const p = Math.round(j.progress || 0);
  $("#exJob").hidden = false;
  $("#exBar").style.width = `${run ? p : 100}%`;
  $("#exJob").dataset.status = j.status;
  let m = "Sırada…";
  const msg = j.message || "";
  if (j.status === "running") {
    if (/kontrol/.test(msg)) m = "Kontrol ediliyor…";
    else if (/tekrar \(CPU\)/.test(msg)) m = `GPU sorunu, CPU ile oluşturuluyor · %${p}`;
    else if (/tekrar \(GPU\)/.test(msg)) m = `Bozuk kare bulundu, tekrar deneniyor · %${p}`;
    else m = `İşleniyor · %${p}`;
  } else if (j.status === "done") m = "Tamamlandı";
  else if (j.status === "cancelled") m = "İptal edildi";
  else if (j.status === "error") m = `Hata: ${(j.error || "").split("\n")[0].slice(0, 160)}`;
  $("#exMsg").textContent = m;
  $("#btnCancel").hidden = !run;
  const ex = $("#btnExport");
  ex.classList.toggle("busy", run);
  ex.textContent = run ? `%${p}` : "Dışa Aktar";
}

function finished(j) {
  if (j.status === "done") {
    showResult(j);
    loadHistory();
    toast("Video hazır 🎉", 3000);
  } else if (j.status === "error") {
    toast("Render başarısız", 3000);
  }
}

function showResult(j) {
  const u = url.render(j.file);
  $("#exResult").hidden = false;
  $("#exTitle").textContent = `${j.name}${j.draft ? " · önizleme" : ""} · ${fmtDur(j.duration || 0)}`;
  const v = $("#exVideo");
  if (v.dataset.file !== j.file) {
    v.dataset.file = j.file;
    v.src = u;
  }
  const a = $("#exDownload");
  a.href = u;
  a.download = j.file;
  igReady(u, j.file);
}

async function loadHistory() {
  const box = $("#exHistory");
  let list;
  try {
    list = await api("/api/jobs");
  } catch (e) {
    return;
  }
  const running = list.find((j) => (j.status === "running" || j.status === "queued") && j.project_id === S.project.id);
  if (running && !watching) watchJob(running.id);
  box.textContent = "";
  const done = list.filter((j) => j.status === "done" && j.exists).slice(0, 30);
  if (!done.length) box.append(el("div", "muted", "Henüz render yok."));
  for (const j of done) {
    const row = el("div", `hist${j.project_id && j.project_id === S.project.id ? " mine" : ""}`);
    const meta = el("div", "hist-meta");
    const name = el("b", null, `${j.name}${j.draft ? " · önizleme" : ""}`);
    if (j.ig) {
      const dot = el("i", `ig-dot ${j.ig}`);
      dot.title = j.ig === "done" ? "Instagram'a yüklendi" : "Instagram'a yüklenecek";
      name.prepend(dot);
    }
    meta.append(
      name,
      el("small", null, `${fmtAgo(j.finished || j.created)} · ${fmtDur(j.duration || 0)}`),
    );
    meta.onclick = () => showResult(j);
    const th = el("img", "hist-thumb");
    th.loading = "lazy";
    th.alt = "";
    th.src = url.renderThumb(j.file);
    th.onerror = () => { th.removeAttribute("src"); th.classList.add("empty"); };
    th.onclick = () => showResult(j);
    const play = el("button", "icon-btn sm");
    play.innerHTML = icon("play");
    play.title = "Önizle";
    play.onclick = () => showResult(j);
    const dl = el("a", "icon-btn sm");
    dl.href = url.render(j.file);
    dl.download = j.file;
    dl.title = "İndir";
    dl.innerHTML = icon("download");
    const del = el("button", "icon-btn sm danger");
    del.innerHTML = icon("trash");
    del.title = "Sil";
    del.onclick = async () => {
      if (!(await confirmBox({ title: "Video silinsin mi?", text: "Bu render dosyası kalıcı olarak silinir.", ok: "Sil", danger: true }))) return;
      await api(`/api/jobs/${j.id}`, { method: "DELETE" }).catch((e) => toast(e.message));
      if ($("#exVideo").dataset.file === j.file) {
        $("#exResult").hidden = true;
        $("#exVideo").removeAttribute("src");
        $("#exVideo").dataset.file = "";
      }
      loadHistory();
    };
    row.append(th, meta, play, dl, del);
    box.append(row);
  }
}

// -- Instagram'a gonder --
// Hesap baglantisi AI Studyo > Marka'da (brand.js); burada marka secilir, video o markanin hesabina Reels olarak gider.
// Hic baglanti yoksa telefonda paylasim menusu acilir.
let igRender = null; // { url, name, file }
const brandMod = () => import("./brand.js"); // dongusel import olmasin diye gec yukleme
// Hemen gonderilenlerin durumu render adina gore tutulur: baska ogeye gecince onun bilgisi gorunur, eskisi sizmaz
const igDirect = new Map(); // render adi -> { text, link, busy }
function showDirect() {
  const d = igDirect.get(igRender?.name) || {};
  const st = $("#igStatus");
  st.textContent = d.text || "";
  if (d.link) {
    const a = el("a", "", "Instagram'da aç");
    a.href = d.link;
    a.target = "_blank";
    a.rel = "noopener";
    st.append(a);
  }
  syncIgBtn();
}
// Gonder dugmesi: bu oge zamanlanmis ya da yukleniyorsa gizli, degilse gorunur
let igActive = false; // bu render icin zamanlanmis/surmekte olan kayit var mi
function syncIgBtn() {
  const btn = $("#btnIg");
  btn.hidden = igActive;
  btn.disabled = !!igDirect.get(igRender?.name)?.busy;
}

async function igReady(u, name) {
  const r = { url: u, name, file: igRender?.name === name ? igRender.file : null };
  if (igRender?.name !== name) { // baska oge: oncekinin bilgisi/dugme durumu gorunmesin
    igActive = false;
    $("#igSched").textContent = "";
    $("#igSched").hidden = true;
  }
  igRender = r;
  $("#igBox").hidden = false;
  showDirect();
  const B = await brandMod();
  B.renderExportBox();
  await B.refreshIg();
  if (igRender !== r) return;
  loadScheduled();
  // Paylasim menusu dokunusta aninda acilabilsin diye dosyayi onceden hazirla (telefon)
  if (!B.exportTarget().connected && navigator.canShare) {
    try {
      const blob = await (await fetch(u, { credentials: "include" })).blob();
      const file = new File([blob], `engrare-${name}`, { type: "video/mp4" });
      if (igRender === r && navigator.canShare({ files: [file] })) r.file = file;
    } catch (e) { /* paylasim menusu olmadan devam */ }
  }
}

// Hedef hazir mi (hesap bagli mi)? Degilse neden kullaniciya soylenir; hazirsa hedef doner
async function igLinkedTarget() {
  const t = (await brandMod()).exportTarget();
  if (t.linked) return t;
  toast(t.connected ? `${t.name} Instagram hesabı henüz bağlı değil` : "Önce Instagram'ı bağla (AI Stüdyo › Marka)", 4000);
  if (!t.connected) window.dispatchEvent(new CustomEvent("studio:open", { detail: { tab: "brand" } }));
  return null;
}

async function publishNow(t, caption, name) {
  const d = { text: "Gönderiliyor...", link: "", busy: true };
  igDirect.set(name, d);
  showDirect();
  const upd = () => { if (igRender?.name === name) showDirect(); }; // baska ogeye gecildiyse ekrana yazma
  try {
    const { id } = await api("/api/instagram/publish", { method: "POST", body: { render: name, caption, brand: t.id } });
    for (;;) {
      await new Promise((r) => { setTimeout(r, 3000); });
      const p = await api(`/api/instagram/publish/${id}`);
      if (p.status === "done") {
        Object.assign(d, { text: `Yayınlandı (@${p.username || t.username}) `, link: p.permalink || "", busy: false });
        upd();
        toast("Instagram'da yayınlandı 🎉");
        break;
      }
      if (p.status === "error") throw new Error(p.message);
      d.text = `${p.message}...`;
      upd();
    }
  } catch (e) {
    Object.assign(d, { text: `Hata: ${e.message}`, link: "", busy: false });
    upd();
  }
}

// Tek dugme: zaman (hemen / zamanla) + video ayarlari (aciklama, etiketler; "AI hazirlasin" isaretliyse AI projeye bakarak
// yazar: "Simdi hazirla" ile hemen, basilmazsa onaylayinca). Zamanlananlar sunucuda bekler ve vakti gelince yuklenir.
async function sendToInstagram() {
  if (!igRender) return;
  const name = igRender.name; // dialog acikken oge degisse bile bu ogeye gonderilir
  const B = await brandMod();
  const t = B.exportTarget();
  if (!t.connected && igRender.file) { // hesap yok: telefonun paylasim menusu
    try { await navigator.share({ files: [igRender.file] }); } catch (e) { /* paylasim iptal */ }
    return;
  }
  if (!(await igLinkedTarget())) return;
  // urunu AI projeden/videodan bulur (arayuzde son secili urun gonderilmez)
  const fill = async () => {
    const r = await api("/api/brand/caption", { method: "POST", body: { project: S.project?.id || "", brand: t.id } });
    return { text: r.text, hashtags: r.hashtags };
  };
  const when = whenPicker({ fill, cover: { render: name, brand: t.id, project: S.project?.id || "" } });
  let pub;
  for (;;) { // gecersiz secimde pencere yeniden acilir
    const ok = await confirmBox({
      title: `@${t.username} hesabına gönderilsin mi?`,
      text: `"${name}" Reels olarak yayınlanır.`,
      ok: "Gönder", cancel: "Vazgeç", content: when.node,
    });
    if (!ok) return;
    pub = when.commit();
    if (pub) break;
  }
  const say = (text) => { if (igRender?.name === name) $("#igStatus").textContent = text; }; // baska ogeye gecildiyse yazma
  if (pub.ai && !pub.caption && !pub.hashtags) { // "Simdi hazirla"ya basilmadi: once hazirla, sonra gonder/zamanla
    say("AI açıklamayı hazırlıyor...");
    try {
      const r = await fill();
      pub.caption = r.text || "";
      pub.hashtags = r.hashtags || "";
    } catch (e) {
      say("");
      toast(`AI açıklamayı yazamadı (${e.message}); yüklenirken yeniden denenecek`, 4000);
    }
  }
  const caption = [pub.caption, pub.hashtags].filter(Boolean).join("\n\n");
  if (!pub.at) {
    await publishNow(t, caption, name);
    return;
  }
  try {
    await api("/api/instagram/schedule", { method: "POST", body: {
      render: name, at: pub.at, caption, ai: pub.ai, brand: t.id, project: S.project?.id || "",
    } });
    say("");
    toast(`${fmtAt(pub.at)} tarihinde yüklenecek`, 3500);
    await loadScheduled();
  } catch (e) {
    say("");
    toast(e.message, 5000);
  }
}

// Secili ogenin (render) zamanlanmis/yukleniyor kayitlari: saat, aciklama, duzenle / iptal et.
// Zamanlanmis ya da yukleniyorsa Gonder dugmesi gizlenir, degilse gorunur.
async function loadScheduled() {
  const r = igRender;
  if (!r) return;
  let items = [];
  try { items = (await api("/api/instagram/scheduled")).items; } catch { /* liste olmadan devam */ }
  if (igRender !== r) return; // bu arada baska ogeye gecildi: eski ogenin bilgisi yazilmasin
  items = items.filter((it) => it.render === r.name);
  const box = $("#igSched");
  box.textContent = "";
  box.hidden = !items.length;
  igActive = items.some((it) => ["scheduled", "captioning", "uploading", "processing"].includes(it.status));
  syncIgBtn();
  for (const it of items) {
    const row = el("div", `ig-sched-row ${it.status}`);
    const state = it.status === "scheduled" ? `${fmtAt(it.at)} tarihinde yüklenecek` : it.status === "done" ? "Yayınlandı" : it.status === "error" ? `Hata: ${it.message}` : it.message;
    row.append(el("span", "", `${it.handle || "Instagram"} · ${state}`));
    if (it.permalink) {
      const a = el("a", "", "Aç");
      a.href = it.permalink;
      a.target = "_blank";
      a.rel = "noopener";
      row.append(a);
    }
    if (it.status === "scheduled") {
      const ed = el("button", "link-btn", "Düzenle");
      ed.type = "button";
      ed.onclick = () => editScheduled(it);
      row.append(ed);
    }
    if (["scheduled", "done", "error"].includes(it.status)) {
      const x = el("button", "link-btn", it.status === "scheduled" ? "İptal et" : "Kaldır");
      x.type = "button";
      x.onclick = async () => {
        x.disabled = true;
        try { await api(`/api/instagram/scheduled/${it.id}`, { method: "DELETE" }); } catch (e) { toast(e.message, 4000); }
        loadScheduled();
      };
      row.append(x);
    }
    box.append(row);
    if (it.status === "scheduled" && it.caption) {
      const det = el("details", "ig-sched-cap");
      det.append(el("summary", "", "Açıklama"), el("div", "", it.caption));
      box.append(det);
    }
  }
}
// Zamanlanmis yuklemeyi duzenle: yukleme saati ve aciklama (bos birakilip AI isaretlenirse yuklenirken AI yazar)
async function editScheduled(it) {
  const split = (it.caption || "").split(/\n\n(?=(?:#\S+\s*)+$)/);
  const fill = it.project ? async () => {
    const r = await api("/api/brand/caption", { method: "POST", body: { project: it.project, product: it.product || "", brand: it.brand } });
    return { text: r.text, hashtags: r.hashtags };
  } : null;
  const when = whenPicker({ fill, text: split[0] || "", tags: split[1] || "", edit: true, at: it.at, ai: !it.caption,
    cover: { render: it.render, brand: it.brand, project: it.project } });
  let pub;
  for (;;) { // gecersiz secimde pencere yeniden acilir
    const ok = await confirmBox({
      title: "Yüklemeyi düzenle",
      text: `"${it.render}" · ${it.handle ? "@" + it.handle.replace(/^@/, "") : "Instagram"}`,
      ok: "Kaydet", cancel: "Vazgeç", content: when.node,
    });
    if (!ok) return;
    pub = when.commit();
    if (pub) break;
  }
  const caption = [pub.caption, pub.hashtags].filter(Boolean).join("\n\n");
  try {
    await api(`/api/instagram/scheduled/${it.id}`, { method: "PATCH", body: { at: pub.at, caption, ai: pub.ai || !caption } });
    toast("Yükleme güncellendi", 3000);
  } catch (e) {
    toast(e.message, 5000);
  }
  loadScheduled();
}
setInterval(() => { if (!$("#igBox").hidden) loadScheduled(); }, 30000);
$("#btnIg").onclick = sendToInstagram;
$("#btnIgLink").onclick = () => window.dispatchEvent(new CustomEvent("studio:open", { detail: { tab: "brand" } }));

// ---- ust bar ----
const pname = $("#pname");
pname.addEventListener("input", () => {
  S.project.name = pname.value.trim() || "Yeni proje";
  scheduleSave();
});
pname.addEventListener("change", () => changed());
pname.addEventListener("keydown", (e) => { if (e.key === "Enter") pname.blur(); });

const SAVE_TIPS = {
  saved: "Kaydedildi", pending: "Kaydedilecek", saving: "Kaydediliyor…", error: "Kaydedilemedi, tekrar denenecek",
};
function syncSave() {
  const s = $("#saveState");
  s.dataset.state = S.save;
  s.title = SAVE_TIPS[S.save] || "";
}

// ---- olaylar ----
on("select", () => {
  renderToolbar();
  if (panelKey !== null && panelKey !== selKey()) closePanel();
});
on("project", renderToolbar);
on("time", updateCut);
on("restore", closePanel);
on("edit-text", () => textPanel());
on("edit-image", () => imagePanel());
on("ui", (a) => act(a === "add-text" ? "text" : a === "add-image" ? "image" : a));
on("save", syncSave);
on("history", () => {
  $("#btnUndo").disabled = !canUndo();
  $("#btnRedo").disabled = !canRedo();
});
on("load", () => {
  closePanel();
  pname.value = S.project.name;
  $("#exResult").hidden = true;
  $("#igBox").hidden = true;
  igRender = null;
  // sayfa yenilendiyse bu projenin suren render'ini izlemeye devam et (ust bar ilerlemesi)
  if (S.project.id && !watching) {
    api("/api/jobs").then((list) => {
      const run = list.find((j) => (j.status === "running" || j.status === "queued") && j.project_id === S.project.id);
      if (run && !watching) watchJob(run.id);
    }).catch(() => {});
  }
});
on("project", () => {
  $("#emptyAdd").hidden = S.project.clips.length > 0;
  $("#btnExport").disabled = !S.project.clips.length && !watching;
});
