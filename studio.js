// AI Studyo: yazili istek + dosyalar -> AI videosu. Editorun ustunde acilan bir menu (#sheetStudio, yeni proje
// penceresi gibi); sonuc normal bir proje olarak olusur, render edilir ve editorde acilabilir.
// Tek arac, iki kurgu: "AI tasarlasin" (istek + dosyalardan sahneler; bitince secili sahneler yeniden olusturulabilir)
// ve "Sadece kes" (konusma videosundan sessizlik/dolgu/AI kesitleri). Ayarlar ortaktir: bosluk esigi (AI anlatimi ve
// video kesimi), konusma videosu kesimi, altyazi (soz obekleri, kelime kelime renklenir), ses ve muzik.
// Arayuz hangi AI motorunun kullanildigini bilmez: sunucuya yalnizca 1-3 arasi "guc" seviyesi gider.
// "Videoyu olustur ve yukle": video 9:16 olusur, aciklamayi AI yazar, secili markanin Instagram hesabina Reels gider.
import { $, API, HttpError, api, el, enc, fmtAgo, icon, iconBtn, sleep, toast, url } from "./api.js";
import { confirmBox, downloadRender } from "./dialog.js";
import { S, openProject } from "./state.js";
import * as player from "./player.js";
import { closeSheet, openMedia, openSheet } from "./ui.js";
import { fmtAt, prefs, setSaver, whenPicker } from "./igpick.js";
import { getBrand, igTarget, initBrand, refreshBrand, refreshIg, refreshYt, syncBrand, ytTarget } from "./brand.js";

const PROVIDER_NAMES = { claude: "Claude", gemini: "Gemini" };
const PROVIDER_LEVELS = {
  claude: { 1: "Hızlı", 2: "Dengeli", 3: "En kaliteli" },
  gemini: { 1: "Neon Low", 2: "Neon Mid", 3: "Neon High" },
};
const jobProvider = (j) => (j?.provider === "gemini" ? "gemini" : "claude");
const provLabel = (prov) => PROVIDER_NAMES[prov === "gemini" ? "gemini" : "claude"];
const tierLabel = (prov, tier) => (PROVIDER_LEVELS[prov === "gemini" ? "gemini" : "claude"])[tier] || "";
const FORMATS = [[1080, 1920, "9:16"], [1080, 1350, "4:5"], [1080, 1080, "1:1"], [1920, 1080, "16:9"]];
const DURATIONS = [10, 15, 20, 30, 45, 60];
const VOICES = [["off", "Yok"], ["female", "Kadın · Ahenk"], ["female_eylul", "Kadın · Eylül"], ["male", "Erkek · Kaya"], ["male_tls", "Erkek · Trendyol TLS"], ["mixed", "Karışık"]];
const VOICE_LABEL = { female: "Kadın (Ahenk)", female_eylul: "Kadın (Eylül)", male: "Erkek (Kaya)", male_tls: "Erkek (Trendyol TLS)", mixed: "Karışık" };
const STAGES = { analiz: "Hazırlık", konusma: "Konuşma", plan: "Kurgu", ses: "Ses", kontrol: "Kontrol", sahneler: "Sahneler", render: "Render", qa: "Gemini QA", yayin: "Instagram" };
const IG_BUSY = ["captioning", "uploading", "processing"];
const YT_BUSY = ["queued", "uploading", "processing"];
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
  music_mode: "auto", music_file: "", music_name: "",
  auto_review: true, cap_color: "#ffd60a", cap_size: 1, gap: 0.5, lang: "auto", brand: "", product: "",
};
const MAX_FILES = 20;
const MUSIC_MODES = [["auto", "AI seçsin"], ["file", "Dosyadan seç"], ["off", "Yok"]];
const MUSIC_NOTE = {
  auto: "AI, videonun tonuna uygun parçayı kütüphaneden kendisi seçer; ses seviyesini sunucu ayarlar, konuşma varken kısılır.",
  file: "Seçtiğin parça her videoda arka plan müziği olarak kullanılır; değiştirene kadar kayıtlı kalır. Konuşma varken kısılır.",
  off: "Videolara arka plan müziği eklenmez.",
};

const st = {
  rfiles: [], // revize isteginin dosyalari (ayni bicim)
  files: [], // { id, name, kind, ref, path, progress, error, thumb, local }
  tier: 2,
  fmt: [1080, 1920],
  dur: 15,
  cut: false, // "Sadece kes" kurgusu secili mi (video eklenmisse gecerli)
  opts: { ...DEFAULT_OPTS },
  scenes: [], // gosterilen bitmis videonun sahneleri (yalnizca AI tasarimi)
  scenesFor: null,
  pick: new Set(), // revize icin secili sahne id'leri
  voice: "female",
  jobs: [],
  view: null, // gosterilen isin id'si
  polling: false,
  qcSubmitting: null,
  usageBy: {},   // { claude, gemini }: /api/studio/usage?provider=
  autoTimer: null,
  provider: "claude",
  config: null,
  page: "create", // create | auto | history | settings
  pp: (() => { try { return localStorage.getItem("stTab") || "fmt"; } catch { return "fmt"; } })(), // secili ayar sekmesi
  pub: false,     // "Instagram'a da yukle" anahtari (sunucudaki ayarlarda kalir)
  histN: 15,      // Gecmis sayfasinda gosterilen video sayisi
};
let seq = 0;
const view = $("#sheetStudio");
const isOpen = () => !view.hidden;

// ---- menuyu ac / kapa ----
export function openStudio(jobId = null, tab = null) {
  openSheet("sheetStudio");
  closeUsage();
  requestAnimationFrame(fitPrompt);
  if (jobId) {
    st.view = jobId;
    setPage("create");
  }
  if (tab) setTab(tab);
  loadConfig();
  refreshUsage();
  refreshIg();
  refreshYt();
  loadAutoTimer();
  loadLearning();
  loadJobs();
}
// Disa aktar penceresindeki "Hesap ayarlari": Marka sekmesi acilir (Instagram baglantisi orada)
window.addEventListener("studio:open", (e) => openStudio(null, e.detail?.tab || null));

export function closeStudio() {
  closeSheet();
}

// ---- AI saglayici ve ana sistem istemi ----
async function loadConfig() {
  try {
    const prev = st.provider;
    st.config = await api("/api/studio/config");
    st.provider = st.config?.provider === "gemini" ? "gemini" : "claude";
    if (st.provider !== prev || !(st.provider in st.usageBy)) refreshUsage();
  } catch (e) {
    // sessiz: varsayilan claude
  }
  renderAiCard();
  syncPower();
  renderUsage();
  renderAutoTimer();
  syncGo();
}

function renderAiCard() {
  const isGem = st.provider === "gemini";
  $("#stAiSeg").querySelectorAll("[data-prov]").forEach((b) => {
    const on = b.dataset.prov === st.provider;
    b.classList.toggle("on", on);
    b.setAttribute("aria-pressed", String(on));
  });
  const note = $("#stAiNote");
  note.textContent = isGem && st.config?.agy_available === false
    ? "Uyarı: Gemini CLI (agy) sunucuda bulunamadı."
    : "Yeni videolar ve revizeler bu yapay zekâ ile üretilir. Seçim otomatik Reels için de geçerlidir.";
  note.classList.toggle("warn", isGem && st.config?.agy_available === false);
  renderPills();
  $("#stSysCustomTag").hidden = !st.config?.system_prompt_custom;
  const ta = $("#stSysPrompt");
  if (st.config && document.activeElement !== ta) {
    ta.value = st.config.system_prompt || "";
  }
}

async function setProvider(prov) {
  if (prov !== "claude" && prov !== "gemini") return;
  if (prov === st.provider && st.config) return;
  const prev = st.provider;
  st.provider = prov;
  renderAiCard();
  syncPower();
  renderUsage();
  renderAutoTimer();
  syncGo();
  try {
    st.config = await api("/api/studio/config", { method: "PUT", body: { provider: prov } });
    st.provider = st.config?.provider === "gemini" ? "gemini" : "claude";
    renderAiCard();
    syncPower();
    renderUsage();
    refreshUsage();
    await loadAutoTimer();
    loadLearning();
    syncGo();
    toast(`Video AI sağlayıcısı: ${provLabel(st.provider)}`);
  } catch (e) {
    st.provider = prev;
    renderAiCard();
    syncPower();
    renderUsage();
    syncGo();
    toast(e.message, 4000);
  }
}

