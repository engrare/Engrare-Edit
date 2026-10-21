// AI Studyo: yazili istek + dosyalar -> AI videosu. Editorun ustunde acilan bir menu (#sheetStudio, yeni proje
// penceresi gibi); sonuc normal bir proje olarak olusur, render edilir ve editorde acilabilir.
// Tek arac, iki kurgu: "AI tasarlasin" (istek + dosyalardan sahneler; bitince secili sahneler yeniden olusturulabilir)
// ve "Sadece kes" (konusma videosundan sessizlik/dolgu/AI kesitleri). Ayarlar ortaktir: bosluk esigi (AI anlatimi ve
// video kesimi), konusma videosu kesimi, altyazi (soz obekleri, kelime kelime renklenir), ses ve muzik.
// Arayuz hangi AI motorunun kullanildigini bilmez: sunucuya yalnizca 1-3 arasi "guc" seviyesi gider.
import { $, API, HttpError, api, el, enc, fmtAgo, icon, iconBtn, sleep, toast, url } from "./api.js";
import { confirmBox } from "./dialog.js";
import { S, openProject } from "./state.js";
import * as player from "./player.js";
import { closeSheet, openMedia, openSheet } from "./ui.js";
import { bindCaption, initBrand, syncBrand } from "./brand.js";

const LEVELS = { 1: "Hızlı", 2: "Dengeli", 3: "En kaliteli" };
const FORMATS = [[1080, 1920, "9:16"], [1080, 1350, "4:5"], [1080, 1080, "1:1"], [1920, 1080, "16:9"]];
const DURATIONS = [10, 15, 20, 30, 45, 60];
const VOICES = [["off", "Yok"], ["female", "Kadın"], ["male", "Erkek"], ["mixed", "Karışık"]];
const VOICE_LABEL = { female: "Kadın", male: "Erkek", mixed: "Karışık" };
const STAGES = { analiz: "Hazırlık", konusma: "Konuşma", plan: "Kurgu", ses: "Ses", kontrol: "Kontrol", sahneler: "Sahneler", render: "Render" };
const STYLES = [["design", "AI sahneleri tasarlasın"], ["cut", "Sadece kes"]];
// Eski surumde ayarlar tarayicida (localStorage) duruyordu; sunucuda kayit yoksa bir kereye mahsus oradan alinir.
const LEGACY_KEYS = ["engrare:aiVoice", "engrare:aiStyle", "engrare:aiOpts", "engrare:aiTier", "engrare:aiDraft"];
const CUT_TOGGLES = [
  ["silence", "Sessizlikleri sil"], ["fillers", "Dolgu seslerini sil (ee, ıı)"],
  ["dedupe", "Tekrar çekimde sonuncuyu tut"], ["ai", "AI en iyi bölümleri seçsin"],
];
const GAPS = [[0.3, "0,3 sn · sıkı"], [0.5, "0,5 sn · normal"], [0.8, "0,8 sn · rahat"], [1.2, "1,2 sn · geniş"]];
const LANGS = [
  ["auto", "Otomatik"], ["tr", "Türkçe"], ["en", "English"], ["de", "Deutsch"], ["es", "Español"],
  ["fr", "Français"], ["ru", "Русский"], ["ar", "العربية"],
];
const CAP_COLORS = ["#ffd60a", "#ffffff", "#ff9f0a", "#ff6b9d", "#30d158", "#4aa8ff"];
const CAP_SIZES = [[0.85, "Küçük"], [1, "Normal"], [1.2, "Büyük"]];
const DEFAULT_OPTS = {
  silence: true, fillers: false, dedupe: false, ai: true, music: true, captions: true, karaoke: true,
  cap_color: "#ffd60a", cap_size: 1, gap: 0.5, lang: "auto", brand: true, product: "",
};
const MAX_FILES = 20;

const st = {
  files: [], // { id, name, kind, ref, path, progress, error, thumb, local }
  tier: 2,
  fmt: [1080, 1920],
  dur: 15,
  cut: false, // "Sadece kes" kurgusu secili mi (video eklenmisse gecerli)
  opts: { ...DEFAULT_OPTS },
  tab: "content",
  scenes: [], // gosterilen bitmis videonun sahneleri (yalnizca AI tasarimi)
  scenesFor: null,
  pick: new Set(), // revize icin secili sahne id'leri
  voice: "female",
  jobs: [],
  view: null, // gosterilen isin id'si
  polling: false,
  usage: null,
};
let seq = 0;
const view = $("#sheetStudio");
const isOpen = () => !view.hidden;

// ---- menuyu ac / kapa ----
export function openStudio(jobId = null) {
  openSheet("sheetStudio");
  if (jobId) st.view = jobId;
  refreshUsage();
  loadJobs();
}

export function closeStudio() {
  closeSheet();
}

