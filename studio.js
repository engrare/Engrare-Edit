// AI Studyo: yazili istek + dosyalar -> AI videosu. Editorun ustunde acilan bir menu (#sheetStudio, yeni proje
// penceresi gibi); sonuc normal bir proje olarak olusur, render edilir ve editorde acilabilir.
// Tek arac, iki kurgu: "AI tasarlasin" (istek + dosyalardan sahneler; bitince secili sahneler yeniden olusturulabilir)
// ve "Sadece kes" (konusma videosundan sessizlik/dolgu/AI kesitleri). Ayarlar ortaktir: bosluk esigi (AI anlatimi ve
// video kesimi), konusma videosu kesimi, altyazi (soz obekleri, kelime kelime renklenir), ses ve muzik.
// Arayuz hangi AI motorunun kullanildigini bilmez: sunucuya yalnizca 1-3 arasi "guc" seviyesi gider.
// "Videoyu olustur ve yukle": video 9:16 olusur, aciklamayi AI yazar, secili markanin Instagram hesabina Reels gider.
import { $, API, HttpError, api, el, enc, fmtAgo, icon, iconBtn, sleep, toast, url } from "./api.js";
import { confirmBox } from "./dialog.js";
import { S, openProject } from "./state.js";
import * as player from "./player.js";
import { closeSheet, openMedia, openSheet } from "./ui.js";
import { fmtAt, prefs, setSaver, whenPicker } from "./igpick.js";
import { getBrand, igTarget, initBrand, refreshIg, syncBrand } from "./brand.js";

const LEVELS = { 1: "Hızlı", 2: "Dengeli", 3: "En kaliteli" };
const FORMATS = [[1080, 1920, "9:16"], [1080, 1350, "4:5"], [1080, 1080, "1:1"], [1920, 1080, "16:9"]];
const DURATIONS = [10, 15, 20, 30, 45, 60];
const VOICES = [["off", "Yok"], ["female", "Kadın"], ["male", "Erkek"], ["mixed", "Karışık"]];
const VOICE_LABEL = { female: "Kadın", male: "Erkek", mixed: "Karışık" };
const STAGES = { analiz: "Hazırlık", konusma: "Konuşma", plan: "Kurgu", ses: "Ses", kontrol: "Kontrol", sahneler: "Sahneler", render: "Render", yayin: "Instagram" };
const IG_BUSY = ["captioning", "uploading", "processing"];
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
  cap_color: "#ffd60a", cap_size: 1, gap: 0.5, lang: "auto", brand: "", product: "",
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
export function openStudio(jobId = null, tab = null) {
  openSheet("sheetStudio");
  if (jobId && !$("#stCovers").hidden) showCovers(false);
  if (jobId) st.view = jobId;
  if (tab) setTab(tab);
  refreshUsage();
  refreshIg();
  loadJobs();
}
// Disa aktar penceresindeki "Hesap ayarlari": Marka sekmesi acilir (Instagram baglantisi orada)
window.addEventListener("studio:open", (e) => openStudio(null, e.detail?.tab || null));

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

// yuklenen dosyanin cubugu, hiz bilgisi ve duraklat dugmesi
function paintUpload(f) {
  const u = f.ui;
  if (!u) return;
  u.bar.style.width = `${Math.round(f.progress || 0)}%`;
  u.pause.innerHTML = icon(f.paused ? "play" : "pause");
  u.pause.title = f.paused ? "Devam et" : "Duraklat";
  u.pause.classList.toggle("on", Boolean(f.paused));
  u.label.textContent = f.paused ? "Duraklatıldı" : f.note || (f.speed ? `${fmtSpeed(f.speed)}${f.eta ? ` · ${fmtEta(f.eta)}` : ""}` : f.progress ? `%${Math.round(f.progress)}` : "Yükleniyor…");
}

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
    const label = el("small", null, f.error || f.name);
    f.ui = null;
    let pause = null;
    if (!f.ref && !f.error) {
      const pb = el("div", "st-prog");
      const i = el("i");
      i.style.width = `${Math.round(f.progress || 0)}%`;
      pb.append(i);
      th.append(pb);
      pause = el("button", "st-pause");
      pause.onclick = () => {
        f.paused = !f.paused;
        if (f.paused) f.xhr?.abort(); // calisan parca kesilir, devam edince bastan gonderilir
        paintUpload(f);
        if (!f.paused) uploadNext(); // sirada bekleyen duraklatilmis dosya devam etti
      };
      th.append(pause);
      f.ui = { bar: i, label, pause };
      paintUpload(f);
    }
    const rm = el("button", "st-rm");
    rm.innerHTML = icon("close");
    rm.title = f.ref || f.error ? "Kaldır" : "İptal et";
    rm.onclick = () => {
      f.cancelled = true;
      f.xhr?.abort();
      st.files = st.files.filter((x) => x !== f);
      renderFiles();
      syncGo();
    };
    item.append(th, label, rm);
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