async function saveSysPrompt(reset = false) {
  const saveBtn = $("#stSysSave");
  const resetBtn = $("#stSysReset");
  saveBtn.disabled = true;
  resetBtn.disabled = true;
  try {
    const body = reset ? { reset_system_prompt: true } : { system_prompt: $("#stSysPrompt").value };
    st.config = await api("/api/studio/config", { method: "PUT", body });
    $("#stSysPrompt").value = st.config.system_prompt || "";
    renderAiCard();
    toast(reset ? "Ana sistem istemi varsayılana döndürüldü" : "Ana sistem istemi kaydedildi");
  } catch (e) {
    toast(e.message, 4000);
  } finally {
    saveBtn.disabled = false;
    resetBtn.disabled = false;
  }
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

// Secili saglayicinin kotasi gosterilir (Claude hesabi ya da Gemini/agy); her biri ayri tutulur ki gecis aninda
// eski deger gorunsun, yenisi gelince guncellensin.
async function refreshUsage() {
  const prov = st.provider === "gemini" ? "gemini" : "claude";
  try {
    st.usageBy[prov] = await api(`/api/studio/usage?provider=${prov}`);
  } catch (e) {
    st.usageBy[prov] = null;
  }
  renderUsage();
}

function curUsage() {
  return st.usageBy[st.provider === "gemini" ? "gemini" : "claude"] || null;
}

function renderUsage() {
  const u = curUsage();
  $("#stUsageTitle").textContent = `${provLabel(st.provider)} kullanımı`;
  $("#stUsageChip").title = `${provLabel(st.provider)} kullanılabilirlik (yenile)`;
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
  const fetched = (st.provider === "gemini" ? "gemini" : "claude") in st.usageBy;
  $("#stUsageSub").textContent = parts.join(" · ") || (u ? "" : fetched ? "Bilgi alınamadı" : "Yükleniyor…");
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
  renderList(st.files, $("#stFiles"), $("#stFileCount"));
  renderList(st.rfiles, $("#stReviseFiles"), $("#stReviseCount"));
  if ($("#stReviseGo")) syncRevise();
}

function renderList(list, box, countEl) {
  box.textContent = "";
  box.hidden = !list.length;
  for (const f of list) {
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
      list.splice(list.indexOf(f), 1);
      renderFiles();
      syncGo();
    };
    item.append(th, label, rm);
    box.append(item);
  }
  countEl.textContent = list.length ? `${list.length} dosya` : "";
  if (list === st.files && box.dataset.video !== String(hasVideo())) { // video eklendi/cikti: kurgu secenegi gorunur/gizlenir
    box.dataset.video = String(hasVideo());
    applyStyle();
  }
}