// ---- kullanilabilirlik ----
function fmtLeft(ts) {
  if (!ts) return "";
  const m = Math.max(0, Math.round((ts * 1000 - Date.now()) / 60000));
  if (m < 60) return `${m} dk`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} sa ${m % 60} dk`;
  return `${Math.floor(h / 24)} gün ${h % 24} sa`;
}

async function refreshUsage() {
  try {
    st.usage = await api("/api/studio/usage");
  } catch (e) {
    st.usage = null;
  }
  renderUsage();
}

function renderUsage() {
  const u = st.usage;
  const five = u?.five_hour;
  const week = u?.weekly;
  const left = five ? Math.round(five.left) : null;
  const bar = $("#stUsageBar");
  const level = left == null ? "" : left <= 10 ? "low" : left <= 35 ? "mid" : "ok";
  $("#stUsageCard").dataset.level = level;
  $("#stUsageChip").dataset.level = level;
  $("#stUsageVal").textContent = left == null ? "—" : `%${left}`;
  $("#stUsageChip").textContent = left == null ? "—" : `%${left}`;
  bar.style.width = `${left ?? 0}%`;
  const parts = [];
  if (five?.resets_at) parts.push(`${fmtLeft(five.resets_at)} sonra yenilenir`);
  if (week && (left == null || week.left < left)) parts.push(`Haftalık %${Math.round(week.left)} kaldı (${fmtLeft(week.resets_at)} sonra yenilenir)`);
  if (u?.stale) parts.push("güncel olmayabilir");
  $("#stUsageSub").textContent = parts.join(" · ") || (u ? "" : "Bilgi alınamadı");
  const off = u && u.available === false;
  $("#stUsageCard").classList.toggle("off", Boolean(off));
  syncGo();
}

// ---- dosyalar ----
function kindOf(name, mime = "") {
  const n = name.toLowerCase();
  if (mime.startsWith("image/") || /\.(jpe?g|png|webp|gif|bmp|tiff?|heic|heif|avif|svg)$/.test(n)) return "image";
  if (mime.startsWith("video/") || /\.(mp4|mov|mkv|webm|avi|m4v|3gp|mts|m2ts)$/.test(n)) return "video";
  if (mime.startsWith("audio/") || /\.(mp3|m4a|aac|wav|flac|ogg|opus)$/.test(n)) return "audio";
  if (/\.(pdf|txt|md)$/.test(n)) return "doc";
  return null;
}

const KIND_ICON = { image: "image", video: "film", audio: "music", doc: "edit" };

function renderFiles() {
  const box = $("#stFiles");
  box.textContent = "";
  box.hidden = !st.files.length;
  for (const f of st.files) {
    const item = el("div", `st-file${f.error ? " err" : ""}${f.ref ? "" : " up"}`);
    const th = el("div", "st-thumb");
    if (f.thumb) {
      const im = el("img");
      im.alt = "";
      im.loading = "lazy";
      im.onerror = () => { th.innerHTML = icon(KIND_ICON[f.kind] || "plus"); };
      im.src = f.thumb;
      th.append(im);
    } else th.innerHTML = icon(KIND_ICON[f.kind] || "plus");
    if (f.kind === "video" || f.kind === "audio") th.append(el("span", "st-kind", f.kind === "video" ? "video" : "ses"));
    if (!f.ref && !f.error) {
      const pb = el("div", "st-prog");
      const i = el("i");
      i.style.width = `${Math.round(f.progress || 0)}%`;
      pb.append(i);
      th.append(pb);
    }
    const rm = el("button", "st-rm");
    rm.innerHTML = icon("close");
    rm.title = "Kaldır";
    rm.onclick = () => {
      f.xhr?.abort();
      st.files = st.files.filter((x) => x !== f);
      renderFiles();
      syncGo();
    };
    item.append(th, el("small", null, f.error || f.name), rm);
    box.append(item);
  }
  $("#stFileCount").textContent = st.files.length ? `${st.files.length} dosya` : "";
  if (box.dataset.video !== String(hasVideo())) { // video eklendi/cikti: kurgu secenegi gorunur/gizlenir
    box.dataset.video = String(hasVideo());
    applyStyle();
  }
}

function addLocalFiles(list) {
  for (const file of list) {
    if (st.files.length >= MAX_FILES) {
      toast(`En fazla ${MAX_FILES} dosya eklenebilir`);
      break;
    }
    const kind = kindOf(file.name, file.type);
    if (!kind) {
      toast(`Desteklenmeyen dosya: ${file.name}`);
      continue;
    }
    const f = { id: ++seq, name: file.name, kind, ref: "", progress: 0, local: file };
    if (kind === "image") f.thumb = URL.createObjectURL(file);
    st.files.push(f);
  }
  renderFiles();
  syncGo();
  uploadNext();
}

// Cloudflare tek istekte 100 MB'tan buyuk govdeyi reddeder: buyuk dosyalar 32 MB'lik parcalarla gonderilir
const CHUNK = 32 * 1024 * 1024;

function putBlob(url, blob, onLoaded, hold) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    hold(x);
    x.open("PUT", url);
    x.withCredentials = true;
    x.upload.onprogress = (e) => { if (e.lengthComputable) onLoaded(e.loaded); };
    x.onload = () => {
      let body = {};
      try { body = JSON.parse(x.responseText); } catch (e) { /* bos */ }
      if (x.status >= 200 && x.status < 300) return resolve(body);
      if (x.status === 401) window.dispatchEvent(new Event("auth:required"));
      const err = new Error(body.detail || `yükleme hatası (${x.status})`);
      err.fatal = x.status < 500 && x.status !== 408 && x.status !== 429;
      reject(err);
    };
    x.onerror = () => reject(new Error("bağlantı hatası"));
    x.onabort = () => { const e = new Error("iptal"); e.fatal = true; reject(e); };
    x.send(blob);
  });
}

async function putFile(file, name, onProgress, hold) {
  const base = `${API}/api/studio/upload?name=${enc(name)}`;
  if (file.size <= CHUNK) return putBlob(base, file, (l) => onProgress(l, file.size), hold);
  const uid = [...crypto.getRandomValues(new Uint8Array(12))].map((b) => b.toString(16).padStart(2, "0")).join("");
  let last;
  for (let off = 0; off < file.size; off += CHUNK) {
    const part = file.slice(off, Math.min(off + CHUNK, file.size));
    for (let tries = 0; ; tries++) {
      try {
        last = await putBlob(`${base}&uid=${uid}&offset=${off}&total=${file.size}`, part, (l) => onProgress(off + l, file.size), hold);
        break;
      } catch (e) {
        if (e.fatal || tries >= 5) throw e;
        await sleep(1000 * 2 ** tries); // kisa kopmalarda ayni parca yeniden denenir
      }
    }
  }
  return last;
}

let uploading = false;
async function uploadNext() {
  if (uploading) return;
  const f = st.files.find((x) => !x.ref && !x.error && x.local);
  if (!f) {
    syncGo();
    return;
  }
  uploading = true;
  try {
    const r = await putFile(f.local, f.name, (loaded, total) => {
      f.progress = (loaded / total) * 100;
      const bar = $("#stFiles").children[st.files.indexOf(f)]?.querySelector(".st-prog i");
      if (bar) bar.style.width = `${Math.round(f.progress)}%`;
    }, (x) => { f.xhr = x; });
    f.ref = r.ref;
    f.path = r.path || "";
    f.local = null;
    if (f.kind === "video" && f.path) f.thumb = url.thumb(f.path);
  } catch (e) {
    if (st.files.includes(f)) f.error = e.message;
  } finally {
    f.xhr = null;
    uploading = false;
  }
  renderFiles();
  uploadNext();
}

// Drive'dan secilen dosya (ui.js medya cekmecesi "studio" amaciyla acildiginda)
window.addEventListener("studio:pick", (e) => {
  const d = e.detail;
  if (!d?.path) return;
  if (st.files.some((f) => f.ref === `drive:${d.path}`)) {
    toast("Bu dosya zaten ekli");
    return;
  }
  if (st.files.length >= MAX_FILES) {
    toast(`En fazla ${MAX_FILES} dosya eklenebilir`);
    return;
  }
  st.files.push({
    id: ++seq, name: d.name, kind: d.type, ref: `drive:${d.path}`, path: d.path, progress: 100,
    thumb: d.type === "image" || d.type === "video" ? url.thumb(d.path) : "",
  });
  renderFiles();
  syncGo();
  toast(`Eklendi: ${d.name}`);
});

// ---- form ----
function chipRow(options, current, onPick) {
  const row = el("div", "chips");
  for (const [v, label] of options) {
    const b = el("button", `chip${String(v) === String(current) ? " on" : ""}`, label);
    b.type = "button";
    b.onclick = () => {
      row.querySelectorAll(".chip").forEach((x) => x.classList.toggle("on", x === b));
      onPick(v);
    };
    row.append(b);
  }
  return row;
}

const PLACEHOLDER = {
  design: "Nasıl bir video istiyorsun? Örn: Yeni kulaklığımız için 15 saniyelik, enerjik bir tanıtım. Ürün fotoğraflarını kullan, sonunda logo ve \"Şimdi keşfet\" yazsın.",
  cut: "İsteğe bağlı: hangi konular öne çıksın? Örn: Fiyat ve kargo bilgisini mutlaka al, girişte soruyla başla.",
};
const STYLE_NOTE = {
  design: "AI videoyu sahneler halinde tasarlar. Eklediğin konuşma videoları da kesilip (Kesim sekmesi) videoya yerleştirilir.",
  cut: "Eklediğin videolar kesilir (sessizlik, dolgu), altyazı ve müzik eklenir. AI yeni sahne tasarlamaz.",
};

// ---- ayarlar sunucuda (kullanici basina) ----
let saveTimer = 0;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    api("/api/studio/settings", { method: "PUT", body: {
      tier: st.tier, cut: st.cut, voice: st.voice, width: st.fmt[0], height: st.fmt[1], duration: st.dur,
      opts: st.opts, draft: $("#stPrompt").value,
    } }).catch(() => {});
  }, 500);
}
const saveOpts = persist;

function applySettings(s) {
  st.tier = [1, 2, 3].includes(s.tier) ? s.tier : st.tier;
  st.cut = Boolean(s.cut);
  st.voice = VOICES.some(([v]) => v === s.voice) ? s.voice : st.voice;
  st.fmt = FORMATS.some(([w, h]) => w === s.width && h === s.height) ? [s.width, s.height] : st.fmt;
  st.dur = DURATIONS.includes(s.duration) ? s.duration : st.dur;
  st.opts = { ...DEFAULT_OPTS, ...(s.opts || {}) };
}

function legacySettings() {
  const g = (k) => localStorage.getItem(k);
  let opts = {};
  try { opts = JSON.parse(g("engrare:aiOpts") || "{}"); } catch { /* bozuk kayit */ }
  return { tier: Number(g("engrare:aiTier")) || 2, cut: g("engrare:aiStyle") === "cut", voice: g("engrare:aiVoice") || "female", opts, draft: g("engrare:aiDraft") || "" };
}

async function loadSettings() {
  let s = null;
  try { s = (await api("/api/studio/settings")).settings; } catch { return; }
  const prompt = $("#stPrompt");
  if (s) {
    applySettings(s);
    if (!prompt.value) prompt.value = s.draft || "";
  } else {
    const old = legacySettings();
    applySettings(old);
    if (!prompt.value) prompt.value = old.draft;
    persist();
  }
  LEGACY_KEYS.forEach((k) => localStorage.removeItem(k));
  buildForm();
  syncBrand();
}
const hasVideo = () => st.files.some((f) => f.kind === "video");
const cutOnly = () => st.cut && hasVideo();

function toggleChips(options, state, onChange) {
  const row = el("div", "chips");
  for (const [k, label] of options) {
    const b = el("button", `chip${state[k] ? " on" : ""}`, label);
    b.type = "button";
    b.onclick = () => {
      state[k] = !state[k];
      b.classList.toggle("on", state[k]);
      onChange(k);
    };
    row.append(b);
  }
  return row;
}

function setTab(t) {
  st.tab = t;
  view.querySelectorAll(".st-tab").forEach((b) => b.classList.toggle("on", b.dataset.t === t));
  view.querySelectorAll(".st-pane").forEach((p) => { p.hidden = p.dataset.p !== t; });
}

// Kurgu (AI tasarlasin / sadece kes) degisince: alanlar ve ipuclari guncellenir. Video eklenmemisse "kes" secilemez.
function applyStyle() {
  const cut = cutOnly();
  $("#stStyleField").hidden = !hasVideo();
  $("#stStyles").replaceChildren(chipRow(STYLES, st.cut ? "cut" : "design", (v) => {
    st.cut = v === "cut";
    persist();
    applyStyle();
  }));
  $("#stStyleNote").textContent = STYLE_NOTE[cut ? "cut" : "design"];
  $("#stVoiceField").hidden = cut;
  $("#stPrompt").placeholder = PLACEHOLDER[cut ? "cut" : "design"];
  $("#stDurHead").textContent = cut ? "Hedef süre (AI seçimi)" : "Süre";
  $("#stCutOpts").replaceChildren(toggleChips(CUT_TOGGLES.filter(([k]) => cut || k !== "ai"), st.opts, saveOpts));
  syncGo();
}

function syncCapPreview() {
  $("#stCapPreview").style.setProperty("--cap", st.opts.cap_color);
  $("#stCapPreview").classList.toggle("flat", !st.opts.karaoke);
}

function buildForm() {
  view.querySelectorAll(".st-tab").forEach((b) => { b.onclick = () => setTab(b.dataset.t); });
  setTab(st.tab);
  $("#stFormats").replaceChildren(chipRow(FORMATS.map(([w, h, l]) => [`${w}x${h}`, l]), st.fmt.join("x"), (v) => {
    st.fmt = v.split("x").map(Number);
    persist();
  }));
  $("#stDurations").replaceChildren(chipRow(DURATIONS.map((d) => [d, `${d} sn`]), st.dur, (v) => { st.dur = v; persist(); }));
  $("#stGaps").replaceChildren(chipRow(GAPS, st.opts.gap, (v) => { st.opts.gap = v; saveOpts(); }));
  $("#stLangs").replaceChildren(chipRow(LANGS, st.opts.lang, (v) => { st.opts.lang = v; saveOpts(); }));
  $("#stCapOpts").replaceChildren(toggleChips([["captions", "Altyazı ekle"], ["karaoke", "Kelime kelime vurgula"]], st.opts, () => {
    saveOpts();
    syncCapPreview();
  }));
  const sw = $("#stCapColors");
  sw.textContent = "";
  for (const col of CAP_COLORS) {
    const b = el("button", `swatch${col === st.opts.cap_color ? " on" : ""}`);
    b.type = "button";
    b.style.background = col;
    b.title = col;
    b.onclick = () => {
      sw.querySelectorAll(".swatch").forEach((x) => x.classList.toggle("on", x === b));
      st.opts.cap_color = col;
      saveOpts();
      syncCapPreview();
    };
    sw.append(b);
  }
  $("#stCapSizes").replaceChildren(chipRow(CAP_SIZES, st.opts.cap_size, (v) => { st.opts.cap_size = v; saveOpts(); }));
  syncCapPreview();
  $("#stMusic").replaceChildren(chipRow([[1, "Otomatik seç"], [0, "Yok"]], st.opts.music ? 1 : 0, (v) => {
    st.opts.music = Boolean(v);
    saveOpts();
  }));
  applyStyle();
  $("#stVoices").replaceChildren(chipRow(VOICES, st.voice, (v) => {
    st.voice = v;
    persist();
  }));
  const r = $("#stPower");
  r.value = st.tier;
  r.oninput = () => {
    st.tier = Number(r.value);
    persist();
    syncPower();
  };
  syncPower();
  const p = $("#stPrompt");
  
  p.oninput = () => {
    persist();
    syncGo();
  };
}

function syncPower() {
  const r = $("#stPower");
  r.style.setProperty("--p", `${((st.tier - 1) / 2) * 100}%`);
  $("#stPowerName").textContent = LEVELS[st.tier];
  $("#stPowerTicks").querySelectorAll("i").forEach((t, i) => t.classList.toggle("on", i < st.tier));
}

function syncGo() {
  const go = $("#stGo");
  const cut = cutOnly();
  const pending = st.files.some((f) => !f.ref && !f.error);
  const empty = !$("#stPrompt").value.trim() && !st.files.some((f) => f.ref);
  const off = st.usage && st.usage.available === false && (!cut || st.opts.ai);
  go.disabled = pending || empty || Boolean(off) || go.dataset.busy === "1";
  go.querySelector("span").textContent = pending ? "Dosyalar yükleniyor…" : off ? "AI şu an kullanılamıyor" : cut ? "Kes ve oluştur" : "Video oluştur";
}

async function submit() {
  const go = $("#stGo");
  const prompt = $("#stPrompt").value.trim();
  const cut = cutOnly();
  const files = st.files.filter((f) => f.ref && (!cut || f.kind === "video")).map((f) => ({ ref: f.ref, name: f.name }));
  if (!prompt && !files.length) {
    toast("Ne tür bir video istediğini yaz ya da dosya ekle");
    return;
  }
  if (cut && st.files.some((f) => f.ref && f.kind !== "video")) toast("Sadece kes kurgusunda yalnızca videolar kullanılır", 3000);
  const fmt = FORMATS.find(([w, h]) => w === st.fmt[0] && h === st.fmt[1])?.[2] || st.fmt.join("x");
  const ok = await confirmBox({
    title: cut ? "Video kesilip oluşturulsun mu?" : "Video oluşturulsun mu?",
    text: `${fmt} · ${st.dur} sn${cut ? "" : ` · ${LEVELS[st.tier]}`}${cut && !st.opts.ai ? "" : "\nBu işlem AI kullanılabilirliğinden harcar."}`,
    ok: "Oluştur", cancel: "Vazgeç",
  });
  if (!ok) return;
  go.dataset.busy = "1";
  syncGo();
  try {
    const j = await api("/api/studio/jobs", { method: "POST", body: {
      mode: cut ? "reels" : "video", prompt, tier: st.tier, files, width: st.fmt[0], height: st.fmt[1],
      duration: st.dur, voice: cut ? "off" : st.voice, opts: st.opts,
    } });
    $("#stPrompt").value = "";
    persist();
    st.files = [];
    renderFiles();
    st.view = j.id;
    upsert(j);
    renderHistory();
    showView(true);
    poll();
  } catch (e) {
    toast(e.message, 4000);
  } finally {
    go.dataset.busy = "";
    syncGo();
  }
}

// ---- isler ----
function upsert(j) {
  const i = st.jobs.findIndex((x) => x.id === j.id);
  if (i >= 0) st.jobs[i] = j;
  else st.jobs.unshift(j);
}

const running = (j) => j && (j.status === "queued" || j.status === "running");

async function loadJobs() {
  try {
    st.jobs = await api("/api/studio/jobs");
  } catch (e) {
    return;
  }
  if (!st.view && st.jobs.length) { // suren is ya da son 2 saatte biten video gosterilsin
    const r = st.jobs.find(running) || st.jobs.find((j) => j.status === "done" && Date.now() / 1000 - (j.finished || 0) < 7200);
    st.view = r ? r.id : null;
  }
  renderHistory();
  showView();
  if (st.jobs.some(running)) poll();
}

async function poll() {
  if (st.polling) return;
  st.polling = true;
  try {
    while (st.jobs.some(running)) {
      for (const j of st.jobs.filter(running)) {
        let n;
        try {
          n = await api(`/api/studio/jobs/${j.id}`);
        } catch (e) {
          if (e instanceof HttpError && e.status === 404) n = { ...j, status: "error", error: "iş bulunamadı" };
          else continue;
        }
        const was = j.status;
        upsert(n);
        if (running({ status: was }) && n.status === "done") {
          toast(`AI videon hazır: ${n.title || "video"} ✨`, 4000);
          if (!isOpen()) st.view = n.id;
        } else if (running({ status: was }) && n.status === "error") {
          toast(`AI videosu oluşturulamadı: ${n.error}`, 5000);
        }
        if (n.status !== was) {
          renderHistory();
          refreshUsage();
        }
      }
      syncBadge();
      if (isOpen()) showView();
      await sleep(isOpen() ? 1500 : 4000);
    }
  } finally {
    st.polling = false;
    syncBadge();
    if (isOpen()) showView();
  }
}

// Ust bardaki AI dugmesi: suren is varken ilerleme halkasi
function syncBadge() {
  const b = $("#btnStudio");
  if (!b) return;
  const r = st.jobs.find(running);
  b.classList.toggle("busy", Boolean(r));
  b.style.setProperty("--p", `${Math.round(r?.progress || 0)}%`);
  b.title = r ? `AI Stüdyo · ${r.message || "çalışıyor"}` : "AI Stüdyo";
}

function jobLabel(j) {
  return j.title || (j.prompt ? j.prompt.slice(0, 60) : "AI video");
}

function renderHistory() {
  const box = $("#stHistory");
  box.textContent = "";
  $("#stHistHead").hidden = !st.jobs.length;
  for (const j of st.jobs.slice(0, 40)) {
    const row = el("div", `hist st-hist${j.id === st.view ? " mine" : ""}`);
    row.title = j.prompt || "";
    const meta = el("div", "hist-meta");
    const status = j.status === "done" ? "" : running(j) ? ` · %${Math.round(j.progress || 0)}` : j.status === "error" ? " · hata" : " · iptal";
    meta.append(
      el("b", null, `${jobLabel(j)}${j.version > 1 ? ` · v${j.version}` : ""}`),
      el("small", null, `${fmtAgo(j.created)} · ${j.mode === "reels" ? "Sadece kes · " : ""}${LEVELS[j.tier] || ""}${status}`),
    );
    meta.onclick = () => {
      st.view = j.id;
      renderHistory();
      showView(true);
    };
    row.append(meta);
    if (!running(j)) {
      const del = el("button", "icon-btn sm danger");
      del.innerHTML = icon("trash");
      del.title = "Sil";
      del.onclick = async () => {
        const ok = await confirmBox({
          title: "Bu video silinsin mi?",
          text: `"${jobLabel(j)}" kalıcı olarak silinir:\n• Drive'daki AI klasörü ve sahne dosyaları\n• Oluşan proje ve hazır video\n• Yalnızca bu videoda kullanılan yüklemeler\nGeri alınamaz.`,
          ok: "Sil", danger: true, hold: 2000,
        });
        if (!ok) return;
        try {
          await api(`/api/studio/jobs/${j.id}`, { method: "DELETE" });
        } catch (e) {
          toast(e.message);
          return;
        }
        st.jobs = st.jobs.filter((x) => x.id !== j.id);
        if (st.view === j.id) st.view = null;
        renderHistory();
        showView();
      };
      row.append(del);
    }
    box.append(row);
  }
}