// Cloudflare tek istekte 100 MB'tan buyuk govdeyi reddeder: buyuk dosyalar 8 MB'lik parcalarla gonderilir
// (telefonda kopan parcanin yeniden gonderilecek kismi kucuk kalir)
const CHUNK = 8 * 1024 * 1024;

function putBlob(url, blob, onLoaded, ctl) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    ctl.xhr = x;
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

// ---- yukleme yardimcilari ----
// Ekran kilitlenince iOS Safari istekleri keser: yukleme suresince ekran acik tutulur.
// Wake Lock (iOS 16.4+, Android, masaustu) yoksa sessiz, gorunmez bir dongu videosu (NoSleep) oynatilir.
const NOSLEEP_SRC = "data:video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAANKbW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAA+gAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAnV0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAA+gAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAABAAAAAQAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAPoAAAgAAABAAAAAAHtbWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAABAAAAAQABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABmG1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAVhzdGJsAAAAwHN0c2QAAAAAAAAAAQAAALBhdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAABAAEABIAAAASAAAAAAAAAABFUxhdmM2MS4xOS4xMDEgbGlieDI2NAAAAAAAAAAAAAAAGP//AAAANmF2Y0MBZAAK/+EAGGdkAAqsWEXsBEAAAAMAQAAAAwEDxIlBGAEAB2joQ4OSyLD9+PgAAAAAEHBhc3AAAAABAAAAAQAAABRidHJ0AAAAAAAAFnAAAAAAAAAAGHN0dHMAAAAAAAAAAQAAAAIAACAAAAAAFHN0c3MAAAAAAAAAAQAAAAEAAAAYY3R0cwAAAAAAAAABAAAAAgAAIAAAAAAcc3RzYwAAAAAAAAABAAAAAQAAAAIAAAABAAAAHHN0c3oAAAAAAAAAAAAAAAIAAALCAAAADAAAABRzdGNvAAAAAAAAAAEAAAN6AAAAYXVkdGEAAABZbWV0YQAAAAAAAAAhaGRscgAAAAAAAAAAbWRpcmFwcGwAAAAAAAAAAAAAAAAsaWxzdAAAACSpdG9vAAAAHGRhdGEAAAABAAAAAExhdmY2MS43LjEwMwAAAAhmcmVlAAAC1m1kYXQAAAKsBgX//6jcRem95tlIt5Ys2CDZI+7veDI2NCAtIGNvcmUgMTY0IHIzMTA4IDMxZTE5ZjkgLSBILjI2NC9NUEVHLTQgQVZDIGNvZGVjIC0gQ29weWxlZnQgMjAwMy0yMDIzIC0gaHR0cDovL3d3dy52aWRlb2xhbi5vcmcveDI2NC5odG1sIC0gb3B0aW9uczogY2FiYWM9MSByZWY9MTYgZGVibG9jaz0xOjA6MCBhbmFseXNlPTB4MzoweDEzMyBtZT11bWggc3VibWU9MTAgcHN5PTEgcHN5X3JkPTEuMDA6MC4wMCBtaXhlZF9yZWY9MSBtZV9yYW5nZT0yNCBjaHJvbWFfbWU9MSB0cmVsbGlzPTIgOHg4ZGN0PTEgY3FtPTAgZGVhZHpvbmU9MjEsMTEgZmFzdF9wc2tpcD0xIGNocm9tYV9xcF9vZmZzZXQ9LTIgdGhyZWFkcz0xIGxvb2thaGVhZF90aHJlYWRzPTEgc2xpY2VkX3RocmVhZHM9MCBucj0wIGRlY2ltYXRlPTEgaW50ZXJsYWNlZD0wIGJsdXJheV9jb21wYXQ9MCBjb25zdHJhaW5lZF9pbnRyYT0wIGJmcmFtZXM9MSBiX3B5cmFtaWQ9MCBiX2FkYXB0PTIgYl9iaWFzPTAgZGlyZWN0PTMgd2VpZ2h0Yj0xIG9wZW5fZ29wPTAgd2VpZ2h0cD0yIGtleWludD0yIGtleWludF9taW49MSBzY2VuZWN1dD00MCBpbnRyYV9yZWZyZXNoPTAgcmNfbG9va2FoZWFkPTIgcmM9Y3JmIG1idHJlZT0xIGNyZj00MC4wIHFjb21wPTAuNjAgcXBtaW49MCBxcG1heD02OSBxcHN0ZXA9NCBpcF9yYXRpbz0xLjQwIGFxPTE6MS4wMACAAAAADmWIggAp//7tz+BTLaQxAAAACEGaEtiCX4aA";
let awakeUsers = 0;
let wakeLock = null;
let noSleepVideo = null;
let acquiring = false;