function addLocalFiles(list, target = st.files) {
  for (const file of list) {
    if (target.length >= MAX_FILES) {
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
    target.push(f);
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
      const msg = x.status >= 502 ? "sunucuya ulaşılamadı" : (body.detail || `yükleme hatası (${x.status})`);
      const err = new Error(msg);
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
  const f = [...st.files, ...st.rfiles].find((x) => !x.ref && !x.error && x.local && !x.paused);
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
    if (st.files.includes(f) || st.rfiles.includes(f)) f.error = e.message;
  } finally {
    f.xhr = null;
    uploading = false;
  }
  renderFiles();
  uploadNext();
}

let pickRevise = false; // Drive'dan secim revize alanina mi gidiyor
// Drive'dan secilen dosya (ui.js medya cekmecesi "studio" amaciyla acildiginda)
window.addEventListener("studio:pick", (e) => {
  const d = e.detail;
  if (!d?.path) return;
  const target = pickRevise ? st.rfiles : st.files;
  if (target.some((f) => f.ref === `drive:${d.path}`)) {
    toast("Bu dosya zaten ekli");
    return;
  }
  if (target.length >= MAX_FILES) {
    toast(`En fazla ${MAX_FILES} dosya eklenebilir`);
    return;
  }
  target.push({
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
  design: "Nasıl bir video istiyorsun? Örn: Yeni ürünümüz için enerjik bir tanıtım; ürün fotoğraflarını kullan, sonunda logo olsun.",
  cut: "İsteğe bağlı: hangi konular öne çıksın? Örn: Fiyat ve kargo bilgisini mutlaka al, girişte soruyla başla.",
};
const STYLE_NOTE = {
  design: "AI videoyu sahneler halinde tasarlar. Eklediğin konuşma videoları da kesilip (Kesim sekmesi) videoya yerleştirilir.",
  cut: "Eklediğin videolar kesilir (sessizlik, dolgu), altyazı ve müzik eklenir. AI yeni sahne tasarlamaz.",
};

// ---- ayarlar sunucuda (kullanici basina) ----
let saveTimer = 0;
function persist() {
  renderPills();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    api("/api/studio/settings", { method: "PUT", body: {
      tier: st.tier, cut: st.cut, voice: st.voice, width: st.fmt[0], height: st.fmt[1], duration: st.dur,
      opts: st.opts, draft: $("#stPrompt").value, ig_when: prefs.when, ig_time: prefs.time, ig_ai: prefs.ai, ig_pub: st.pub,
    } }).then(() => {
      // otomatik Reels de menudeki sesi, markayi ve urunu kullanir: kart guncel hedefi gostersin
      if (st.autoTimer && (
        (st.voice !== "off" && st.autoTimer.voice !== st.voice)
        || (st.opts.brand && st.autoTimer.brand !== st.opts.brand)
        || (st.opts.product && st.autoTimer.product !== st.opts.product)
      )) loadAutoTimer();
    }).catch(() => {});
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
  if (!s.opts?.music_mode) st.opts.music_mode = st.opts.music === false ? "off" : "auto"; // eski kayit
  if (st.opts.music_mode === "file" && !st.opts.music_file) st.opts.music_mode = "auto"; // dosya silinmis
  prefs.when = s.ig_when === "later" ? "later" : "now";
  prefs.time = /^\d\d:\d\d$/.test(s.ig_time || "") ? s.ig_time : prefs.time;
  prefs.ai = s.ig_ai !== false;
  st.pub = Boolean(s.ig_pub);
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

// Eski "sekme" adlari (disaridan acilis, "yeniden olustur") yeni yerlerine yonlenir
function setTab(t) {
  if (t === "brand") {
    setPage("settings");
    return;
  }
  setPage("create");
  const pp = { cut: "cut", caps: "caps", sound: "sound" }[t];
  if (pp) openPanel(pp);
}

// ---- sayfalar: Olustur / Otomasyon / Gecmis (+ disli: Ayarlar) ----
function setPage(pg) {
  if (!["create", "auto", "history", "settings"].includes(pg)) pg = "create";
  if (pg === "settings" && st.page !== "settings") st.back = st.page;
  st.page = pg;
  view.querySelector(".studio-col").dataset.page = pg;
  $("#stNav").querySelectorAll("[data-pg]").forEach((b) => {
    b.classList.toggle("on", b.dataset.pg === pg);
    b.setAttribute("aria-selected", String(b.dataset.pg === pg));
  });
  $("#stGear").classList.toggle("on", pg === "settings");
  if (pg === "auto") loadAutoTimer();
  if (pg === "history") renderHistory();
  view.querySelector(".studio-body").scrollTo({ top: 0 });
}

// ---- ayar sekmeleri: logolu sekmeler yan yana, secilenin paneli hep acik ----
const SET_TABS = [
  ["fmt", "format", "Format"],
  ["ai", "magic", "AI"],
  ["sound", "volume", "Ses"],
  ["caps", "cc", "Altyazı"],
  ["cut", "split", "Kesim"],
  ["brand", "layers", "Marka"],
];

function renderPills() {
  const box = $("#stPills");
  if (!box) return;
  if (!SET_TABS.some(([k]) => k === st.pp)) st.pp = "fmt";
  box.replaceChildren(...SET_TABS.map(([k, ic, t]) => {
    const b = el("button", `st-tab2${st.pp === k ? " on" : ""}`);
    b.type = "button";
    b.setAttribute("role", "tab");
    b.setAttribute("aria-selected", String(st.pp === k));
    b.innerHTML = icon(ic);
    b.append(el("span", null, t));
    b.onclick = () => openPanel(k);
    return b;
  }));
  $("#stPanel").querySelectorAll(".st-pp").forEach((p) => { p.hidden = p.dataset.pp !== st.pp; });
}

function openPanel(k) {
  st.pp = k;
  try { localStorage.setItem("stTab", k); } catch {}
  renderPills();
  if (k === "brand") refreshBrand();
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
  renderPills();
  syncGo();
}

function syncCapPreview() {
  $("#stCapPreview").style.setProperty("--cap", st.opts.cap_color);
  $("#stCapPreview").classList.toggle("flat", !st.opts.karaoke);
}

function buildForm() {
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
  renderMusic();
  applyStyle();
  $("#stVoices").replaceChildren(chipRow(VOICES, st.voice, (v) => {
    st.voice = v;
    persist();
  }));
  syncPower();
  const qc = $("#stAutoQc");
  qc.checked = st.opts.auto_review !== false;
  qc.onchange = () => {
    st.opts.auto_review = qc.checked;
    saveOpts();
  };
  const pub = $("#stPubOn");
  pub.checked = st.pub;
  pub.onchange = () => {
    st.pub = pub.checked;
    persist();
    syncGo();
  };
  const p = $("#stPrompt");
  p.oninput = () => {
    fitPrompt();
    persist();
    syncGo();
  };
  fitPrompt();
}

// istek kutusu yazdikca buyur (en fazla 360 px; sonra kayar)
function fitPrompt() {
  const p = $("#stPrompt");
  p.style.height = "auto";
  p.style.height = `${Math.min(p.scrollHeight + 2, 360)}px`;
}

// ---- arka plan muzigi: AI secsin / Drive'dan dosya / yok (son secim sunucudaki ayarlarda kalir) ----
function setMusicMode(mode) {
  st.opts.music_mode = mode;
  st.opts.music = mode !== "off";
  saveOpts();
  renderMusic();
}

function pickMusicFile() {
  openMedia("audio", "studio-music");
}

function renderMusic() {
  const mode = MUSIC_MODES.some(([v]) => v === st.opts.music_mode) ? st.opts.music_mode : "auto";
  const box = $("#stMusic");
  box.replaceChildren(chipRow(MUSIC_MODES, mode, (v) => {
    if (v === "file" && !st.opts.music_file) {
      renderMusic(); // dosya secilmeden mod degismez; secince "studio:music" modu kaydeder
      pickMusicFile();
      return;
    }
    setMusicMode(v);
  }));
  if (mode === "file" && st.opts.music_file) {
    const row = el("div", "st-music-file");
    row.append(el("span", "st-music-ico", "♪"), el("span", "st-music-name", st.opts.music_name || st.opts.music_file.split("/").pop()));
    const ch = el("button", "btn xs", "Değiştir");
    ch.type = "button";
    ch.onclick = pickMusicFile;
    row.append(ch);
    box.append(row);
  }
  $("#stMusicNote").textContent = MUSIC_NOTE[mode];
}

window.addEventListener("studio:music", (e) => {
  const d = e.detail;
  if (!d?.path) return;
  st.opts.music_file = d.path;
  st.opts.music_name = d.name || d.path.split("/").pop();
  setMusicMode("file");
  toast(`Müzik seçildi: ${st.opts.music_name}`);
});

function syncPower() {
  const levels = PROVIDER_LEVELS[st.provider === "gemini" ? "gemini" : "claude"];
  $("#stTiers").replaceChildren(...[1, 2, 3].map((n) => {
    const b = el("button", n === st.tier ? "on" : "", levels[n]);
    b.type = "button";
    b.setAttribute("aria-pressed", String(n === st.tier));
    b.onclick = () => {
      st.tier = n;
      persist();
      syncPower();
    };
    return b;
  }));
  $("#stPowerName").textContent = st.tier === 3 ? "en yavaş, en iyi sonuç" : st.tier === 1 ? "en hızlı" : "dengeli";
  renderPills();
}

function syncGo() {
  const go = $("#stGo");
  const cut = cutOnly();
  const pending = st.files.some((f) => !f.ref && !f.error);
  const empty = !$("#stPrompt").value.trim() && !st.files.some((f) => f.ref);
  const needsAi = !cut || st.opts.ai;
  const offQuota = curUsage()?.available === false && needsAi;
  const offAgy = st.provider === "gemini" && st.config?.agy_available === false && needsAi;
  const off = offQuota || offAgy;
  const busy = go.dataset.busy === "1";
  // yukleme: secili markanin Instagram hesabi bu baglantida olmali
  const t = igTarget();
  const pubOn = st.pub && t.linked;
  go.disabled = pending || empty || Boolean(off) || busy;
  go.classList.toggle("ig", pubOn);
  go.querySelector("span").textContent = pending ? "Dosyalar yükleniyor…"
    : offAgy ? "Gemini CLI bulunamadı"
      : offQuota ? `${provLabel(st.provider)} kullanım sınırı doldu`
        : `${cut ? "Kes ve oluştur" : "Videoyu oluştur"}${pubOn ? " · yükle" : ""}`;
  const pubIn = $("#stPubOn");
  pubIn.disabled = !t.linked;
  $("#stPubWrap").classList.toggle("dis", !t.linked);
  $("#stPubNote").textContent = !t.loaded ? ""
    : !t.connected ? "Instagram bağlı değil · Ayarlar"
      : t.linked ? `@${t.username}${ytTarget().linked && ytTarget().auto ? " + YouTube Shorts" : ""} · 9:16 Reels, açıklamayı AI yazar`
        : `${t.name || "Seçili marka"} hesabı bağlı değil · Ayarlar`;
}

async function submit() {
  const go = $("#stGo");
  const publish = st.pub && igTarget().linked;
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
    text: `${fmt}${publish ? " Reels" : ""} · ${st.dur} sn${cut ? "" : ` · ${provLabel(st.provider)} · ${tierLabel(st.provider, st.tier)}`}`
      + (publish ? `\nBitince açıklama ve etiketleri AI yazar, video ${getBrand()?.name || ""} hesabında yayınlanır.` : "")
      + (cut && !st.opts.ai && !publish ? "" : st.provider === "claude" ? "\nBu işlem Claude kullanılabilirliğinden harcar." : "\nBu işlem Gemini (HTML sahneler + ekran kaydı) ile oluşturulur."),
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
      mode: cut ? "reels" : "video", prompt, tier: st.tier, provider: st.provider, files, width: size[0], height: size[1],
      duration: st.dur, voice: cut ? "off" : st.voice, opts: st.opts, publish, publish_at: pub.at || null,
      caption: pub.caption || "", hashtags: pub.hashtags || "",
    } });
    $("#stPrompt").value = "";
    fitPrompt();
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
const qcBusy = (j) => Boolean(j && (j.qc_state?.status === "queued" || j.qc_state?.status === "running"));
const activeFixFor = (j) => {
  if (!j) return null;
  const fid = j.qc_state?.fix_job_id;
  return st.jobs.find((c) => running(c) && (c.parent === j.id || (fid && c.id === fid))) || null;
};
const igBusy = (j) => Boolean(j && IG_BUSY.includes(j.ig?.status));
// zamanlanmis yukleme vakti yaklasinca (60 sn) da izlenir: baslayinca durum ekranda guncellenir
const igDue = (j) => j?.ig?.status === "scheduled" && j.ig.at * 1000 < Date.now() + 60000;
const ytBusy = (j) => Boolean(j && YT_BUSY.includes(j.yt?.status));
const active = (j) => running(j) || qcBusy(j) || igBusy(j) || igDue(j) || ytBusy(j);

async function loadJobs() {
  try {
    st.jobs = await api("/api/studio/jobs");
  } catch (e) {
    return;
  }
  if (!st.view && st.jobs.length) { // suren is, suren kontrol ya da son 2 saatte biten video gosterilsin
    const r = st.jobs.find(running) || st.jobs.find(qcBusy) || st.jobs.find((j) => (j.status === "done" || j.can_resume) && Date.now() / 1000 - (j.finished || 0) < 7200);
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
        const qcWas = j.qc_state?.status;
        const igWas = j.ig?.status;
        const ytWas = j.yt?.status;
        upsert(n);
        if (ytWas && ytWas !== n.yt?.status && YT_BUSY.includes(ytWas)) {
          if (n.yt?.status === "done") toast(`YouTube'da yayınlandı: ${n.yt.channel || ""} 🎉`, 4000);
          else if (n.yt?.status === "error") toast(`YouTube'a yüklenemedi: ${n.yt.message}`, 5000);
        }
        if (igWas !== n.ig?.status && IG_BUSY.includes(igWas || "captioning")) {
          if (n.ig?.status === "done") toast(`Instagram'da yayınlandı: @${n.ig.username} 🎉`, 4000);
          else if (n.ig?.status === "error") toast(`Instagram'a yüklenemedi: ${n.ig.message}`, 5000);
        }
        if ((qcWas === "queued" || qcWas === "running") && !qcBusy(n)) {
          const ns = n.qc_state?.status;
          if (ns === "done") {
            const fid = n.qc_state?.fix_job_id;
            if (fid) {
              try {
                upsert(await api(`/api/studio/jobs/${fid}`));
              } catch {
                // bir sonraki loadJobs ile alinir
              }
              toast("Gemini sorunları buldu, otomatik düzeltme başlatıldı");
              if (st.view === n.id) st.view = fid;
            } else {
              toast(n.qc_state?.note || (n.qc?.ok ? "Gemini videoyu onayladı!" : "Gemini kontrolü tamamlandı"));
            }
          } else if (ns === "error") {
            toast(n.qc_state?.error || "Gemini kontrolü tamamlanamadı", 5000);
          }
          renderHistory();
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
  const q = r ? null : st.jobs.find(qcBusy);
  const act = r || q;
  b.classList.toggle("busy", Boolean(act));
  const pct = r ? (r.progress || 0) : (q?.qc_state?.progress || 0);
  const msg = r ? (r.message || "çalışıyor") : (q?.qc_state?.message || "Gemini kontrolü sürüyor");
  b.style.setProperty("--p", `${Math.round(pct)}%`);
  b.title = act ? `AI Stüdyo · ${msg}` : "AI Stüdyo";
}

function jobLabel(j) {
  return j.title || (j.prompt ? j.prompt.slice(0, 60) : "AI video");
}

function renderHistory() {
  const box = $("#stHistory");
  const list = st.jobs.slice(0, st.histN);
  box.replaceChildren(...list.map(histRow));
  $("#stHistHead").hidden = st.jobs.length > 0;
  $("#stHistHead").textContent = "Henüz AI videosu yok.";
  $("#stHistMore").hidden = st.jobs.length <= st.histN;
  // Olustur sayfasi: son videolar (secili video karti zaten gosteriliyorsa o haric)
  const recent = st.jobs.filter((j) => j.id !== st.view).slice(0, 4);
  $("#stRecent").replaceChildren(...recent.map(histRow));
  $("#stRecentCard").hidden = !recent.length;
}

function histRow(j) {
  const row = el("div", `hist st-hist${j.id === st.view ? " mine" : ""}`);
  row.title = j.prompt || "";
  const meta = el("div", "hist-meta");
  const fix = j.status === "done" ? activeFixFor(j) : null;
  const status = j.status === "done"
    ? (qcBusy(j)
      ? ` · Gemini kontrolü %${Math.round(j.qc_state?.progress || 0)}`
      : fix
        ? ` · AI düzeltiyor %${Math.round(fix.progress || 0)}`
        : "")
    : running(j)
      ? ((j.stage === "qa" || j.stage === "kontrol")
        ? ` · Gemini QA %${Math.round(j.progress || 0)}`
        : ` · %${Math.round(j.progress || 0)}`)
      : (() => {
          const stg = j.stage && STAGES[j.stage] ? `${STAGES[j.stage]} · ` : "";
          const pct = j.progress ? ` %${Math.round(j.progress)}` : "";
          return ` · ${stg}${j.status === "error" ? "hata" : "iptal"}${pct}`;
        })();
  const ig = j.ig?.status === "done" ? "done"
    : ["scheduled", ...IG_BUSY].includes(j.ig?.status) || (j.publish && running(j) && j.ig?.status !== "error") ? "pending" : "";
  const title = el("b", null, `${jobLabel(j)}${j.version > 1 ? ` · v${j.version}` : ""}`);
  if (ig) {
    const dot = el("i", `ig-dot ${ig}`);
    dot.title = ig === "done" ? "Instagram'a yüklendi" : "Instagram'a yüklenecek";
    title.prepend(dot);
  }
  const jp = jobProvider(j);
  meta.append(
    title,
    el("small", null, `${fmtAgo(j.created)} · ${j.mode === "reels" ? "Sadece kes · " : `${provLabel(jp)} · `}${tierLabel(jp, j.tier)}${status}`),
  );
  const open = () => {
    st.view = j.id;
    renderHistory();
    showView(true);
  };
  row.onclick = (e) => { if (!e.target.closest("button")) open(); };
  const th = el("img", "hist-thumb empty");
  th.alt = "";
  if (j.status === "done" && j.render_file && j.exists) {
    th.loading = "lazy";
    th.src = url.renderThumb(j.render_file);
    th.classList.remove("empty");
    th.onerror = () => { th.removeAttribute("src"); th.classList.add("empty"); };
  }
  row.append(th, meta);
  if (!running(j) && !qcBusy(j)) {
    const del = el("button", "icon-btn sm st-del");
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
  return row;
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
  if (scroll && j && st.page !== "create") setPage("create");
  if (!j) return;
  const run = running(j);
  card.dataset.status = j.status;
  $("#stJobTitle").textContent = `${jobLabel(j)}${j.version > 1 ? ` · v${j.version}` : ""}`;
  const reels = j.mode === "reels";
  const jp = jobProvider(j);
  const speech = reels || (j.files || []).some((f) => f.kind === "video");
  $("#stJobMeta").textContent = reels
    ? `Sadece kes · ${j.width}×${j.height} · ${j.duration} sn hedef`
    : `${provLabel(jp)} · ${tierLabel(jp, j.tier)} · ${j.width}×${j.height} · ${j.duration} sn hedef${VOICE_LABEL[j.voice] ? ` · ${VOICE_LABEL[j.voice]} ses` : ""}${j.scenes?.length ? ` · ${j.scenes.length} sahne yenilendi` : ""}`;
  renderPrompts(j);
  // ilerleme
  const prog = $("#stProg");
  prog.hidden = !run && j.status !== "error" && j.status !== "cancelled";
  const pct = Math.round(j.progress || 0);
  $("#stBar").style.width = `${(run || j.status === "error" || j.status === "cancelled") ? pct : 100}%`;
  prog.dataset.status = j.status;
  const isQaStage = run && (j.stage === "qa" || j.stage === "kontrol");
  const isThinking = run && (isQaStage || /düşünüyor|gemini/i.test(j.message || ""));
  prog.classList.toggle("thinking", isThinking);
  const pHead = $("#stProgHead");
  if (pHead) {
    pHead.hidden = !isThinking;
    if (isThinking) $("#stProgTag").textContent = isQaStage ? "Gemini Kontrolü · Düşünüyor" : "AI Düşünüyor";
  }
  const stgName = j.stage && STAGES[j.stage] ? STAGES[j.stage] : "";
  const pctTxt = pct ? ` · %${pct}` : "";
  let msg = j.message || "";
  if (j.status === "queued") msg = j.stage && stgName ? `${stgName} · Kaldığı yerden sırada bekliyor…` : "Sırada bekliyor…";
  else if (j.status === "error") msg = `${stgName ? `${stgName} aşamasında hata` : "Hata"}: ${j.error || "bilinmeyen"}${pctTxt}`;
  else if (j.status === "cancelled") msg = `${stgName ? `${stgName} aşamasında durduruldu` : "İptal edildi"}${pctTxt}`;
  else if (run) msg = `${msg} · %${pct}`;
  $("#stMsg").textContent = msg;
  $("#stCancel").hidden = !run;
  const resBtn = $("#stResume");
  if (resBtn) {
    resBtn.hidden = !j.can_resume;
    resBtn.disabled = false;
    resBtn.textContent = "Kaldığı Yerden Devam Et";
  }
  const showSteps = run || ((j.status === "error" || j.status === "cancelled") && Boolean(j.stage));
  $("#stSteps").querySelectorAll("i").forEach((s) => {
    const keys = Object.keys(STAGES);
    const cur = keys.indexOf(j.stage);
    const k = keys.indexOf(s.dataset.k);
    s.hidden = (s.dataset.k === "yayin" && !j.publish)
      || (s.dataset.k === "kontrol" && j.stage !== "kontrol")
      || (s.dataset.k === "qa" && j.opts?.auto_review === false && j.stage !== "qa")
      || (reels && ["ses", "sahneler"].includes(s.dataset.k))
      || (!reels && ((s.dataset.k === "konusma" && !speech) || (s.dataset.k === "ses" && (j.voice || "off") === "off")));
    if (j.status === "done") s.className = "done";
    else if (cur >= 0 && k < cur) s.className = "done";
    else if (cur >= 0 && k === cur) {
      s.className = j.status === "error" ? "err" : j.status === "cancelled" ? "paused" : "on";
    } else s.className = "";
  });
  $("#stSteps").hidden = !showSteps;
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
    dl.href = "#";
    dl.onclick = (e) => { e.preventDefault(); if (file) downloadRender(file); };
    $("#stOpen").disabled = !j.project_id;
    renderQcState(j, reels);
    renderQc(j, reels);
    $("#stReviseBox").hidden = reels;
    $("#stRetryBox").hidden = !reels;
    if (!reels) loadScenes(j);
    showIg(j);
  }
  showYt(j);
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

// Videonun YouTube Shorts durumu: Instagram'la ayni anda yuklenir; hata/yuklenmediyse elle yukle dugmesi
function showYt(j) {
  const yt = j.yt || {};
  const row = $("#stYtRow");
  const msg = $("#stYtMsg");
  const btn = $("#stYtBtn");
  const t = ytTarget(j.opts?.brand && typeof j.opts.brand === "string" ? j.opts.brand : getBrand()?.id);
  msg.textContent = "";
  msg.className = `st-ig-msg ${yt.status || ""}`;
  if (ytBusy(j)) msg.textContent = `YouTube: ${yt.message || "yükleniyor"}…`;
  else if (yt.status === "done") {
    msg.textContent = `YouTube'da yayınlandı · ${yt.channel || ""} `;
    if (yt.url) {
      const a = el("a", "", "Aç");
      a.href = yt.url;
      a.target = "_blank";
      a.rel = "noopener";
      msg.append(a);
    }
  } else if (yt.status === "error") msg.textContent = `YouTube'a yüklenemedi: ${yt.message || ""}`;
  else if (t.linked && t.auto && (j.ig?.status === "scheduled" || (j.publish && running(j)))) {
    msg.textContent = `Instagram'la aynı anda ${t.channel.title} YouTube kanalına da yüklenecek.`;
  }
  msg.hidden = !msg.textContent;
  btn.hidden = j.status !== "done" || ytBusy(j) || yt.status === "done" || !t.linked || !j.exists;
  btn.textContent = yt.status === "error" ? "YouTube'a tekrar yükle" : `YouTube'a yükle · ${t.channel?.title || ""}`;
  row.hidden = msg.hidden && btn.hidden;
}

async function publishYt() {
  const j = st.jobs.find((x) => x.id === st.view);
  const btn = $("#stYtBtn");
  if (!j || btn.disabled) return;
  btn.disabled = true;
  try {
    upsert(await api(`/api/studio/jobs/${j.id}/youtube`, { method: "POST" }));
    showView();
    poll();
  } catch (e) {
    toast(e.message, 5000);
  } finally {
    btn.disabled = false;
  }
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
  $("#stReviseGo").disabled = st.rfiles.some((f) => !f.ref && !f.error);
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
  toast("Ayarları değiştirip \"Kes ve oluştur\"a bas", 3500);
}

async function revise() {
  const j = st.jobs.find((x) => x.id === st.view);
  const box = $("#stRevise");
  const text = box.value.trim();
  const scenes = [...st.pick];
  const files = st.rfiles.filter((f) => f.ref).map((f) => ({ ref: f.ref, name: f.name }));
  if (st.rfiles.some((f) => !f.ref && !f.error)) {
    toast("Dosyalar yükleniyor, bitmesini bekle");
    return;
  }
  if (!j || (!text && !scenes.length)) {
    toast("Neyin değişmesini istediğini yaz ya da sahne seç");
    return;
  }
  const b = $("#stReviseGo");
  b.disabled = true;
  try {
    const n = await api("/api/studio/jobs", { method: "POST", body: {
      prompt: text, tier: st.tier, provider: st.provider, voice: st.voice, files, parent: j.id, scenes,
    } });
    box.value = "";
    st.rfiles = [];
    renderFiles();
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
$("#stDrive").innerHTML = `${icon("drive")}<span>Drive</span>`;
$("#stGear").innerHTML = icon("sliders");
$("#stGo").insertAdjacentHTML("afterbegin", icon("magic"));
$("#aiNew").onclick = () => openStudio();
$("#npAI").onclick = () => openStudio();
$("#stUpload").onclick = () => $("#stFileInput").click();
$("#stFileInput").onchange = (e) => {
  addLocalFiles([...e.target.files]);
  e.target.value = "";
};
$("#stDrive").onclick = () => { pickRevise = false; openMedia("video,image,audio", "studio"); };
$("#stReviseUpload").innerHTML = `${icon("attach")}<span>Dosya ekle</span>`;
$("#stReviseDrive").innerHTML = `${icon("drive")}<span>Drive'dan seç</span>`;
$("#stReviseUpload").onclick = () => $("#stReviseInput").click();
$("#stReviseInput").onchange = (e) => {
  addLocalFiles([...e.target.files], st.rfiles);
  e.target.value = "";
};
$("#stReviseDrive").onclick = () => { pickRevise = true; openMedia("video,image,audio", "studio"); };
$("#stGo").onclick = () => submit();
$("#stIgBtn").onclick = publishNow;
$("#stYtBtn").onclick = publishYt;
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
$("#stResume").onclick = async () => {
  const jid = st.view;
  if (!jid) return;
  const btn = $("#stResume");
  btn.disabled = true;
  btn.textContent = "Devam ettiriliyor…";
  try {
    const updated = await api(`/api/studio/jobs/${jid}/resume`, { method: "POST" });
    const idx = st.jobs.findIndex((x) => x.id === jid);
    if (idx >= 0) st.jobs[idx] = updated;
    else st.jobs.unshift(updated);
    showView(updated);
    renderHistory();
    if (!st.polling) poll();
  } catch (e) {
    toast(e.message);
    btn.disabled = false;
    btn.textContent = "Kaldığı Yerden Devam Et";
  }
};
$("#stOpen").onclick = openInEditor;
// ---- gunluk otomatik Reels + Gemini manuel kalite kontrolu ----
// ---- ogrenme hafizasi: Reels sonuclari + QC hatalari -> AI Studyo kurallari ----
const CAT_TR = { hook: "açılış", story: "hikâye", pacing: "tempo", visual: "görsel", text: "yazı", audio: "ses", product: "ürün", topic: "konu" };
const FMT_TR = { story: "Hikâye", short_pov: "Kısa POV", direct_ad: "Doğrudan Reklam", all: "Tümü" };
const EXP_TR = { active: "Sürüyor", won: "Kazandı", lost: "Kaybetti", dropped: "Bırakıldı" };
const ERR_TR = {
  dead_air: "Sessiz boşluk", slow_hook: "Yavaş açılış", echo_caption: "Konuşma ekranda tekrar", caption_band: "Altyazı bandına taşma",
  overlap: "Üst üste binen öğe", clipped: "Taşan / kesilen yazı", contrast: "Düşük kontrast", small_text: "Küçük yazı",
  empty_frame: "Boş / kararan ilk kare", product_leak: "Ürünün erken görünmesi", code_leak: "Ekrana sızan kod", spelling: "Yazım hatası",
  tts: "Seslendirme hatası", end_card: "Gereksiz kapanış", fragmented_flow: "Bölük pörçük akış / bütünlük",
  visual_mismatch: "Ses–görsel uyumsuzluğu", other: "Diğer",
};
let learnTimer = 0;

async function loadLearning() {
  try { st.learning = await api("/api/studio/learning"); } catch { st.learning = null; }
  renderLearning();
}

async function learnAct(path, body, method = "PUT") {
  try {
    st.learning = await api(`/api/studio/learning${path}`, { method, body });
    renderLearning();
  } catch (e) { toast(e.message || "İşlem yapılamadı", 3500); }
}

function learnSection(title, ...kids) {
  const s = el("div", "st-learn-sec");
  s.append(el("div", "st-learn-h", title), ...kids);
  return s;
}

function renderLearning() {
  const d = st.learning;
  const sub = $("#stLearnSub"), body = $("#stLearnBody"), badge = $("#stLearnBadge"), btn = $("#stLearnRun");
  clearTimeout(learnTimer);
  if (!d) { sub.textContent = "Öğrenme bilgisi alınamadı"; badge.textContent = "—"; body.replaceChildren(); return; }
  const active = d.rules.filter((r) => r.status === "active" && r.lock !== "off");
  badge.textContent = d.busy ? "Öğreniyor…" : d.at ? `${active.length} öneri` : "Henüz öğrenmedi";
  btn.disabled = d.busy;
  const ranked = d.reels.filter((x) => ["win", "mid", "lose"].includes(x.tier));
  const aiName = d.ai?.label || "AI";
  const nightly = `Her gece 00:00'da ${aiName} ile otomatik öğrenir`;
  sub.textContent = d.busy ? `${aiName} en çok ve en az izlenen Reels'leri inceliyor (${ranked.length} video)…`
    : d.error ? `${d.error} · ${nightly}`
      : d.at ? `${fmtAgo(d.at)} güncellendi · ${ranked.length} Reels'ten öğrenildi · ${nightly}`
        : `Henüz öğrenme turu yapılmadı. ${nightly}; beklemeden "Şimdi öğren" ile başlatabilirsin (birkaç dakika sürer).`;
  if (d.busy) learnTimer = setTimeout(loadLearning, 8000);

  const kids = [];
  if (d.summary) kids.push(learnSection("Özet", el("p", "st-learn-p", d.summary)));

  const pLabels = d.product_labels || {};
  const pName = (pid) => pLabels[pid] || pid || "Genel";
  const renderRuleCard = (r) => {
    const row = el("div", `st-rule ${r.kind} ${r.lock || ""} ${r.status}`);
    const head = el("div", "st-rule-head");
    head.append(el("span", `st-chip ${r.kind}`, r.kind === "avoid" ? "Kaçın" : "Yap"), el("span", "st-chip", CAT_TR[r.cat] || r.cat));
    if (r.format && r.format !== "all") head.append(el("span", "st-chip", FMT_TR[r.format] || r.format));
    if ((r.scope || "product") === "global") head.append(el("span", "st-chip", "Global"));
    else if (r.product_id) head.append(el("span", "st-chip", pName(r.product_id)));
    const score = el("span", "st-rule-score", r.lock === "off" ? "Kapalı" : r.status === "retired" ? "Emekli" : "●".repeat(Math.max(1, Math.min(5, Math.round(r.score)))));
    score.title = "Doğrulandıkça artar, çelişen veri geldikçe düşer";
    head.append(score);
    const acts = el("span", "st-rule-acts");
    const mk = (label, lock, title) => { const b = el("button", "btn ghost xs", label); b.type = "button"; b.title = title; b.onclick = () => learnAct(`/rules/${r.id}`, { lock }); return b; };
    if (r.lock !== "off") acts.append(mk("Kapat", "off", "Bu öneri kullanılmaz ve AI yeniden eklemez"));
    if (r.lock) acts.append(mk("AI'a bırak", "", "Öneri yeniden AI tarafından yönetilir"));
    head.append(acts);
    row.append(head, el("div", "st-rule-text", r.text));
    const last = (r.hist || []).at(-1);
    if (r.evidence || last?.note) row.append(el("div", "st-rule-ev", [r.evidence && `Kanıt: ${r.evidence}`, last?.note].filter(Boolean).join(" · ")));
    return row;
  };

  // kurallar: Global (Tum Urunler) vs Urun Bazli
  const gRules = d.rules.filter((r) => (r.scope || "product") === "global");
  const pRules = d.rules.filter((r) => (r.scope || "product") !== "global");
  const gl = el("div", "st-learn-list");
  for (const r of gRules) gl.append(renderRuleCard(r));
  if (!gRules.length) gl.append(el("div", "panel-note", "Henüz global öneri yok."));
  kids.push(learnSection(`Global Öneriler — Tüm Ürünler (${gRules.filter((r) => r.status === "active" && r.lock !== "off").length} aktif)`, gl));

  const byProd = new Map();
  for (const r of pRules) {
    const pid = r.product_id || "genel";
    if (!byProd.has(pid)) byProd.set(pid, []);
    byProd.get(pid).push(r);
  }
  const pl = el("div", "st-learn-list");
  for (const [pid, list] of byProd.entries()) {
    pl.append(el("div", "st-rule-ev", `${pName(pid)} (${pid})`));
    for (const r of list) pl.append(renderRuleCard(r));
  }
  if (!pRules.length) pl.append(el("div", "panel-note", "Henüz ürün bazlı öneri yok."));
  kids.push(learnSection(`Ürün Bazlı Öneriler (${pRules.filter((r) => r.status === "active" && r.lock !== "off").length} aktif${d.retired ? `, ${d.retired} emekli` : ""})`, pl));

  // deneyler
  if (d.experiments.length) {
    const el2 = el("div", "st-learn-list");
    for (const e of d.experiments) {
      const row = el("div", `st-rule exp ${e.status}`);
      const head = el("div", "st-rule-head");
      const eScope = (e.scope || "product") === "global" ? "Global" : pName(e.product_id);
      head.append(el("span", `st-chip exp-${e.status}`, EXP_TR[e.status] || e.status), el("span", "st-chip", e.id),
        el("span", "st-chip", eScope),
        el("span", "st-rule-score", `${(e.trials || []).length} ölçüm · ${e.assigned || 0} video`));
      if (e.status === "active") {
        const b = el("button", "btn ghost xs", "Bırak"); b.type = "button"; b.onclick = () => learnAct(`/experiments/${e.id}`, { status: "dropped" });
        const acts = el("span", "st-rule-acts"); acts.append(b); head.append(acts);
      }
      row.append(head, el("div", "st-rule-text", e.instruction));
      const tr = (e.trials || []).map((t) => `#${t.n}: ${t.delta >= 0 ? "+" : ""}${t.delta}`).join(", ");
      if (e.hypothesis || tr) row.append(el("div", "st-rule-ev", [e.hypothesis, tr && `Sonuç (perf farkı): ${tr}`].filter(Boolean).join(" · ")));
      el2.append(row);
    }
    kids.push(learnSection("Deneyler (ürün bazlı · günlük otomatik Reels'te sırayla tek değişken denenir)", el2));
  }

  // en cok / en az izlenenler
  if (d.reels.length) {
    const tbl = el("div", "st-learn-reels");
    const tierTxt = { win: "Kazanan", lose: "Zayıf", mid: "Orta", new: "Yeni", boosted: "Reklamlı", fault: "Teknik Hata" };
    for (const x of d.reels) {
      const row = el(x.permalink ? "a" : "div", `st-reel ${x.tier}`);
      if (x.permalink) { row.href = x.permalink; row.target = "_blank"; row.rel = "noopener"; }
      row.append(
        el("span", `st-chip t-${x.tier}`, tierTxt[x.tier] || x.tier),
        el("span", "st-chip", pName(x.product_id)),
        el("span", "st-chip", FMT_TR[x.format] || x.format || "Hikâye"),
        el("b", "", `#${x.n}`),
        el("span", "st-reel-title", x.title || "—"),
        el("span", "st-reel-num", `${x.views.toLocaleString("tr-TR")} izl. · geçme %${x.skip ?? "-"} · tutma %${x.hold ?? "-"} · etk. %${x.eng_rate ?? 0} · ${x.dur} sn · perf ${x.perf}`),
      );
      if (x.lesson) row.append(el("span", "st-reel-lesson", x.lesson));
      tbl.append(row);
    }
    const tp = d.topics || {};
    const extra = [];
    if (tp.win?.length) extra.push(el("div", "st-rule-ev", `İşe yarayan konular: ${tp.win.join(" · ")}`));
    if (tp.lose?.length) extra.push(el("div", "st-rule-ev", `Tutmayan konular: ${tp.lose.join(" · ")}`));
    kids.push(learnSection("Reels sıralaması (ürün + format bazlı dilim · perf = %55 izl. + %15 geçme + %15 tutma + %15 etk.)", tbl, ...extra));
  }

  // tasarim karsilastirmasi (urun + format bazli, n>=5)
  const cmp = (d.contrast || []).filter((c) => c.win != null && c.lose != null);
  if (cmp.length) {
    const t = el("table", "st-learn-cmp");
    const hr = el("tr"); for (const h of ["Tasarım özelliği", "Kazananlar", "Zayıflar", "perf ilişkisi"]) hr.append(el("th", "", h));
    t.append(hr);
    const f = (v, u) => (u === "oran" ? `%${Math.round(v * 100)}` : `${v}${u && u !== "oran" ? " " + u : ""}`);
    for (const c of cmp.slice(0, 12)) {
      const tr = el("tr");
      const r = c.corr == null ? "—" : `${c.corr > 0 ? "+" : ""}${c.corr}`;
      const td = el("td", Math.abs(c.corr || 0) >= 0.3 ? (c.corr > 0 ? "pos" : "neg") : "", r);
      tr.append(el("td", "", c.label), el("td", "", f(c.win, c.unit)), el("td", "", f(c.lose, c.unit)), td);
      t.append(tr);
    }
    const fmtLabel = FMT_TR[cmp[0]?.format] || "Hikâye";
    const prodTag = cmp[0]?.product_id && cmp[0].product_id !== "all" ? `${pName(cmp[0].product_id)} · ` : "";
    kids.push(learnSection(`Tasarım karşılaştırması — ${prodTag}${fmtLabel} formatı (n ≥ 5)`, t,
      el("div", "panel-note", "İlişki: −1…+1 Spearman sıra korelasyonu (aynı ürün + format içinde); ±0,3'ün altı gürültü sayılır.")));
  }

  // tekrar eden hatalar
  if (d.mistakes?.length) {
    const ml = el("div", "st-learn-list");
    for (const m of d.mistakes) {
      const row = el("div", "st-rule err");
      const head = el("div", "st-rule-head");
      head.append(el("span", "st-chip avoid", `${m.count} video`), el("b", "", ERR_TR[m.code] || m.code));
      row.append(head);
      if (m.example) row.append(el("div", "st-rule-ev", `Son örnek: ${m.example}`));
      ml.append(row);
    }
    kids.push(learnSection("Kalite kontrolün yakaladığı hatalar (2+ videoda görülenler üreticiye ve kontrole uyarı olarak gider)", ml));
  }

  if (d.runs?.length) {
    const rr = el("div", "st-learn-list");
    for (const r of d.runs) rr.append(el("div", "st-rule-ev", `${fmtAgo(r.at)} · ${r.n} Reels · ${(r.changes || []).slice(0, 8).join(" · ") || "değişiklik yok"}`));
    kids.push(learnSection("Son öğrenme turları", rr));
  }
  body.replaceChildren(...kids);
}

$("#stLearnExport").onclick = async () => {
  const btn = $("#stLearnExport");
  if (btn.disabled) return;
  btn.disabled = true;
  try {
    const text = await api("/api/studio/learning/export");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/markdown;charset=utf-8" }));
    a.download = `ogrenme-hafizasi-${new Date().toISOString().slice(0, 10)}.md`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    toast("Öğrenme hafızası indirildi (.md)");
  } catch (e) {
    toast(e.message || "İndirilemedi", 4000);
  } finally {
    btn.disabled = false;
  }
};

$("#stLearnRun").onclick = async () => {
  $("#stLearnRun").disabled = true;
  await learnAct("/run", undefined, "POST");
};

async function loadAutoTimer() {
  try {
    st.autoTimer = await api("/api/studio/auto-timer");
  } catch (e) {
    st.autoTimer = null;
  }
  renderAutoTimer();
}

function renderAutoTimer() {
  const data = st.autoTimer;
  if (!data?.config) {
    $("#stAutoBadge").textContent = "—";
    $("#stAutoSub").textContent = "Zamanlayıcı bilgisi alınamadı";
    return;
  }
  const c = data.config;
  const sched = data.schedule;
  const workTimes = cfgTimes(c, "workday");
  const holTimes = cfgTimes(c, "holiday");
  const workTime = workTimes[0];
  $("#stAutoOn").checked = Boolean(c.enabled);
  $("#stAutoBadge").textContent = c.enabled ? "Açık" : "Kapalı";
  renderAutoList("#stAutoWorkList", workTimes);
  renderAutoList("#stAutoHolList", holTimes);
  const maxN = data.max_per_day || 8;
  $("#stAutoCount").textContent = String(workTimes.length);
  $("#stAutoCountMinus").disabled = workTimes.length <= 1;
  $("#stAutoCountPlus").disabled = workTimes.length >= maxN;
  $("#stAutoWorkWrap").classList.toggle("on", Boolean(sched && !sched.is_holiday));
  $("#stAutoHolWrap").classList.toggle("on", Boolean(sched && sched.is_holiday));
  const curBrand = getBrand();
  const effBrand = data.brand || c.brand;
  const effProduct = data.product !== undefined ? data.product : c.product;
  const bLabel = effBrand === "engrare" ? "Engrare 3D" : (curBrand?.id === effBrand ? curBrand.name : (effBrand || "Marka"));
  const matchedProd = curBrand?.products?.find((p) => p.id === effProduct);
  const pLabel = matchedProd?.name || (effProduct === "numarator" ? "Araba İçi Numaratör" : (effProduct || "Genel"));
  const activeProv = data.provider || st.provider || "claude";
  const vLabel = (VOICES.find(([v]) => v === (data.voice || c.voice)) || [])[1] || "";
  $("#stAutoTarget").textContent = `${bLabel} · ${pLabel} · ${provLabel(activeProv)} ${tierLabel(activeProv, c.tier || 3)}${vLabel ? ` · ${vLabel}` : ""}`;

  const cpEl = $("#stAutoCustomPrompt");
  const tpEl = $("#stAutoTopicPrompt");
  if (document.activeElement !== cpEl) cpEl.value = c.custom_prompt || "";
  if (document.activeElement !== tpEl) {
    tpEl.value = (c.topic_prompt || "").trim() ? c.topic_prompt : (data.default_topic_prompt || "");
  }
  $("#stAutoCustomTag").hidden = !(c.custom_prompt || "").trim() && !(c.topic_prompt || "").trim();

  const sub = $("#stAutoSub");
  sub.textContent = "";
  const activeTimes = sched?.active_times || [sched?.active_time || workTime];
  const slots = data.slots_today || [];
  if (slots.length > 1) {
    const chips = el("div", "st-auto-slots");
    for (const sl of slots) {
      const [txt, cls] = SLOT_LABEL[sl.status] || ["", ""];
      const chip = el("span", `st-auto-chip ${cls}`, txt ? `${sl.time} · ${txt}` : sl.time);
      if (sl.message) chip.title = sl.message;
      chips.append(chip);
    }
    sub.append(chips);
  }
  const dayPrefix = sched ? `Bugün: ${sched.day_label} (${activeTimes.join(", ")}) · ` : "";
  const idle = activeTimes.length > 1
    ? `Her saatte o ana kadar hedeflenen sayıda Reels yoksa öğrenilen önerilerle yeni bir Reels üretip yükler (bugün ${data.today_count || 0}/${activeTimes.length}).`
    : `Paylaşım yoksa saat ${activeTimes[0]} itibarıyla öğrenilen önerilerle otomatik Reels üretip yükler.`;
  const msg = activeTimes.length <= 1 && data.today_posted
    ? (data.activity_reason || "Bugün paylaşım yapılmış.")
    : (c.last_message || idle);
  sub.append(`${dayPrefix}${msg}`);
  if (data.last_job?.id) {
    const link = el("button", "st-auto-link", "Videoyu aç");
    link.type = "button";
    link.onclick = () => {
      upsert(data.last_job);
      st.view = data.last_job.id;
      renderHistory();
      showView(true);
      poll();
    };
    sub.append(link);
  }
}

const SLOT_LABEL = {
  posted: ["yayında ✓", "ok"],
  triggered: ["üretiliyor", "run"],
  skipped_posted: ["zaten var", ""],
  quota_wait: ["kota bekleniyor", "run"],
  missed: ["atlandı", "err"],
  error: ["hata", "err"],
};

function cfgTimes(c, kind) {
  const list = c[`${kind}_times`];
  if (Array.isArray(list) && list.length) return list;
  return [c[`${kind}_time`] || c.time || "20:00"];
}

function listTimes(sel) {
  return [...$(sel).querySelectorAll("input")].map((i) => i.value || "20:00");
}

function renderAutoList(sel, times) {
  const box = $(sel);
  if (box.contains(document.activeElement)) return;
  if (box.children.length === times.length && listTimes(sel).join() === times.join()) return;
  box.textContent = "";
  times.forEach((t, i) => {
    const row = el("label", "st-auto-slot");
    if (times.length > 1) row.append(el("em", "", `${i + 1}.`));
    const inp = document.createElement("input");
    inp.type = "time";
    inp.value = t;
    row.append(inp);
    box.append(row);
  });
}

// Yeni eklenen Reels icin bos saat: son saatin 2 saat sonrasi, sigmazsa gundeki en buyuk boslugun ortasi
function nextFreeTime(times) {
  const toMin = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
  const fmt = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  const used = new Set(times.map(toMin));
  const last = Math.max(...used);
  for (const step of [120, 60, 30]) {
    const m = last + step;
    if (m < 1440 && !used.has(m)) return fmt(m);
  }
  const pts = [...new Set([0, ...used, 1440])].sort((a, b) => a - b);
  let best = [0, 1440];
  for (let i = 1; i < pts.length; i++) if (pts[i] - pts[i - 1] > best[1] - best[0]) best = [pts[i - 1], pts[i]];
  return fmt(Math.min(1435, Math.floor((best[0] + best[1]) / 2 / 5) * 5));
}

function changeAutoCount(delta) {
  const work = listTimes("#stAutoWorkList").sort();
  const hol = listTimes("#stAutoHolList").sort();
  const n = work.length + delta;
  if (n < 1 || n > (st.autoTimer?.max_per_day || 8)) return;
  if (delta > 0) {
    work.push(nextFreeTime(work));
    hol.push(nextFreeTime(hol));
  } else {
    work.pop();
    hol.pop();
  }
  saveAutoTimer(`Günde ${n} Reels`, { per_day: n, workday_times: work, holiday_times: hol });
}

function autoFormBody(reset = false) {
  const work = listTimes("#stAutoWorkList");
  return {
    enabled: $("#stAutoOn").checked,
    per_day: work.length || 1,
    workday_times: work,
    holiday_times: listTimes("#stAutoHolList"),
    custom_prompt: reset ? "" : $("#stAutoCustomPrompt").value,
    ...(reset ? { reset_topic_prompt: true } : { topic_prompt: $("#stAutoTopicPrompt").value }),
  };
}

async function saveAutoTimer(msg = "", extra = null) {
  try {
    st.autoTimer = await api("/api/studio/auto-timer", { method: "PUT", body: { ...autoFormBody(false), ...(extra || {}) } });
    renderAutoTimer();
    if (msg) toast(msg);
  } catch (e) {
    toast(e.message, 4000);
    await loadAutoTimer();
  }
}

async function saveAutoPrompts(reset = false) {
  const saveBtn = $("#stAutoPromptSave");
  const resetBtn = $("#stAutoPromptReset");
  saveBtn.disabled = true;
  resetBtn.disabled = true;
  try {
    st.autoTimer = await api("/api/studio/auto-timer", { method: "PUT", body: autoFormBody(reset) });
    $("#stAutoCustomPrompt").value = st.autoTimer.config?.custom_prompt || "";
    $("#stAutoTopicPrompt").value = (st.autoTimer.config?.topic_prompt || "").trim()
      ? st.autoTimer.config.topic_prompt
      : (st.autoTimer.default_topic_prompt || "");
    renderAutoTimer();
    toast(reset ? "Otomatik Reels istemleri varsayılana döndürüldü" : "Otomatik Reels istemi kaydedildi");
  } catch (e) {
    toast(e.message, 4000);
  } finally {
    saveBtn.disabled = false;
    resetBtn.disabled = false;
  }
}

async function runAutoTimer() {
  const btn = $("#stAutoRun");
  if (btn.disabled) return;
  btn.disabled = true;
  try {
    // Ekrandaki saat veya istem degisikligi henuz kaydedilmediyse calistirmadan once kaydet
    const cur = st.autoTimer?.config;
    const cp = $("#stAutoCustomPrompt").value.trim();
    const tp = $("#stAutoTopicPrompt").value.trim();
    const defTp = (st.autoTimer?.default_topic_prompt || "").trim();
    const savedTp = (cur?.topic_prompt || "").trim() || defTp;
    const wt = listTimes("#stAutoWorkList").sort().join();
    const ht = listTimes("#stAutoHolList").sort().join();
    if (cur && (wt !== cfgTimes(cur, "workday").join()
      || ht !== cfgTimes(cur, "holiday").join()
      || cp !== (cur.custom_prompt || "").trim()
      || tp !== savedTp
      || $("#stAutoOn").checked !== Boolean(cur.enabled))) {
      st.autoTimer = await api("/api/studio/auto-timer", { method: "PUT", body: autoFormBody(false) });
      renderAutoTimer();
    }
    let res = await api("/api/studio/auto-timer/run-now", { method: "POST", body: { force: false } });
    st.autoTimer = res;
    renderAutoTimer();
    if (!res.ran && res.reason) {
      const goForce = await confirmBox({
        title: (res.slots_today?.length || 1) > 1 ? "Bugünkü Reels hedefi dolmuş görünüyor" : "Bugün zaten paylaşım görünüyor",
        text: `${res.reason}\n\nYine de şimdi yeni bir 3 adımlı hikaye Reels'i üretilip Instagram'a yüklensin mi?`,
        ok: "Yine de üret",
        cancel: "Vazgeç",
      });
      if (!goForce) return;
      res = await api("/api/studio/auto-timer/run-now", { method: "POST", body: { force: true } });
      st.autoTimer = res;
      renderAutoTimer();
    }
    if (res.job?.id) {
      upsert(res.job);
      st.view = res.job.id;
      renderHistory();
      showView(true);
      poll();
      toast("Otomatik Reels üretimi başlatıldı");
    }
  } catch (e) {
    toast(e.message, 4000);
  } finally {
    btn.disabled = false;
  }
}

function renderQcState(j, reels = false) {
  const btn = $("#stQcBtn");
  const prog = $("#stQcProg");
  if (reels) {
    btn.hidden = true;
    prog.hidden = true;
    return;
  }
  const fix = activeFixFor(j);
  const qBusy = qcBusy(j);
  const starting = st.qcSubmitting === j.id;
  const qs = j.qc_state || null;
  const qcErr = !qBusy && !fix && !starting && qs?.status === "error"
    && (!j.qc?.checked_at || (qs.finished || 0) >= j.qc.checked_at);

  btn.hidden = false;
  btn.disabled = qBusy || Boolean(fix) || starting;
  btn.textContent = fix
    ? "AI düzeltme yapıyor…"
    : qBusy
      ? "Gemini kontrolü sürüyor…"
      : starting
        ? "Gemini başlatılıyor…"
        : "Gemini Kontrolü & Düzelt";

  prog.hidden = !qBusy && !fix && !starting && !qcErr;
  if (prog.hidden) {
    prog.classList.remove("thinking");
    return;
  }

  const openBtn = $("#stQcOpenFix");
  const tagEl = $("#stQcTag");
  const pctEl = $("#stQcPct");
  prog.classList.toggle("thinking", Boolean(fix || qBusy || starting));
  if (fix) {
    const p = Math.max(2, Math.round(fix.progress || 0));
    prog.dataset.status = fix.status;
    $("#stQcBar").style.width = `${p}%`;
    if (tagEl) tagEl.textContent = "AI Düzeltme · Çalışıyor";
    if (pctEl) pctEl.textContent = `%${p}`;
    const ver = fix.version > 1 ? `v${fix.version} · ` : "";
    const m = fix.status === "queued" ? "Sırada bekliyor…" : (fix.message || "Düzeltme hazırlanıyor");
    $("#stQcMsg").textContent = `${ver}${m}`;
    openBtn.hidden = false;
    openBtn.onclick = () => {
      st.view = fix.id;
      renderHistory();
      showView(true);
    };
  } else if (qBusy || starting) {
    const p = qBusy ? Math.max(2, Math.round(qs?.progress || 0)) : 2;
    prog.dataset.status = qs?.status || "running";
    $("#stQcBar").style.width = `${p}%`;
    if (tagEl) tagEl.textContent = starting ? "Gemini Kontrolü · Başlatılıyor" : "Gemini Kontrolü · Düşünüyor";
    if (pctEl) pctEl.textContent = `%${p}`;
    const m = qs?.message || "Gemini kontrolü başlatılıyor · düşünüyor";
    $("#stQcMsg").textContent = m;
    openBtn.hidden = true;
  } else if (qcErr) {
    prog.dataset.status = "error";
    $("#stQcBar").style.width = "100%";
    if (tagEl) tagEl.textContent = "Gemini Kontrolü · Hata";
    if (pctEl) pctEl.textContent = "";
    $("#stQcMsg").textContent = `Hata: ${qs.error || qs.message || "Gemini kontrolü tamamlanamadı"}`;
    openBtn.hidden = true;
  }
}

function renderQc(j, _reels = false) {
  const box = $("#stQcBox");
  box.textContent = "";
  const q = j?.qc || null;
  box.hidden = !q;
  if (!q) return;
  const skipped = q.qa_status === "skipped_rate_limit";
  box.className = `st-qc ${skipped ? "skip" : q.ok ? "ok" : "warn"}`;
  const rev = Number(q.revisions || 0);
  const fixed = q.fixed_items || [];
  const qaDurum = q.qa_label
    || (skipped ? "Kota Nedeniyle Atlandı"
      : q.qa_status === "auto_fixed" || (rev > 0 && fixed.length) ? `Otomatik Düzeltildi (${rev || 1} revize)`
      : q.ok ? "Geçti" : "Kontrol Uyarısı");
  const head = el("div", "st-qc-head");
  const scoreTxt = q.score ? ` · ${q.score}/10` : "";
  head.append(el("span", null, `Gemini QA Denetim Raporu${scoreTxt}`), el("span", null, qaDurum));
  const durumRow = el("div", "st-qc-row");
  durumRow.append(el("strong", null, "QA Durumu: "), document.createTextNode(qaDurum));
  box.append(head, durumRow);
  if (q.coherence_check) {
    const c = q.coherence_check;
    const cohRow = el("div", "st-qc-row");
    cohRow.append(
      el("strong", null, `Bütünlük ve Akış (${c.score}/5): `),
      document.createTextNode(`Akış ${c.narrative_flow}/5 · Ses–Görsel ${c.audio_visual_sync}/5 · Görsel Uyum ${c.visual_consistency}/5 · İlk Netlik ${c.first_watch_clarity}/5`),
    );
    box.append(cohRow);
  }
  if (q.publish_blocked) {
    const blkRow = el("div", "st-qc-row");
    blkRow.append(
      el("strong", null, "Yayın Durduruldu (Taslakta Bekliyor): "),
      document.createTextNode(q.publish_block_reason || "Bütünlük/akış denetimi geçemediği için otomatik yayın durduruldu."),
    );
    box.append(blkRow);
  }
  if (q.summary) box.append(el("div", null, q.summary));
  if (fixed.length) {
    const fUl = document.createElement("ul");
    for (const item of fixed) fUl.append(el("li", null, item));
    box.append(el("div", "st-qc-sub", "Düzeltilen Maddeler:"), fUl);
  }
  if ((q.issues || []).length) {
    const ul = document.createElement("ul");
    for (const it of q.issues) {
      ul.append(el("li", null, `[${it.scene || "genel"}] ${it.fix || ""}`));
    }
    box.append(el("div", "st-qc-sub", fixed.length ? "Kalan Bulgular:" : "Tespitler:"), ul);
  }
}

async function runManualQc() {
  const j = st.jobs.find((x) => x.id === st.view);
  const btn = $("#stQcBtn");
  if (!j || btn.disabled || st.qcSubmitting === j.id || qcBusy(j) || activeFixFor(j)) return;
  st.qcSubmitting = j.id;
  showView();
  try {
    const n = await api(`/api/studio/jobs/${enc(j.id)}/auto-review`, { method: "POST", body: { auto_fix: true } });
    upsert(n);
    renderHistory();
    showView();
    poll();
  } catch (e) {
    toast(e.message, 5000);
    await loadJobs();
  } finally {
    if (st.qcSubmitting === j.id) st.qcSubmitting = null;
    showView();
  }
}

$("#stReviseGo").onclick = revise;
$("#stQcBtn").onclick = runManualQc;
$("#stAiSeg").onclick = (e) => {
  const b = e.target.closest("[data-prov]");
  if (b) setProvider(b.dataset.prov);
};
$("#stSysSave").onclick = () => saveSysPrompt(false);
$("#stSysReset").onclick = () => saveSysPrompt(true);
$("#stAutoOn").onchange = () => saveAutoTimer($("#stAutoOn").checked ? "Otomatik Reels açıldı" : "Otomatik Reels kapatıldı");
$("#stAutoWorkList").onchange = () => saveAutoTimer("İş günü saatleri kaydedildi");
$("#stAutoHolList").onchange = () => saveAutoTimer("Tatil / hafta sonu saatleri kaydedildi");
$("#stAutoCountPlus").onclick = () => changeAutoCount(1);
for (const sel of ["#stAutoWorkList", "#stAutoHolList"]) {
  // Saat secimi bitince listeyi sirali haliyle yeniden ciz
  $(sel).addEventListener("focusout", () => setTimeout(renderAutoTimer, 0));
}
$("#stAutoCountMinus").onclick = () => changeAutoCount(-1);
$("#stAutoPromptSave").onclick = () => saveAutoPrompts(false);
$("#stAutoPromptReset").onclick = () => saveAutoPrompts(true);
$("#stAutoRun").onclick = runAutoTimer;
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
function closeUsage() {
  $("#stUsageCard").hidden = true;
  $("#stUsageChip").classList.remove("on");
}
$("#stUsageChip").onclick = (e) => {
  e.stopPropagation();
  const pop = $("#stUsageCard");
  pop.hidden = !pop.hidden;
  $("#stUsageChip").classList.toggle("on", !pop.hidden);
  if (!pop.hidden) refreshUsage();
};
document.addEventListener("click", (e) => { if (!e.target.closest(".st-usage-wrap")) closeUsage(); });
$("#stNav").onclick = (e) => {
  const b = e.target.closest("[data-pg]");
  if (b) setPage(b.dataset.pg);
};
$("#stGear").onclick = () => setPage(st.page === "settings" ? st.back || "create" : "settings");
$("#stSetBack").onclick = () => setPage(st.back || "create");
$("#stBrandMore").onclick = () => setPage("settings");
$("#stRecentAll").onclick = () => setPage("history");
$("#stHistMore").onclick = () => {
  st.histN += 15;
  renderHistory();
};

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
  $("#stHistSeg").querySelectorAll("[data-hv]").forEach((b) => b.classList.toggle("on", (b.dataset.hv === "covers") === on));
  view.querySelector(".st-hist-page").classList.toggle("covers", on);
  $("#stCovers").hidden = !on;
  if (on) {
    $("#stCoversGrid").replaceChildren(el("div", "muted", "Yükleniyor…"));
    loadCovers();
  }
}
$("#stHistSeg").onclick = (e) => {
  const b = e.target.closest("[data-hv]");
  if (b) showCovers(b.dataset.hv === "covers");
};

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
    onChange: () => { renderPills(); syncGo(); showView(); },
  });
  loadConfig();
  loadSettings();
  loadJobs();
  if (location.hash === "#studio") {
    history.replaceState(null, "", location.pathname + location.search);
    openStudio();
  }
}