// Videonun tam promptu; revizyonlarda onceki surumlerin istekleri de (eskiden yeniye) sirayla listelenir
function renderPrompts(j) {
  const chain = [];
  for (let c = j; c && chain.length < 30; c = st.jobs.find((x) => x.id === c.parent)) chain.unshift(c);
  const box = $("#stPromptList");
  const key = chain.map((c) => `${c.id}:${c.prompt}`).join("\n");
  if (box.dataset.key === key) return;
  box.dataset.key = key;
  box.textContent = "";
  for (const c of chain) {
    const head = el("div", "st-prompt-head");
    head.append(el("b", null, chain.length > 1 ? (c.parent ? `v${c.version} · değişiklik isteği` : `v${c.version} · ilk prompt`) : "Prompt"));
    const copy = el("button", "btn ghost sm", "Kopyala");
    copy.type = "button";
    copy.onclick = async () => {
      try {
        await navigator.clipboard.writeText(c.prompt || "");
        toast("Prompt kopyalandı");
      } catch {
        toast("Kopyalanamadı; metni seçip kopyala");
      }
    };
    head.append(copy);
    box.append(head, el("div", "st-prompt-text", c.prompt || "(prompt yok, sadece dosyalar)"));
  }
}

// Secili isin karti: surerken ilerleme, bitince video + editorde ac + revize
function showView(scroll = false) {
  const j = st.jobs.find((x) => x.id === st.view);
  const card = $("#stJob");
  card.hidden = !j;
  if (!j) return;
  const run = running(j);
  card.dataset.status = j.status;
  $("#stJobTitle").textContent = `${jobLabel(j)}${j.version > 1 ? ` · v${j.version}` : ""}`;
  const reels = j.mode === "reels";
  const speech = reels || (j.files || []).some((f) => f.kind === "video");
  $("#stJobMeta").textContent = reels
    ? `Sadece kes · ${j.width}×${j.height} · ${j.duration} sn hedef`
    : `${LEVELS[j.tier] || ""} · ${j.width}×${j.height} · ${j.duration} sn hedef${VOICE_LABEL[j.voice] ? ` · ${VOICE_LABEL[j.voice]} ses` : ""}${j.scenes?.length ? ` · ${j.scenes.length} sahne yenilendi` : ""}`;
  renderPrompts(j);
  // ilerleme
  const prog = $("#stProg");
  prog.hidden = !run && j.status !== "error" && j.status !== "cancelled";
  $("#stBar").style.width = `${run ? Math.round(j.progress || 0) : 100}%`;
  prog.dataset.status = j.status;
  let msg = j.message || "";
  if (j.status === "queued") msg = "Sırada bekliyor…";
  else if (j.status === "error") msg = `Hata: ${j.error || "bilinmeyen"}`;
  else if (j.status === "cancelled") msg = "İptal edildi";
  else if (run) msg = `${msg} · %${Math.round(j.progress || 0)}`;
  $("#stMsg").textContent = msg;
  $("#stCancel").hidden = !run;
  $("#stSteps").querySelectorAll("i").forEach((s) => {
    const keys = Object.keys(STAGES);
    const cur = keys.indexOf(j.stage);
    const k = keys.indexOf(s.dataset.k);
    s.hidden = reels ? ["ses", "kontrol", "sahneler"].includes(s.dataset.k) : (s.dataset.k === "konusma" && !speech) || (s.dataset.k === "ses" && (j.voice || "off") === "off");
    s.className = j.status === "done" || (run && k < cur) ? "done" : run && k === cur ? "on" : "";
  });
  $("#stSteps").hidden = !run;
  // sonuc
  const done = j.status === "done";
  $("#stResult").hidden = !done;
  if (done) {
    const v = $("#stVideo");
    const file = j.render_file || "";
    v.hidden = !file || !j.exists;
    if (file && v.dataset.file !== file) {
      v.dataset.file = file;
      v.src = url.render(file);
    }
    const dl = $("#stDownload");
    dl.hidden = !file || !j.exists;
    dl.href = file ? url.render(file) : "#";
    dl.download = file;
    $("#stOpen").disabled = !j.project_id;
    $("#stReviseBox").hidden = reels;
    $("#stRetryBox").hidden = !reels;
    if (!reels) loadScenes(j);
  }
  const notes = $("#stNotes");
  notes.textContent = (j.notes || []).join(" ");
  notes.hidden = !(j.notes || []).length;
  if (scroll) card.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function openInEditor() {
  const j = st.jobs.find((x) => x.id === st.view);
  if (!j?.project_id) return;
  closeStudio();
  try {
    await openProject(j.project_id);
    toast("AI projesi editörde açıldı");
  } catch (e) {
    toast(`Proje açılamadı: ${e.message}`, 4000);
  }
}

// Bitmis videonun sahneleri: secilenler yeniden olusturulur, digerleri aynen kalir
async function loadScenes(j) {
  if (st.scenesFor === j.id) return;
  st.scenesFor = j.id;
  st.pick.clear();
  st.scenes = [];
  renderScenes(j);
  try {
    const list = await api(`/api/studio/jobs/${j.id}/scenes`);
    if (st.scenesFor !== j.id) return;
    st.scenes = list;
  } catch (e) {
    st.scenes = [];
  }
  renderScenes(j);
}

function renderScenes(j) {
  const box = $("#stScenes");
  box.textContent = "";
  box.hidden = st.scenes.length < 2;
  for (const sc of st.scenes) {
    const b = el("button", `st-scene${st.pick.has(sc.id) ? " on" : ""}`);
    b.type = "button";
    b.style.setProperty("--ar", `${j.width} / ${j.height}`);
    const th = el("div", "st-sc-img");
    const im = el("img");
    im.alt = "";
    im.loading = "lazy";
    im.onerror = () => im.remove();
    im.src = `${API}/api/studio/jobs/${j.id}/scenes/${enc(sc.id)}.jpg`;
    th.append(im);
    b.append(th, el("b", null, `${sc.n}. sahne · ${sc.duration.toFixed(1)} sn`), el("small", null, sc.label), el("span", "st-sc-check", "✓"));
    b.title = sc.label;
    b.onclick = () => {
      if (st.pick.has(sc.id)) st.pick.delete(sc.id);
      else st.pick.add(sc.id);
      b.classList.toggle("on", st.pick.has(sc.id));
      syncRevise();
    };
    box.append(b);
  }
  syncRevise();
}

function syncRevise() {
  const n = st.pick.size;
  $("#stReviseGo").textContent = n ? `${n} sahneyi yeniden oluştur` : "Revize et";
  $("#stSceneClear").hidden = !n;
  $("#stSceneHint").textContent = st.scenes.length < 2 ? "" : n ? "yalnızca seçili sahneler yenilenir" : "sahne seçersen yalnızca onlar yenilenir";
  $("#stRevise").placeholder = n
    ? "Seçili sahnelerde ne değişsin? Boş bırakırsan farklı bir yorumla baştan tasarlanır."
    : "Örn: Başlığı büyüt, renkleri daha sıcak yap, son sahne daha uzun kalsın.";
}

// "Sadece kes" sonucunu begenmediyse: ayni videolar ve ayarlar forma doldurulur, ayarlayip yeniden olusturulur
function retryCut() {
  const j = st.jobs.find((x) => x.id === st.view);
  if (!j) return;
  st.cut = true;
  st.opts = { ...DEFAULT_OPTS, ...(j.opts || {}) };
  saveOpts();
  st.dur = DURATIONS.includes(j.duration) ? j.duration : st.dur;
  st.fmt = [j.width, j.height];
  st.files = (j.files || []).filter((f) => f.kind === "video").map((f) => ({
    id: ++seq, name: f.name, kind: "video", ref: f.ref, path: f.path || "", progress: 100, thumb: f.path ? url.thumb(f.path) : "",
  }));
  $("#stPrompt").value = j.prompt || "";
  buildForm();
  persist();
  syncBrand();
  renderFiles();
  setTab("cut");
  view.querySelector(".studio-body").scrollTo({ top: 0, behavior: "smooth" });
  toast("Ayarları değiştirip \"Kes ve oluştur\"a bas", 3500);
}

async function revise() {
  const j = st.jobs.find((x) => x.id === st.view);
  const box = $("#stRevise");
  const text = box.value.trim();
  const scenes = [...st.pick];
  if (!j || (!text && !scenes.length)) {
    toast("Neyin değişmesini istediğini yaz ya da sahne seç");
    return;
  }
  const b = $("#stReviseGo");
  b.disabled = true;
  try {
    const n = await api("/api/studio/jobs", { method: "POST", body: {
      prompt: text, tier: st.tier, files: [], parent: j.id, scenes,
    } });
    box.value = "";
    st.pick.clear();
    st.view = n.id;
    upsert(n);
    renderHistory();
    showView(true);
    poll();
  } catch (e) {
    toast(e.message, 4000);
  } finally {
    b.disabled = false;
  }
}

// ---- baglantilar ----
$("#stUpload").innerHTML = `${icon("attach")}<span>Dosya ekle</span>`;
$("#stDrive").innerHTML = `${icon("drive")}<span>Drive'dan seç</span>`;
$("#stGo").insertAdjacentHTML("afterbegin", icon("magic"));
$("#aiNew").onclick = () => openStudio();
$("#npAI").onclick = () => openStudio();
$("#stUpload").onclick = () => $("#stFileInput").click();
$("#stFileInput").onchange = (e) => {
  addLocalFiles([...e.target.files]);
  e.target.value = "";
};
$("#stDrive").onclick = () => openMedia("video,image,audio", "studio");
$("#stGo").onclick = submit;
$("#stCancel").onclick = async () => {
  if (!st.view) return;
  try {
    await api(`/api/studio/jobs/${st.view}/cancel`, { method: "POST" });
  } catch (e) {
    toast(e.message);
  }
};
$("#stOpen").onclick = openInEditor;
$("#stReviseGo").onclick = revise;
$("#stSceneClear").onclick = () => {
  st.pick.clear();
  const j = st.jobs.find((x) => x.id === st.view);
  if (j) renderScenes(j);
};
$("#stRetry").onclick = retryCut;
$("#stNewBtn").onclick = () => {
  st.view = null;
  renderHistory();
  showView();
  view.querySelector(".studio-body").scrollTo({ top: 0, behavior: "smooth" });
  $("#stPrompt").focus();
};
$("#stUsageChip").onclick = () => refreshUsage();

// Yazi alanina dosya surukle-birak
const compose = $("#stCompose");
compose.addEventListener("dragover", (e) => {
  e.preventDefault();
  compose.classList.add("drop");
});
compose.addEventListener("dragleave", () => compose.classList.remove("drop"));
compose.addEventListener("drop", (e) => {
  e.preventDefault();
  compose.classList.remove("drop");
  if (e.dataTransfer?.files?.length) addLocalFiles([...e.dataTransfer.files]);
});

buildForm();
renderFiles();
setInterval(() => { if (isOpen()) refreshUsage(); }, 60000);

// Giristen sonra: suren isleri izle; adres #studio ise menuyu ac
export function init() {
  initBrand({
    get opts() { return st.opts; }, save: saveOpts,
    setPrompt: (t) => { const p = $("#stPrompt"); p.value = t; p.oninput(); p.focus(); },
  });
  bindCaption(() => S.project?.id);
  loadSettings();
  loadJobs();
  if (location.hash === "#studio") {
    history.replaceState(null, "", location.pathname + location.search);
    openStudio();
  }
}