async function acquireAwake() {
  if (!awakeUsers || acquiring || wakeLock) return;
  if (navigator.wakeLock) {
    acquiring = true;
    try {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => { wakeLock = null; });
      return;
    } catch (e) { /* reddedildi: video yontemi denenir */ } finally { acquiring = false; }
  }
  if (!noSleepVideo) {
    const v = document.createElement("video");
    v.setAttribute("playsinline", "");
    v.setAttribute("muted", "");
    v.muted = true;
    v.loop = true;
    v.src = NOSLEEP_SRC;
    v.style.cssText = "position:fixed;left:0;top:0;width:1px;height:1px;opacity:0.01;pointer-events:none";
    document.body.append(v);
    noSleepVideo = v;
  }
  noSleepVideo.play().catch(() => {});
}

function holdAwake(on) {
  awakeUsers = Math.max(0, awakeUsers + (on ? 1 : -1));
  if (awakeUsers) {
    acquireAwake();
    return;
  }
  wakeLock?.release().catch(() => {});
  wakeLock = null;
  noSleepVideo?.pause();
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") acquireAwake();
});

// baglanti/sekme geri gelene kadar bekler
const waitOnline = () => new Promise((resolve) => {
  if (navigator.onLine !== false && document.visibilityState !== "hidden") return resolve();
  const done = () => {
    if (navigator.onLine === false || document.visibilityState === "hidden") return;
    window.removeEventListener("online", done);
    document.removeEventListener("visibilitychange", done);
    resolve();
  };
  window.addEventListener("online", done);
  document.addEventListener("visibilitychange", done);
});

// son birkac saniyedeki bayt artisindan hiz (bayt/sn)
function makeMeter() {
  const samples = [];
  return (bytes) => {
    const now = performance.now();
    samples.push([now, bytes]);
    while (samples.length > 2 && now - samples[0][0] > 5000) samples.shift();
    const [t0, b0] = samples[0];
    return now - t0 >= 500 ? Math.max(0, (bytes - b0) / ((now - t0) / 1000)) : 0;
  };
}

const fmtSpeed = (bps) => (bps >= 1e6 ? `${(bps / 1e6).toFixed(1).replace(".", ",")} MB/sn` : `${Math.round(bps / 1e3)} KB/sn`);
const fmtEta = (sec) => (sec >= 3600 ? `${Math.floor(sec / 3600)} sa ${Math.round((sec % 3600) / 60)} dk` : sec >= 90 ? `${Math.round(sec / 60)} dk` : `${Math.max(1, Math.round(sec))} sn`);

// ctl: { paused, cancelled, xhr } — yukleme kontrolu. Duraklatma calisan parcayi keser, devam edince ayni parca yeniden gonderilir.
async function putFile(file, name, onProgress, ctl) {
  const base = `${API}/api/studio/upload?name=${enc(name)}`;
  const chunked = file.size > CHUNK;
  const uid = chunked ? [...crypto.getRandomValues(new Uint8Array(12))].map((b) => b.toString(16).padStart(2, "0")).join("") : "";
  let last;
  holdAwake(true);
  try {
    for (let off = 0; off < file.size; off += CHUNK) {
      const part = chunked ? file.slice(off, Math.min(off + CHUNK, file.size)) : file;
      const target = chunked ? `${base}&uid=${uid}&offset=${off}&total=${file.size}` : base;
      for (let tries = 0; ; ) {
        while (ctl.paused && !ctl.cancelled) await sleep(250);
        if (ctl.cancelled) throw Object.assign(new Error("iptal"), { fatal: true });
        await waitOnline();
        try {
          last = await putBlob(target, part, (l) => onProgress(off + l, file.size), ctl);
          break;
        } catch (e) {
          if (ctl.cancelled) throw e;
          if (ctl.paused) continue; // duraklatma istegi: sayilmaz, devam edince tekrar gonderilir
          if (e.fatal || ++tries > 40) throw e;
          ctl.retrying?.();
          await sleep(Math.min(1000 * 2 ** (tries - 1), 15000)); // ayni parca yeniden denenir (yaklasik 10 dk)
        }
      }
    }
  } finally {
    holdAwake(false);
  }
  return last;
}

let uploading = false;
async function uploadNext() {
  if (uploading) return;
  const f = st.files.find((x) => !x.ref && !x.error && x.local && !x.paused);
  if (!f) {
    syncGo();
    return;
  }
  uploading = true;
  try {
    const meter = makeMeter();
    f.retrying = () => { f.note = "Yeniden deneniyor…"; f.speed = 0; paintUpload(f); };
    const r = await putFile(f.local, f.name, (loaded, total) => {
      f.progress = (loaded / total) * 100;
      f.note = "";
      f.speed = meter(loaded);
      f.eta = f.speed ? (total - loaded) / f.speed : 0;
      paintUpload(f);
    }, f);
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
      opts: st.opts, draft: $("#stPrompt").value, ig_when: prefs.when, ig_time: prefs.time, ig_ai: prefs.ai,
    } }).catch(() => {});
  }, 500);
}
const saveOpts = persist;
setSaver(persist);

function applySettings(s) {
  st.tier = [1, 2, 3].includes(s.tier) ? s.tier : st.tier;
  st.cut = Boolean(s.cut);
  st.voice = VOICES.some(([v]) => v === s.voice) ? s.voice : st.voice;
  st.fmt = FORMATS.some(([w, h]) => w === s.width && h === s.height) ? [s.width, s.height] : st.fmt;
  st.dur = DURATIONS.includes(s.duration) ? s.duration : st.dur;
  st.opts = { ...DEFAULT_OPTS, ...(s.opts || {}) };
  prefs.when = s.ig_when === "later" ? "later" : "now";
  prefs.time = /^\d\d:\d\d$/.test(s.ig_time || "") ? s.ig_time : prefs.time;
  prefs.ai = s.ig_ai !== false;
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
  const pub = $("#stGoPub");
  const cut = cutOnly();
  const pending = st.files.some((f) => !f.ref && !f.error);
  const empty = !$("#stPrompt").value.trim() && !st.files.some((f) => f.ref);
  const off = st.usage && st.usage.available === false && (!cut || st.opts.ai);
  const busy = go.dataset.busy === "1";
  go.disabled = pending || empty || Boolean(off) || busy;
  go.querySelector("span").textContent = pending ? "Dosyalar yükleniyor…" : off ? "AI şu an kullanılamıyor" : cut ? "Kes ve oluştur" : "Videoyu oluştur";
  // yukleme: secili markanin Instagram hesabi bu baglantida olmali
  const t = igTarget();
  pub.disabled = go.disabled || !t.linked;
  pub.querySelector("span").textContent = cut ? "Kes, oluştur ve yükle" : "Videoyu oluştur ve yükle";
  $("#stPubNote").textContent = !t.loaded ? ""
    : !t.connected ? "Yüklemek için Instagram'ı bağla (Marka sekmesi)."
      : t.linked ? `"Oluştur ve yükle": 9:16 Reels olarak @${t.username} hesabına gider, açıklamayı AI yazar.`
        : `${t.name || "Seçili marka"} Instagram hesabı henüz bağlı değil (Marka sekmesi).`;
}

async function submit(publish = false) {
  const go = $("#stGo");
  const prompt = $("#stPrompt").value.trim();
  const cut = cutOnly();
  const files = st.files.filter((f) => f.ref && (!cut || f.kind === "video")).map((f) => ({ ref: f.ref, name: f.name }));
  if (!prompt && !files.length) {
    toast("Ne tür bir video istediğini yaz ya da dosya ekle");
    return;
  }
  if (cut && st.files.some((f) => f.ref && f.kind !== "video")) toast("Sadece kes kurgusunda yalnızca videolar kullanılır", 3000);
  const t = igTarget();
  if (publish && !t.linked) {
    toast(`${t.name || "Seçili marka"} Instagram hesabı bağlı değil`, 3500);
    return;
  }
  const size = publish ? [1080, 1920] : st.fmt; // Reels: dikey tam ekran
  const fmt = FORMATS.find(([w, h]) => w === size[0] && h === size[1])?.[2] || size.join("x");
  const when = publish ? whenPicker() : null; // video henuz yok: AI aciklamayi video hazir olunca yazar
  let pub = null;
  for (;;) { // gecersiz zamanda pencere yeniden acilir
  const ok = await confirmBox({
    content: when?.node,
    title: publish ? `Video oluşturulup @${t.username} hesabına yüklensin mi?` : cut ? "Video kesilip oluşturulsun mu?" : "Video oluşturulsun mu?",
    text: `${fmt}${publish ? " Reels" : ""} · ${st.dur} sn${cut ? "" : ` · ${LEVELS[st.tier]}`}`
      + (publish ? `\nBitince açıklama ve etiketleri AI yazar, video ${getBrand()?.name || ""} hesabında yayınlanır.` : "")
      + (cut && !st.opts.ai && !publish ? "" : "\nBu işlem AI kullanılabilirliğinden harcar."),
    ok: publish ? "Oluştur ve yükle" : "Oluştur", cancel: "Vazgeç",
  });
  if (!ok) return;
  pub = when ? when.commit() : { at: 0 };
  if (pub !== null) break;
  }
  go.dataset.busy = "1";
  syncGo();
  try {
    const j = await api("/api/studio/jobs", { method: "POST", body: {
      mode: cut ? "reels" : "video", prompt, tier: st.tier, files, width: size[0], height: size[1],
      duration: st.dur, voice: cut ? "off" : st.voice, opts: st.opts, publish, publish_at: pub.at || null,
      caption: pub.caption || "", hashtags: pub.hashtags || "",
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
const igBusy = (j) => Boolean(j && IG_BUSY.includes(j.ig?.status));
// zamanlanmis yukleme vakti yaklasinca (60 sn) da izlenir: baslayinca durum ekranda guncellenir
const igDue = (j) => j?.ig?.status === "scheduled" && j.ig.at * 1000 < Date.now() + 60000;
const active = (j) => running(j) || igBusy(j) || igDue(j);

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
  if (st.jobs.some(active)) poll();
}

async function poll() {
  if (st.polling) return;
  st.polling = true;
  try {
    while (st.jobs.some(active)) {
      for (const j of st.jobs.filter(active)) {
        let n;
        try {
          n = await api(`/api/studio/jobs/${j.id}`);
        } catch (e) {
          if (e instanceof HttpError && e.status === 404) n = { ...j, status: "error", error: "iş bulunamadı" };
          else continue;
        }
        const was = j.status;
        const igWas = j.ig?.status;
        upsert(n);
        if (igWas !== n.ig?.status && IG_BUSY.includes(igWas || "captioning")) {
          if (n.ig?.status === "done") toast(`Instagram'da yayınlandı: @${n.ig.username} 🎉`, 4000);
          else if (n.ig?.status === "error") toast(`Instagram'a yüklenemedi: ${n.ig.message}`, 5000);
        }
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
    const ig = j.ig?.status === "done" ? "done"
      : ["scheduled", ...IG_BUSY].includes(j.ig?.status) || (j.publish && running(j) && j.ig?.status !== "error") ? "pending" : "";
    const title = el("b", null, `${jobLabel(j)}${j.version > 1 ? ` · v${j.version}` : ""}`);
    if (ig) {
      const dot = el("i", `ig-dot ${ig}`);
      dot.title = ig === "done" ? "Instagram'a yüklendi" : "Instagram'a yüklenecek";
      title.prepend(dot);
    }
    meta.append(
      title,
      el("small", null, `${fmtAgo(j.created)} · ${j.mode === "reels" ? "Sadece kes · " : ""}${LEVELS[j.tier] || ""}${status}`),
    );
    const open = () => {
      st.view = j.id;
      renderHistory();
      showView(true);
    };
    meta.onclick = open;
    const th = el("img", "hist-thumb empty");
    th.alt = "";
    if (j.status === "done" && j.render_file && j.exists) {
      th.loading = "lazy";
      th.src = url.renderThumb(j.render_file);
      th.classList.remove("empty");
      th.onerror = () => { th.removeAttribute("src"); th.classList.add("empty"); };
    }
    th.onclick = open;
    row.append(th, meta);
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
    s.hidden = (s.dataset.k === "yayin" && !j.publish)
      || (reels ? ["ses", "kontrol", "sahneler"].includes(s.dataset.k) : (s.dataset.k === "konusma" && !speech) || (s.dataset.k === "ses" && (j.voice || "off") === "off"));
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
    showIg(j);
  }
  const notes = $("#stNotes");
  notes.textContent = (j.notes || []).join(" ");
  notes.hidden = !(j.notes || []).length;
  if (scroll) card.scrollIntoView({ behavior: "smooth", block: "start" });
}

// Bitmis videonun Instagram durumu: yukleniyor / yayinlandi (baglanti) / hata (tekrar dene) / yuklenmedi (yukle)
function showIg(j) {
  const ig = j.ig || {};
  const msg = $("#stIgMsg");
  const btn = $("#stIgBtn");
  const busy = igBusy(j);
  const target = igTarget(j.opts?.brand && typeof j.opts.brand === "string" ? j.opts.brand : getBrand()?.id);
  msg.textContent = "";
  msg.className = `st-ig-msg ${ig.status || ""}`;
  if (busy) msg.textContent = `Instagram: ${ig.message || "yükleniyor"}…`;
  else if (ig.status === "scheduled") msg.textContent = `Instagram'a ${fmtAt(ig.at)} tarihinde yüklenecek (@${target.username || ig.handle || ""}).`;
  else if (ig.status === "done") {
    msg.textContent = `Instagram'da yayınlandı · @${ig.username || ""} `;
    if (ig.permalink) {
      const a = el("a", "", "Aç");
      a.href = ig.permalink;
      a.target = "_blank";
      a.rel = "noopener";
      msg.append(a);
    }
  } else if (ig.status === "error") msg.textContent = `Instagram'a yüklenemedi: ${ig.message || ""}`;
  else if (!target.linked) msg.textContent = target.connected ? `${target.name} Instagram hesabı henüz bağlı değil.` : "";
  msg.hidden = !msg.textContent;
  const cov = $("#stIgCover");
  cov.hidden = !(ig.cover_by === "ai" && j.render_file);
  if (!cov.hidden) {
    const u = url.cover(j.render_file);
    if (cov.dataset.src !== u) { cov.dataset.src = u; cov.src = u; }
    cov.onclick = () => window.open(u, "_blank", "noopener");
  }
  $("#stIgCap").hidden = !ig.caption;
  $("#stIgCapText").textContent = ig.caption || "";
  $("#stIgEdit").hidden = ig.status !== "scheduled";
  $("#stIgCancel").hidden = ig.status !== "scheduled";
  btn.hidden = busy || ig.status === "done" || ig.status === "scheduled" || !target.linked || !j.exists;
  btn.dataset.brand = target.id;
  btn.textContent = ig.status === "error" ? "Tekrar dene" : `Instagram'a yükle · @${target.username}`;
}

async function publishNow() {
  const j = st.jobs.find((x) => x.id === st.view);
  const btn = $("#stIgBtn");
  if (!j || btn.disabled) return;
  const t = igTarget(btn.dataset.brand);
  let pub = { at: 0, caption: "", hashtags: "" };
  if (j.ig?.status !== "error") {
    // video hazir: "AI doldursun" aciklamayi ve etiketleri hemen yazar, yuklemeden once duzenlenebilir
    const fill = j.project_id ? async () => {
      const r = await api("/api/brand/caption", { method: "POST", body: { project: j.project_id, product: j.opts?.product || "", brand: t.id } });
      return { text: r.text, hashtags: r.hashtags };
    } : null;
    const split = (j.ig?.caption || "").split(/\n\n(?=(?:#\S+\s*)+$)/);
    const when = whenPicker({ fill, text: split[0] || "", tags: split[1] || "", cover: j.render_file && j.exists ? { render: j.render_file, job: j.id, brand: t.id, project: j.project_id } : null });
    for (;;) { // gecersiz zamanda pencere yeniden acilir
      const ok = await confirmBox({
        title: `@${t.username} hesabına yüklensin mi?`,
        text: `"${jobLabel(j)}" Reels olarak yayınlanır.${j.width / j.height > 0.6 ? "\nVideo dikey (9:16) değil; Instagram kenarlara boşluk ekleyebilir." : ""}`,
        ok: "Yükle", cancel: "Vazgeç", content: when.node,
      });
      if (!ok) return;
      pub = when.commit();
      if (pub !== null) break;
    }
  }
  btn.disabled = true;
  try {
    const n = await api(`/api/studio/jobs/${j.id}/publish`, { method: "POST", body: { brand: t.id, at: pub.at || null, caption: pub.caption, hashtags: pub.hashtags } });
    upsert(n);
    showView();
    poll();
  } catch (e) {
    toast(e.message, 5000);
  } finally {
    btn.disabled = false;
  }
}

// Zamanlanmis yuklemenin saatini ve aciklamasini degistirir (video hazirlanirken de olur)
async function editSchedule() {
  const j = st.jobs.find((x) => x.id === st.view);
  const btn = $("#stIgEdit");
  if (!j || btn.disabled) return;
  const t = igTarget(j.opts?.brand && typeof j.opts.brand === "string" ? j.opts.brand : getBrand()?.id);
  const fill = j.project_id ? async () => {
    const r = await api("/api/brand/caption", { method: "POST", body: { project: j.project_id, product: j.opts?.product || "", brand: t.id } });
    return { text: r.text, hashtags: r.hashtags };
  } : null;
  const split = (j.ig?.caption || "").split(/\n\n(?=(?:#\S+\s*)+$)/);
  const when = whenPicker({ fill, text: split[0] || "", tags: split[1] || "", edit: true, at: j.ig?.at, ai: !j.ig?.caption,
    cover: j.render_file && j.exists ? { render: j.render_file, job: j.id, brand: t.id, project: j.project_id } : null });
  let pub;
  for (;;) { // gecersiz zamanda pencere yeniden acilir
    const ok = await confirmBox({
      title: "Yüklemeyi düzenle",
      text: `"${jobLabel(j)}" · @${t.username || j.ig?.handle || ""}`,
      ok: "Kaydet", cancel: "Vazgeç", content: when.node,
    });
    if (!ok) return;
    pub = when.commit();
    if (pub) break;
  }
  btn.disabled = true;
  try {
    upsert(await api(`/api/studio/jobs/${j.id}/reschedule`, { method: "POST", body: { at: pub.at, caption: pub.caption, hashtags: pub.hashtags } }));
    toast("Yükleme güncellendi");
  } catch (e) {
    toast(e.message, 5000);
    await loadJobs();
  } finally {
    btn.disabled = false;
    showView();
  }
}

async function unschedule() {
  const j = st.jobs.find((x) => x.id === st.view);
  const btn = $("#stIgCancel");
  if (!j || btn.disabled) return;
  btn.disabled = true;
  try {
    upsert(await api(`/api/studio/jobs/${j.id}/unschedule`, { method: "POST" }));
    toast("Zamanlanmış yükleme iptal edildi");
  } catch (e) {
    toast(e.message, 4000);
    await loadJobs();
  } finally {
    btn.disabled = false;
    showView();
  }
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
$("#stGo").onclick = () => submit(false);
$("#stGoPub").onclick = () => submit(true);
$("#stGoPub").insertAdjacentHTML("afterbegin", icon("send"));
$("#stIgBtn").onclick = publishNow;
$("#stIgEdit").onclick = editSchedule;
$("#stIgCancel").onclick = unschedule;
// zamanlanmis yukleme vakti gelince (sayfa acik kalmissa) izlemeyi baslat
setInterval(() => { if (!st.polling && st.jobs.some(igDue)) poll(); }, 20000);
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

// ---- Kapaklar: yuklenecek videolar icin hazirlanan kapaklar (yalniz bunlar) ----
async function loadCovers() {
  const grid = $("#stCoversGrid");
  let list;
  try {
    list = await api("/api/covers");
  } catch (e) {
    grid.replaceChildren(el("div", "muted", `Kapaklar alınamadı: ${e.message}`));
    return;
  }
  $("#stCoversCount").textContent = list.length ? `${list.length} kapak` : "";
  grid.replaceChildren();
  if (!list.length) {
    grid.append(el("div", "muted", "Henüz kapak yok. Bir videoyu Instagram'a yüklediğinde kapağı burada görünür."));
    return;
  }
  for (const c of list) {
    const u = `${API}/api/covers/${enc(c.file)}`;
    const card = el("div", "st-cover");
    const im = el("img");
    im.loading = "lazy";
    im.alt = c.title || "Kapak";
    im.src = u;
    im.onclick = () => window.open(u, "_blank", "noopener");
    const acts = el("div", "st-cover-acts");
    const dl = el("a", "btn ghost sm", "İndir");
    dl.href = u;
    dl.download = c.file;
    const del = el("button", "icon-btn sm danger");
    del.type = "button";
    del.innerHTML = icon("trash");
    del.title = "Sil";
    del.onclick = async () => {
      if (!(await confirmBox({ title: "Kapak silinsin mi?", text: "Hazırlanan kapak görseli silinir (video silinmez).", ok: "Sil", danger: true }))) return;
      try { await api(`/api/covers/${enc(c.id)}`, { method: "DELETE" }); } catch (e) { toast(e.message); }
      loadCovers();
    };
    acts.append(dl, del);
    const sub = el("small", null, `${fmtAgo(c.created)}${c.handle ? ` · ${c.handle}` : ""}${c.permalink ? "" : " · yüklenmedi"}`);
    if (c.permalink) {
      const a = el("a", "", " · Aç");
      a.href = c.permalink;
      a.target = "_blank";
      a.rel = "noopener";
      sub.append(a);
    }
    card.append(im, el("b", null, c.title || c.render || "Video"), sub, acts);
    grid.append(card);
  }
}

function showCovers(on) {
  document.querySelector("#sheetStudio .studio-col").classList.toggle("covers-mode", on);
  $("#stCovers").hidden = !on;
  $("#stCoversBtn").textContent = on ? "← Geri" : "Kapaklar";
  if (on) {
    $("#stCoversGrid").replaceChildren(el("div", "muted", "Yükleniyor…"));
    loadCovers();
  }
}
$("#stCoversBtn").onclick = () => showCovers($("#stCovers").hidden);

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
    onChange: () => { syncGo(); showView(); },
  });
  loadSettings();
  loadJobs();
  if (location.hash === "#studio") {
    history.replaceState(null, "", location.pathname + location.search);
    openStudio();
  }
}
