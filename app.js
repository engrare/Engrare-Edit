"use strict";
// Engrare Edit: CapCut tarzi modern mobil video editoru ve timeline motoru.

const API = window.API || location.origin;
const $ = (s) => document.querySelector(s);
const el = (t, c, x) => {
  const e = document.createElement(t);
  if (c) e.className = c;
  if (x != null) e.textContent = x;
  return e;
};

// Timeline olcegi: 1 saniye = 36 piksel
const SCALE = 36;
const MIN_CLIP_WIDTH = 24;

// State
let project = {
  id: null,
  name: "Yeni reels",
  settings: { width: 1080, height: 1920, fps: 30, codec: "h264", qp: 23, abitrate: "192k" },
  clips: [],
  audio: null,
  texts: [],
};

let selectedClipIndex = null;
let currentTime = 0;
let isPlaying = false;
let playAnimFrame = null;
let lastPlayTimestamp = null;
let saveDebounceTimer = null;
let isProgrammaticScroll = false;
let seekAnimFrame = null;

// ---- API YARDIMCILARI ----
async function api(path, opts = {}) {
  opts.credentials = "include";
  if (opts.body && typeof opts.body !== "string") {
    opts.headers = { ...(opts.headers || {}), "content-type": "application/json" };
    opts.body = JSON.stringify(opts.body);
  }
  const r = await fetch(API + path, opts);
  if (!r.ok) {
    let msg = r.statusText;
    try { msg = (await r.json()).detail || msg; } catch (e) {}
    if (r.status === 401 && !path.startsWith("/api/auth/login")) showLogin();
    throw new Error(msg);
  }
  const ct = r.headers.get("content-type") || "";
  return ct.includes("json") ? r.json() : r.text();
}

function fmtTime(s) {
  s = Math.max(0, s || 0);
  const m = Math.floor(s / 60);
  const sec = (s % 60).toFixed(1);
  return `${m}:${sec.padStart(4, "0")}`;
}

function toast(msg, ms = 2200) {
  const t = $("#toast");
  if (!t) return;
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.hidden = true; }, ms);
}

// Medya oynatma URL'si
function getMediaUrl(item) {
  if (!item) return "";
  let p = item.path;
  if (!p && item.src) {
    p = item.src
      .replace(/^\/drive\/engrare-video\/engrare-video-upload\/?/, "")
      .replace(/^\/drive\/?/, "");
  }
  return `${API}/drive/api/download?path=${encodeURIComponent(p || "")}`;
}

// Klip net suresi (kirpma dahil)
function getEffectiveDuration(c) {
  if (!c) return 0;
  const cin = Math.max(0, c.in || 0);
  const cout = c.out != null ? c.out : (c.duration || 3.0);
  return Math.max(0.1, cout - cin);
}

function getTotalDuration() {
  return project.clips.reduce((acc, c) => acc + getEffectiveDuration(c), 0);
}

function getClipWidth(c) {
  const dur = getEffectiveDuration(c);
  return Math.max(MIN_CLIP_WIDTH, Math.round(dur * SCALE));
}

function getTotalTrackPixels() {
  return project.clips.reduce((acc, c) => acc + getClipWidth(c), 0);
}

function getClipAtTime(t) {
  let accum = 0;
  for (let i = 0; i < project.clips.length; i++) {
    const c = project.clips[i];
    const dur = getEffectiveDuration(c);
    if (t < accum + dur || i === project.clips.length - 1) {
      return {
        index: i,
        clip: c,
        clipStart: accum,
        clipDur: dur,
        offset: Math.max(0, Math.min(dur, t - accum)),
      };
    }
    accum += dur;
  }
  return null;
}

// Piksel <-> Zaman donusumleri (CapCut Scrubber Motoru)
function timeToPixels(t) {
  if (!project.clips.length) return 0;
  const totalDur = getTotalDuration();
  if (totalDur <= 0) return 0;
  t = Math.max(0, Math.min(t, totalDur));

  let curPx = 0;
  let curT = 0;
  for (const c of project.clips) {
    const dur = getEffectiveDuration(c);
    const w = getClipWidth(c);
    if (t <= curT + dur) {
      const ratio = dur > 0 ? (t - curT) / dur : 0;
      return curPx + ratio * w;
    }
    curPx += w;
    curT += dur;
  }
  return curPx;
}

function pixelsToTime(px) {
  if (!project.clips.length) return 0;
  const totalDur = getTotalDuration();
  if (totalDur <= 0) return 0;
  const totalPx = getTotalTrackPixels();
  px = Math.max(0, Math.min(px, totalPx));

  let curPx = 0;
  let curT = 0;
  for (const c of project.clips) {
    const w = getClipWidth(c);
    const dur = getEffectiveDuration(c);
    if (px <= curPx + w) {
      const ratio = w > 0 ? (px - curPx) / w : 0;
      return curT + ratio * dur;
    }
    curPx += w;
    curT += dur;
  }
  return totalDur;
}

// ---- GIRIS / CIKIS EKRANI ----
function showLogin() {
  $("#login").hidden = false;
  $("#app").hidden = true;
}

function showApp() {
  $("#login").hidden = true;
  $("#app").hidden = false;
}

$("#loginform").onsubmit = async (e) => {
  e.preventDefault();
  $("#lerr").textContent = "";
  const btn = e.target.querySelector("button");
  btn.disabled = true;
  try {
    await api("/api/auth/login", {
      method: "POST",
      body: { username: $("#lu").value.trim(), password: $("#lp").value },
    });
    await boot();
  } catch (err) {
    $("#lerr").textContent = err.message === "kullanici adi veya sifre hatali"
      ? "Kullanıcı adı veya şifre hatalı" : err.message;
  } finally {
    btn.disabled = false;
  }
};

$("#logout").onclick = async () => {
  closeSheet();
  await api("/api/auth/logout", { method: "POST" });
  showLogin();
};

// ---- CEKMECE PANELLERI (BOTTOM SHEETS) ----
function openSheet(id) {
  document.querySelectorAll(".sheet").forEach((s) => (s.hidden = true));
  const sheet = $(`#${id}`);
  if (sheet) {
    sheet.hidden = false;
    $("#scrim").hidden = false;
  }
}

function closeSheet() {
  document.querySelectorAll(".sheet").forEach((s) => (s.hidden = true));
  $("#scrim").hidden = true;
}

$("#scrim").onclick = closeSheet;
document.querySelectorAll("[data-close]").forEach((b) => {
  b.onclick = closeSheet;
});

// Topbar butonlari
$("#btnMenu").onclick = () => {
  loadProjects();
  openSheet("sheetProjects");
};

// Toolbar arac butonlari
document.querySelectorAll("#toolbar button").forEach((btn) => {
  btn.onclick = () => {
    const tool = btn.dataset.tool;
    if (tool === "media") {
      initDrive();
      openSheet("sheetMedia");
    } else if (tool === "split") {
      splitAtCurrentTime();
    } else if (tool === "text") {
      renderTexts();
      openSheet("sheetText");
    } else if (tool === "audio") {
      renderBg();
      openSheet("sheetAudio");
    } else if (tool === "settings") {
      openSheet("sheetSettings");
    }
  };
});

// ---- DRIVE ENTEGRASYONU ----
function initDrive(type = "video,audio,image") {
  const driveFrame = $("#drive");
  const targetSrc = `${API}/drive?type=${type}&mode=select`;
  if (driveFrame.src !== targetSrc) {
    driveFrame.src = targetSrc;
  }
}

window.addEventListener("message", async (e) => {
  const d = e.data;
  if (!d || d.type !== "drive:select") return;
  const f = d.file;

  // Render ve stream icin kesin kok yolu
  const src = (f.abs && f.abs.includes("engrare-video-upload"))
    ? f.abs
    : `/drive/engrare-video/engrare-video-upload/${(f.path || f.name).replace(/^\/+/, "")}`;

  if (f.type === "audio") {
    project.audio = { src, path: f.path, name: f.name, volume: 0.3, loop: true };
    renderBg();
    closeSheet();
    autoSave();
    toast("🎵 Arka plan müziği eklendi");
    return;
  }

  if (f.type === "image") {
    project.clips.push({
      src,
      path: f.path,
      name: f.name,
      in: 0,
      out: 3.0,
      duration: 3.0,
      volume: 1.0,
      mute: true,
      image: true,
    });
    renderTimeline();
    selectClip(project.clips.length - 1);
    closeSheet();
    autoSave();
    toast("🖼️ Resim klip eklendi");
    return;
  }

  // Video
  let dur = 0;
  try {
    const info = await api("/drive/api/probe?path=" + encodeURIComponent(f.path));
    dur = info.duration || 0;
  } catch (err) {}

  project.clips.push({
    src,
    path: f.path,
    name: f.name,
    in: 0,
    out: dur || null,
    duration: dur || 0,
    volume: 1.0,
    mute: false,
    image: false,
  });

  renderTimeline();
  selectClip(project.clips.length - 1);
  closeSheet();
  autoSave();
  toast("🎬 Video klip eklendi");
});

// ---- TIMELINE & KLIP YONETIMI (CAPCUT SCRUBBER MOTORU) ----
function updateSpacerWidths() {
  const track = $("#tlTrack");
  if (!track) return;
  const half = (track.clientWidth || window.innerWidth) / 2;
  const sStart = track.querySelector(".tl-spacer-start");
  const sEnd = track.querySelector(".tl-spacer-end");
  if (sStart) {
    sStart.style.width = `${half}px`;
    sStart.style.minWidth = `${half}px`;
    sStart.style.flex = `0 0 ${half}px`;
  }
  if (sEnd) {
    sEnd.style.width = `${half}px`;
    sEnd.style.minWidth = `${half}px`;
    sEnd.style.flex = `0 0 ${half}px`;
  }
}

function renderTimeline() {
  const track = $("#tlTrack");
  track.innerHTML = "";

  const totalDur = getTotalDuration();
  $("#ttot").textContent = fmtTime(totalDur);

  if (!project.clips.length) {
    $("#pvempty").hidden = false;
    $("#playBtn").hidden = true;
    $("#clipbar").hidden = true;
    selectedClipIndex = null;
    $("#tinfo").textContent = "Klip yok";
    seekTo(0);
    return;
  }

  $("#pvempty").hidden = true;
  $("#playBtn").hidden = false;

  const halfTrack = (track.clientWidth || window.innerWidth) / 2;

  // 1. Baslangic boslugu (start spacer): ilk klibin basini (0.0s) tam beyaz cizginin altina denk getirir
  const startSpacer = el("div", "tl-spacer tl-spacer-start");
  startSpacer.style.width = `${halfTrack}px`;
  startSpacer.style.minWidth = `${halfTrack}px`;
  startSpacer.style.flex = `0 0 ${halfTrack}px`;
  track.append(startSpacer);

  let accumTime = 0;
  project.clips.forEach((c, idx) => {
    const card = el("div", "tl-clip");
    if (idx === selectedClipIndex) card.classList.add("selected");

    const effDur = getEffectiveDuration(c);
    const cardWidth = getClipWidth(c);
    card.style.width = `${cardWidth}px`;

    // CapCut onizleme karesi (thumbnail)
    const thumbImg = el("img", "tl-clip-thumb");
    thumbImg.loading = "lazy";
    let p = c.path;
    if (!p && c.src) {
      p = c.src.replace(/^\/drive\/engrare-video\/engrare-video-upload\/?/, "").replace(/^\/drive\/?/, "");
    }
    thumbImg.src = `${API}/drive/api/thumb?path=${encodeURIComponent(p || "")}`;
    thumbImg.onerror = () => { thumbImg.style.display = "none"; };
    card.append(thumbImg);

    // Üst bilgi satırı: sıra ve kırpılmış süre
    const topRow = el("div", "tl-clip-top");
    topRow.append(
      el("span", "tl-clip-badge", String(idx + 1)),
      el("span", "tl-clip-dur", `${effDur.toFixed(1)}s`)
    );

    // Alt bilgi satırı: medya simgesi ve dosya adı
    const btmRow = el("div", "tl-clip-bottom");
    btmRow.append(
      el("span", "tl-clip-icon", c.image ? "🖼️" : "🎬"),
      el("span", "tl-clip-name", c.name || `Klip ${idx + 1}`)
    );

    card.append(topRow, btmRow);

    const clipStart = accumTime;
    // Klip kartına tıklandığında: dokunulan saniyeye git ve ortaya kaydır!
    card.onclick = (ev) => {
      if (hasDragged) return;
      ev.stopPropagation();
      if (isPlaying) pause();

      const rect = card.getBoundingClientRect();
      const clickRatio = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
      const targetTime = clipStart + clickRatio * effDur;

      selectClip(idx, false);
      seekTo(targetTime, true);
    };

    accumTime += effDur;
    track.append(card);
  });

  // Timeline sonuna hızlı ekleme butonu
  const addBtn = el("div", "tl-add-btn");
  addBtn.append(el("span", "ic", "＋"), el("span", null, "Ekle"));
  addBtn.onclick = (ev) => {
    if (hasDragged) return;
    initDrive();
    openSheet("sheetMedia");
  };
  track.append(addBtn);

  // 2. Bitis boslugu (end spacer): son klibin sonunu tam beyaz cizginin altina kadar kaydirabilmeyi saglar
  const endSpacer = el("div", "tl-spacer tl-spacer-end");
  endSpacer.style.width = `${halfTrack}px`;
  endSpacer.style.minWidth = `${halfTrack}px`;
  endSpacer.style.flex = `0 0 ${halfTrack}px`;
  track.append(endSpacer);

  updateInfoBadge();
  syncTrackScroll(currentTime);
}

// Timeline yatay kaydirma (Scrubbing) ve Mouse/Touch Drag dinleyicileri
const trackEl = $("#tlTrack");
let isPointerDown = false;
let pointerStartX = 0;
let scrollStartLeft = 0;
let hasDragged = false;

trackEl.addEventListener("mousedown", (e) => {
  if (e.button !== 0) return;
  isPointerDown = true;
  hasDragged = false;
  pointerStartX = e.clientX;
  scrollStartLeft = trackEl.scrollLeft;
});

window.addEventListener("mousemove", (e) => {
  if (!isPointerDown) return;
  const dx = e.clientX - pointerStartX;
  if (Math.abs(dx) > 4) {
    hasDragged = true;
    if (isPlaying) pause();
    isProgrammaticScroll = false;
    trackEl.scrollLeft = Math.max(0, scrollStartLeft - dx);
  }
});

window.addEventListener("mouseup", () => {
  if (isPointerDown) {
    isPointerDown = false;
    setTimeout(() => { hasDragged = false; }, 50);
  }
});

trackEl.addEventListener("wheel", (e) => {
  if (Math.abs(e.deltaX) < Math.abs(e.deltaY)) {
    if (isPlaying) pause();
    trackEl.scrollLeft += e.deltaY;
    e.preventDefault();
  }
}, { passive: false });

window.addEventListener("resize", () => {
  updateSpacerWidths();
  syncTrackScroll(currentTime);
});

trackEl.addEventListener("scroll", () => {
  if (isProgrammaticScroll) return;
  if (!project.clips.length) return;

  if (isPlaying) pause();

  const t = pixelsToTime(trackEl.scrollLeft);
  currentTime = t;
  $("#tcur").textContent = fmtTime(t);

  const totalDur = getTotalDuration();
  if (totalDur > 0) {
    $("#scrubber").value = (t / totalDur) * 100;
  }

  // Akici kare arama (requestAnimationFrame debounced)
  if (seekAnimFrame) cancelAnimationFrame(seekAnimFrame);
  seekAnimFrame = requestAnimationFrame(() => {
    seekVideoFrame(t);
  });

  // Merkez imlecin uzerinde bulundugu klibi anlik sec
  const clipInfo = getClipAtTime(t);
  if (clipInfo && clipInfo.index !== selectedClipIndex) {
    selectedClipIndex = clipInfo.index;
    document.querySelectorAll(".tl-clip").forEach((card, i) => {
      card.classList.toggle("selected", i === selectedClipIndex);
    });
    $("#clipbar").hidden = false;
    updateInfoBadge();
  }
}, { passive: true });

// Zaman cubugu mini slider surukleme (scrubber)
$("#scrubber").oninput = (e) => {
  if (isPlaying) pause();
  const val = parseFloat(e.target.value) || 0;
  const totalDur = getTotalDuration();
  const t = (val / 100) * totalDur;
  seekTo(t, true);
};

function selectClip(idx, jumpToStart = true) {
  if (idx == null || idx < 0 || idx >= project.clips.length) {
    selectedClipIndex = null;
    $("#clipbar").hidden = true;
  } else {
    selectedClipIndex = idx;
    $("#clipbar").hidden = false;

    if (jumpToStart) {
      let accum = 0;
      for (let i = 0; i < idx; i++) {
        accum += getEffectiveDuration(project.clips[i]);
      }
      seekTo(accum, true);
    }
  }

  document.querySelectorAll(".tl-clip").forEach((c, i) => {
    c.classList.toggle("selected", i === selectedClipIndex);
  });

  updateInfoBadge();
}

function syncTrackScroll(t) {
  const targetPx = timeToPixels(t);
  isProgrammaticScroll = true;
  trackEl.scrollLeft = targetPx;
  requestAnimationFrame(() => {
    isProgrammaticScroll = false;
  });
}

function updateInfoBadge() {
  const total = project.clips.length;
  if (!total) {
    $("#tinfo").textContent = "Klip yok";
    return;
  }
  const cur = selectedClipIndex != null ? selectedClipIndex + 1 : "-";
  const res = $("#res").value;
  const ratio = res === "1080x1920" ? "9:16" : res === "1920x1080" ? "16:9" : "1:1";
  $("#tinfo").textContent = `${cur}/${total} • ${ratio}`;
}

// Clipbar aksiyonlari
$("#cbClose").onclick = () => selectClip(null);

$("#cbSplit").onclick = () => splitAtCurrentTime();

$("#cbTrim").onclick = () => {
  if (selectedClipIndex == null) return;
  renderTrimSheet(selectedClipIndex);
  openSheet("sheetTrim");
};

$("#cbVol").onclick = () => {
  if (selectedClipIndex == null) return;
  renderVolumeSheet(selectedClipIndex);
  openSheet("sheetVolume");
};

$("#cbLeft").onclick = () => {
  if (selectedClipIndex == null || selectedClipIndex <= 0) return;
  const i = selectedClipIndex;
  [project.clips[i - 1], project.clips[i]] = [project.clips[i], project.clips[i - 1]];
  selectedClipIndex = i - 1;
  renderTimeline();
  autoSave();
  toast("◀ Klip öne taşındı");
};

$("#cbRight").onclick = () => {
  if (selectedClipIndex == null || selectedClipIndex >= project.clips.length - 1) return;
  const i = selectedClipIndex;
  [project.clips[i], project.clips[i + 1]] = [project.clips[i + 1], project.clips[i]];
  selectedClipIndex = i + 1;
  renderTimeline();
  autoSave();
  toast("▶ Klip arkaya taşındı");
};

$("#cbDel").onclick = () => {
  if (selectedClipIndex == null) return;
  const idx = selectedClipIndex;
  project.clips.splice(idx, 1);
  selectedClipIndex = null;
  $("#clipbar").hidden = true;
  renderTimeline();
  seekTo(Math.min(currentTime, getTotalDuration()), true);
  autoSave();
  toast("🗑️ Klip silindi");
};

// ---- CAPCUT: BOLME (SPLIT) ISLEMI ----
function splitAtCurrentTime() {
  if (!project.clips.length) {
    toast("Önce bir klip ekleyin");
    return;
  }

  // Merkez imlecin bulundugu klibi bul
  let clipInfo = getClipAtTime(currentTime);
  if (!clipInfo) {
    toast("Bölünecek nokta bulunamadı");
    return;
  }

  const targetIndex = clipInfo.index;
  const c = project.clips[targetIndex];
  const dur = getEffectiveDuration(c);
  const cin = c.in || 0;
  const cout = c.out != null ? c.out : (c.duration || dur);

  // Eger imlec klibin icindeyse oradan kes, degilse ortadan ikiye kes
  let splitPoint;
  if (clipInfo.offset > 0.15 && clipInfo.offset < dur - 0.15) {
    splitPoint = cin + clipInfo.offset;
  } else {
    splitPoint = cin + (dur / 2);
  }

  const c2 = JSON.parse(JSON.stringify(c));
  c.out = parseFloat(splitPoint.toFixed(2));
  c2.in = parseFloat(splitPoint.toFixed(2));
  c2.out = cout;

  project.clips.splice(targetIndex + 1, 0, c2);

  renderTimeline();
  selectClip(targetIndex + 1, false);
  syncTrackScroll(currentTime);
  autoSave();
  toast("✂️ Klip tam imleçten bölündü");
}

// ---- CAPCUT: KIRPMA (TRIM) SHEET ----
function renderTrimSheet(idx) {
  const c = project.clips[idx];
  if (!c) return;
  $("#trimTitle").textContent = `Kırp: ${c.name || "Klip " + (idx + 1)}`;
  const body = $("#trimBody");
  body.innerHTML = "";

  const maxDur = c.duration || 60;
  const curIn = c.in || 0;
  const curOut = c.out != null ? c.out : maxDur;

  const card = el("div", "trim-card");

  const headInfo = el("div", "trim-header-info");
  const durBadge = el("span", "trim-dur-badge", `${(curOut - curIn).toFixed(1)} sn`);
  headInfo.append(el("span", "trim-clip-title", c.name), durBadge);
  card.append(headInfo);

  // 1. Baslangic (In)
  const inField = el("div", "trim-field");
  const inHead = el("div", "trim-field-head");
  const inValLbl = el("b", null, `${curIn.toFixed(1)}s`);
  inHead.append(el("span", null, "Başlangıç Noktası"), inValLbl);

  const inStepper = el("div", "trim-stepper");
  const btnInMinus = el("button", "trim-step-btn", "-0.5s");
  const btnInPlus = el("button", "trim-step-btn", "+0.5s");
  const inSlider = el("input", "trim-slider");
  inSlider.type = "range";
  inSlider.min = "0";
  inSlider.max = String(Math.max(1, curOut - 0.2));
  inSlider.step = "0.1";
  inSlider.value = String(curIn);

  const updateIn = (v) => {
    v = Math.max(0, Math.min(v, (c.out != null ? c.out : maxDur) - 0.2));
    c.in = parseFloat(v.toFixed(1));
    inSlider.value = String(c.in);
    inValLbl.textContent = `${c.in.toFixed(1)}s`;
    durBadge.textContent = `${getEffectiveDuration(c).toFixed(1)} sn`;
    seekToClipFrame(idx, c.in);
    renderTimeline();
  };

  btnInMinus.onclick = () => updateIn(c.in - 0.5);
  btnInPlus.onclick = () => updateIn(c.in + 0.5);
  inSlider.oninput = () => updateIn(parseFloat(inSlider.value));
  inSlider.onchange = () => autoSave();

  inStepper.append(btnInMinus, inSlider, btnInPlus);
  inField.append(inHead, inStepper);

  // 2. Bitis (Out)
  const outField = el("div", "trim-field");
  const outHead = el("div", "trim-field-head");
  const outValLbl = el("b", null, `${curOut.toFixed(1)}s`);
  outHead.append(el("span", null, "Bitiş Noktası"), outValLbl);

  const outStepper = el("div", "trim-stepper");
  const btnOutMinus = el("button", "trim-step-btn", "-0.5s");
  const btnOutPlus = el("button", "trim-step-btn", "+0.5s");
  const outSlider = el("input", "trim-slider");
  outSlider.type = "range";
  outSlider.min = String(curIn + 0.2);
  outSlider.max = String(maxDur);
  outSlider.step = "0.1";
  outSlider.value = String(curOut);

  const updateOut = (v) => {
    v = Math.max((c.in || 0) + 0.2, Math.min(v, maxDur));
    c.out = parseFloat(v.toFixed(1));
    outSlider.value = String(c.out);
    outValLbl.textContent = `${c.out.toFixed(1)}s`;
    durBadge.textContent = `${getEffectiveDuration(c).toFixed(1)} sn`;
    seekToClipFrame(idx, c.out);
    renderTimeline();
  };

  btnOutMinus.onclick = () => updateOut((c.out != null ? c.out : maxDur) - 0.5);
  btnOutPlus.onclick = () => updateOut((c.out != null ? c.out : maxDur) + 0.5);
  outSlider.oninput = () => updateOut(parseFloat(outSlider.value));
  outSlider.onchange = () => autoSave();

  outStepper.append(btnOutMinus, outSlider, btnOutPlus);
  outField.append(outHead, outStepper);

  // Aksiyonlar
  const actions = el("div", "trim-actions");
  const btnReset = el("button", "btn-ghost-wide", "Orijinale Sıfırla");
  btnReset.onclick = () => {
    c.in = 0;
    c.out = c.duration || null;
    renderTrimSheet(idx);
    renderTimeline();
    autoSave();
    toast("Kırpma sıfırlandı");
  };
  const btnDone = el("button", "btn-primary-wide", "Tamam");
  btnDone.onclick = () => {
    closeSheet();
    autoSave();
  };
  actions.append(btnReset, btnDone);

  card.append(inField, outField, actions);
  body.append(card);
}

function seekToClipFrame(clipIdx, timeWithinOriginalClip) {
  const c = project.clips[clipIdx];
  if (!c) return;
  const pv = $("#pv");
  const pvi = $("#pvi");
  if (c.image) {
    pvi.hidden = false;
    pv.hidden = true;
    pvi.src = getMediaUrl(c);
  } else {
    pv.hidden = false;
    pvi.hidden = true;
    const mediaUrl = getMediaUrl(c);
    if (pv.dataset.src !== c.src) {
      pv.src = mediaUrl;
      pv.dataset.src = c.src;
    }
    pv.currentTime = Math.max(0, timeWithinOriginalClip);
  }
}

// ---- KLIP SES AYARLARI SHEET ----
function renderVolumeSheet(idx) {
  const c = project.clips[idx];
  if (!c) return;
  $("#volTitle").textContent = `Ses: ${c.name || "Klip " + (idx + 1)}`;
  const body = $("#volBody");
  body.innerHTML = "";

  const card = el("div", "trim-card");

  const volHead = el("div", "trim-field-head");
  const volValLbl = el("b", null, `${Math.round((c.volume ?? 1) * 100)}%`);
  volHead.append(el("span", null, "Klip Ses Düzeyi"), volValLbl);

  const volSlider = el("input", "trim-slider");
  volSlider.type = "range";
  volSlider.min = "0";
  volSlider.max = "2";
  volSlider.step = "0.05";
  volSlider.value = String(c.volume ?? 1.0);
  volSlider.oninput = () => {
    c.volume = parseFloat(volSlider.value);
    volValLbl.textContent = `${Math.round(c.volume * 100)}%`;
  };
  volSlider.onchange = () => autoSave();

  const muteWrap = el("label");
  muteWrap.style.flexDirection = "row";
  muteWrap.style.alignItems = "center";
  muteWrap.style.gap = "8px";
  muteWrap.style.cursor = "pointer";
  const muteCheck = el("input");
  muteCheck.type = "checkbox";
  muteCheck.checked = Boolean(c.mute);
  muteCheck.onchange = () => {
    c.mute = muteCheck.checked;
    autoSave();
  };
  muteWrap.append(muteCheck, el("span", null, "Klibi sessize al (Mute)"));

  const btnDone = el("button", "btn-primary-wide", "Kaydet");
  btnDone.onclick = () => {
    closeSheet();
    autoSave();
  };

  card.append(volHead, volSlider, muteWrap, btnDone);
  body.append(card);
}

// ---- METIN KATMANLARI ----
function renderTexts() {
  const box = $("#texts");
  box.innerHTML = "";

  if (!project.texts.length) {
    box.append(el("div", "muted", "Henüz metin eklenmedi."));
    return;
  }

  project.texts.forEach((t, i) => {
    const row = el("div", "text-row");

    const head = el("div", "text-row-head");
    const txtInp = el("input");
    txtInp.type = "text";
    txtInp.value = t.text || "";
    txtInp.placeholder = "Metin yazın...";
    txtInp.oninput = () => {
      t.text = txtInp.value;
      updateTextOverlay();
      autoSave();
    };

    const delBtn = el("button", "btn-del", "✕");
    delBtn.onclick = () => {
      project.texts.splice(i, 1);
      renderTexts();
      updateTextOverlay();
      autoSave();
    };
    head.append(txtInp, delBtn);

    const inputs = el("div", "text-row-inputs");

    const stWrap = el("label");
    stWrap.append(el("span", null, "Başlangıç (sn)"));
    const stInp = el("input");
    stInp.type = "number";
    stInp.step = "0.5";
    stInp.value = String(t.start || 0);
    stInp.onchange = () => {
      t.start = parseFloat(stInp.value) || 0;
      updateTextOverlay();
      autoSave();
    };
    stWrap.append(stInp);

    const enWrap = el("label");
    enWrap.append(el("span", null, "Bitiş (sn)"));
    const enInp = el("input");
    enInp.type = "number";
    enInp.step = "0.5";
    enInp.value = String(t.end || 3);
    enInp.onchange = () => {
      t.end = parseFloat(enInp.value) || 3;
      updateTextOverlay();
      autoSave();
    };
    enWrap.append(enInp);

    const posWrap = el("label");
    posWrap.append(el("span", null, "Konum"));
    const posSel = el("select");
    [
      ["bottom", "Alt"],
      ["center", "Orta"],
      ["top", "Üst"],
    ].forEach(([val, lbl]) => {
      const opt = el("option", null, lbl);
      opt.value = val;
      if (t.y === val) opt.selected = true;
      posSel.append(opt);
    });
    posSel.onchange = () => {
      t.y = posSel.value;
      updateTextOverlay();
      autoSave();
    };
    posWrap.append(posSel);

    inputs.append(stWrap, enWrap, posWrap);
    row.append(head, inputs);
    box.append(row);
  });
}

$("#addtext").onclick = () => {
  const tot = getTotalDuration();
  const st = parseFloat(currentTime.toFixed(1));
  const en = parseFloat(Math.min(tot || 3, st + 3.0).toFixed(1));
  project.texts.push({
    text: "Metin",
    start: st,
    end: en,
    x: "center",
    y: "bottom",
    size: 54,
    color: "white",
    box: true,
  });
  renderTexts();
  updateTextOverlay();
  autoSave();
  toast("Metin katmanı eklendi");
};

function updateTextOverlay() {
  const container = $("#textOverlay");
  if (!container) return;
  container.innerHTML = "";

  const activeTexts = project.texts.filter(
    (t) => currentTime >= (t.start || 0) && currentTime <= (t.end || 3)
  );

  activeTexts.forEach((t) => {
    const item = el("div", `text-item ${t.y || "bottom"}`);
    item.textContent = t.text || "";
    container.append(item);
  });
}

// ---- MUZIK / SES KATMANI ----
function renderBg() {
  const box = $("#bg");
  box.innerHTML = "";

  if (!project.audio) {
    box.append(el("div", "muted", "Müzik eklenmedi."));
    return;
  }

  const card = el("div", "bg-card");
  const head = el("div", "text-row-head");
  head.append(
    el("span", "icon", "♪"),
    el("span", "nm", project.audio.name || "Müzik"),
    el("span", "spacer")
  );

  const del = el("button", "btn-del", "✕");
  del.onclick = () => {
    project.audio = null;
    $("#pvaudio").pause();
    renderBg();
    autoSave();
    toast("Müzik kaldırıldı");
  };
  head.append(del);

  const volWrap = el("div", "trim-field");
  const volHead = el("div", "trim-field-head");
  const volVal = el("b", null, `${Math.round((project.audio.volume ?? 0.3) * 100)}%`);
  volHead.append(el("span", null, "Müzik Sesi"), volVal);

  const volSlider = el("input", "trim-slider");
  volSlider.type = "range";
  volSlider.min = "0";
  volSlider.max = "1";
  volSlider.step = "0.05";
  volSlider.value = String(project.audio.volume ?? 0.3);
  volSlider.oninput = () => {
    project.audio.volume = parseFloat(volSlider.value);
    volVal.textContent = `${Math.round(project.audio.volume * 100)}%`;
    $("#pvaudio").volume = project.audio.volume;
  };
  volSlider.onchange = () => autoSave();
  volWrap.append(volHead, volSlider);

  const loopWrap = el("label");
  loopWrap.style.flexDirection = "row";
  loopWrap.style.alignItems = "center";
  loopWrap.style.gap = "8px";
  const loopCheck = el("input");
  loopCheck.type = "checkbox";
  loopCheck.checked = Boolean(project.audio.loop);
  loopCheck.onchange = () => {
    project.audio.loop = loopCheck.checked;
    $("#pvaudio").loop = loopCheck.checked;
    autoSave();
  };
  loopWrap.append(loopCheck, el("span", null, "Döngü (Loop)"));

  card.append(head, volWrap, loopWrap);
  box.append(card);
}

$("#addaudio").onclick = () => {
  initDrive("audio");
  openSheet("sheetMedia");
};

// ---- OYNATMA VE KARE ARAMA MOTORU ----
function seekVideoFrame(t) {
  const clipInfo = getClipAtTime(t);
  const pv = $("#pv");
  const pvi = $("#pvi");

  if (!clipInfo) {
    pvi.hidden = true;
    pv.hidden = true;
    updateTextOverlay();
    return;
  }

  const c = clipInfo.clip;
  if (c.image) {
    pvi.hidden = false;
    pv.hidden = true;
    pvi.src = getMediaUrl(c);
    if (!pv.paused) pv.pause();
  } else {
    pv.hidden = false;
    pvi.hidden = true;
    const mediaUrl = getMediaUrl(c);
    const targetVideoTime = (c.in || 0) + clipInfo.offset;

    if (pv.dataset.src !== c.src || !pv.src) {
      pv.src = mediaUrl;
      pv.dataset.src = c.src;
      pv.dataset.clipIdx = clipInfo.index;
      const onMeta = () => {
        pv.currentTime = targetVideoTime;
        pv.removeEventListener("loadedmetadata", onMeta);
      };
      pv.addEventListener("loadedmetadata", onMeta);
    }
    if (pv.readyState >= 1) {
      pv.currentTime = targetVideoTime;
    }
    pv.volume = c.mute ? 0 : Math.min(1, c.volume ?? 1);
  }

  updateTextOverlay();
}

function seekTo(t, syncScroll = false) {
  const tot = getTotalDuration();
  currentTime = Math.max(0, Math.min(tot, t));
  $("#tcur").textContent = fmtTime(currentTime);

  if (tot > 0) {
    $("#scrubber").value = (currentTime / tot) * 100;
  }

  seekVideoFrame(currentTime);

  if (project.audio) {
    const pvaudio = $("#pvaudio");
    pvaudio.currentTime = currentTime;
  }

  if (syncScroll) {
    syncTrackScroll(currentTime);
  }
}

function togglePlay() {
  if (!project.clips.length) return;
  if (isPlaying) {
    pause();
  } else {
    play();
  }
}

function prepareClipForPlayback(t, shouldPlay = true) {
  const clipInfo = getClipAtTime(t);
  const pv = $("#pv");
  const pvi = $("#pvi");
  if (!clipInfo) return;

  const c = clipInfo.clip;
  if (c.image) {
    pvi.hidden = false;
    pv.hidden = true;
    pvi.src = getMediaUrl(c);
    if (!pv.paused) pv.pause();
  } else {
    pv.hidden = false;
    pvi.hidden = true;
    const mediaUrl = getMediaUrl(c);
    const targetVideoTime = (c.in || 0) + clipInfo.offset;

    const doPlay = () => {
      pv.currentTime = targetVideoTime;
      pv.volume = c.mute ? 0 : Math.min(1, c.volume ?? 1);
      if (shouldPlay && isPlaying) {
        pv.play().catch(() => {});
      }
    };

    if (pv.dataset.src !== c.src || !pv.src) {
      pv.src = mediaUrl;
      pv.dataset.src = c.src;
      pv.dataset.clipIdx = clipInfo.index;
      const onMeta = () => {
        doPlay();
        pv.removeEventListener("loadedmetadata", onMeta);
      };
      pv.addEventListener("loadedmetadata", onMeta);
    } else {
      doPlay();
    }
  }
}

function play() {
  const tot = getTotalDuration();
  if (tot <= 0) return;

  // Sona gelindiyse basa sar ve beyaz cizgiyi 0'a getir
  if (currentTime >= tot - 0.05) {
    currentTime = 0;
    seekTo(0, true);
  }

  isPlaying = true;
  $("#playBtn").textContent = "⏸";
  $("#btnPlay").textContent = "⏸";
  lastPlayTimestamp = performance.now();

  const pvaudio = $("#pvaudio");
  if (project.audio) {
    pvaudio.src = getMediaUrl(project.audio);
    pvaudio.volume = project.audio.volume ?? 0.3;
    pvaudio.loop = Boolean(project.audio.loop);
    pvaudio.currentTime = currentTime;
    pvaudio.play().catch(() => {});
  }

  // Beyaz cizginin tam durdugu saniyeden videoyu baslat
  prepareClipForPlayback(currentTime, true);

  if (playAnimFrame) cancelAnimationFrame(playAnimFrame);
  playAnimFrame = requestAnimationFrame(playLoop);
}

function pause() {
  isPlaying = false;
  $("#playBtn").textContent = "▶";
  $("#btnPlay").textContent = "▶";
  if (playAnimFrame) cancelAnimationFrame(playAnimFrame);
  lastPlayTimestamp = null;

  const pv = $("#pv");
  if (!pv.paused) pv.pause();
  const pvaudio = $("#pvaudio");
  if (!pvaudio.paused) pvaudio.pause();

  syncTrackScroll(currentTime);
}

function playLoop(now) {
  if (!isPlaying) return;

  const tot = getTotalDuration();
  const clipInfo = getClipAtTime(currentTime);

  if (!clipInfo || currentTime >= tot) {
    currentTime = tot;
    seekTo(tot, true);
    pause();
    return;
  }

  const c = clipInfo.clip;
  const pv = $("#pv");

  if (!c.image) {
    // Video klip: videonun kendi donanim decoder zamani master saat olarak senkronize edilir
    if (!pv.paused && pv.readyState >= 2) {
      const currentInClip = pv.currentTime - (c.in || 0);

      // Klip sonuna gelindi mi?
      if (currentInClip >= clipInfo.clipDur - 0.04) {
        currentTime = clipInfo.clipStart + clipInfo.clipDur;
        if (currentTime >= tot) {
          currentTime = tot;
          seekTo(tot, true);
          pause();
          return;
        }
        prepareClipForPlayback(currentTime, true);
      } else {
        // Klip icinde oynatilan tam saniye
        currentTime = clipInfo.clipStart + Math.max(0, currentInClip);
      }
    } else {
      // Video henuz basliyorsa / buffer yapiyorsa hafif fallback
      const dt = lastPlayTimestamp ? Math.min(0.1, (now - lastPlayTimestamp) / 1000) : 0.033;
      currentTime += dt;
      if (pv.paused && isPlaying) {
        pv.play().catch(() => {});
      }
    }
  } else {
    // Resim klip: sure saat bazli ilerler
    const dt = lastPlayTimestamp ? Math.min(0.1, (now - lastPlayTimestamp) / 1000) : 0.033;
    currentTime += dt;

    if (currentTime >= clipInfo.clipStart + clipInfo.clipDur) {
      if (currentTime >= tot) {
        currentTime = tot;
        seekTo(tot, true);
        pause();
        return;
      }
      prepareClipForPlayback(currentTime, true);
    }
  }

  lastPlayTimestamp = now;

  // Sayac ve slider guncelleme
  $("#tcur").textContent = fmtTime(currentTime);
  if (tot > 0) {
    $("#scrubber").value = (currentTime / tot) * 100;
  }
  updateTextOverlay();

  // TIMELINE'I BEYAZ CIZGININ ALTINDA YANA DOGRU AKIT (OYNATILAN SANIYE = BEYAZ CIZGI)
  isProgrammaticScroll = true;
  trackEl.scrollLeft = timeToPixels(currentTime);
  isProgrammaticScroll = false;

  // Aktif klibi otomatik vurgula
  const activeClipInfo = getClipAtTime(currentTime);
  if (activeClipInfo && activeClipInfo.index !== selectedClipIndex) {
    selectedClipIndex = activeClipInfo.index;
    document.querySelectorAll(".tl-clip").forEach((card, i) => {
      card.classList.toggle("selected", i === selectedClipIndex);
    });
    updateInfoBadge();
  }

  // Muzik senkronizasyonu
  if (project.audio) {
    const pvaudio = $("#pvaudio");
    if (!pvaudio.paused && Math.abs(pvaudio.currentTime - currentTime) > 0.35) {
      pvaudio.currentTime = currentTime;
    }
  }

  playAnimFrame = requestAnimationFrame(playLoop);
}

$("#pv").onended = () => {
  if (isPlaying) {
    const cur = getClipAtTime(currentTime);
    if (cur) {
      currentTime = cur.clipStart + cur.clipDur;
      const tot = getTotalDuration();
      if (currentTime >= tot) {
        currentTime = tot;
        seekTo(tot, true);
        pause();
      } else {
        prepareClipForPlayback(currentTime, true);
      }
    }
  }
};

$("#playBtn").onclick = togglePlay;
$("#btnPlay").onclick = togglePlay;
$("#preview").onclick = (e) => {
  if (e.target !== $("#playBtn")) togglePlay();
};

// ---- AYARLAR & EN-BOY ORANI ----
function applyResolution(resStr) {
  const [w, h] = resStr.split("x").map(Number);
  project.settings.width = w;
  project.settings.height = h;

  const preview = $("#preview");
  if (w === 1080 && h === 1920) {
    preview.style.setProperty("--aspect", "9 / 16");
  } else if (w === 1920 && h === 1080) {
    preview.style.setProperty("--aspect", "16 / 9");
  } else if (w === 1080 && h === 1080) {
    preview.style.setProperty("--aspect", "1 / 1");
  }
  updateInfoBadge();
}

$("#res").onchange = (e) => {
  applyResolution(e.target.value);
  autoSave();
};

$("#fps").onchange = (e) => {
  project.settings.fps = parseInt(e.target.value) || 30;
  autoSave();
};

$("#codec").onchange = (e) => {
  project.settings.codec = e.target.value;
  autoSave();
};

$("#qp").onchange = (e) => {
  project.settings.qp = parseInt(e.target.value) || 23;
  autoSave();
};

function readSettingsIntoUI() {
  const s = project.settings;
  $("#res").value = `${s.width}x${s.height}`;
  $("#fps").value = String(s.fps || 30);
  $("#codec").value = s.codec || "h264";
  $("#qp").value = String(s.qp || 23);
  applyResolution(`${s.width}x${s.height}`);
}

$("#pname").oninput = () => {
  project.name = $("#pname").value.trim() || "Yeni reels";
  autoSave();
};

// ---- KAYDET / PROJE YONETIMI ----
function autoSave() {
  const st = $("#saveStatus");
  if (st) st.textContent = "…";
  clearTimeout(saveDebounceTimer);
  saveDebounceTimer = setTimeout(async () => {
    try {
      await saveProject();
      if (st) st.textContent = "✓";
    } catch (err) {
      if (st) st.textContent = "!";
    }
  }, 1000);
}

async function saveProject() {
  project.name = $("#pname").value.trim() || "Yeni reels";
  const body = {
    name: project.name,
    settings: project.settings,
    clips: project.clips,
    audio: project.audio,
    texts: project.texts,
  };
  const d = await api(project.id ? `/api/projects/${project.id}` : "/api/projects", {
    method: project.id ? "PUT" : "POST",
    body,
  });
  project.id = d.id;
  return d;
}

$("#save").onclick = async () => {
  await saveProject();
  await loadProjects();
  toast("💾 Proje kaydedildi");
};

$("#newproj").onclick = () => {
  project = {
    id: null,
    name: "Yeni reels",
    settings: { width: 1080, height: 1920, fps: 30, codec: "h264", qp: 23, abitrate: "192k" },
    clips: [],
    audio: null,
    texts: [],
  };
  $("#pname").value = project.name;
  readSettingsIntoUI();
  renderTimeline();
  renderTexts();
  renderBg();
  closeSheet();
  toast("Yeni proje oluşturuldu");
};

async function loadProjects() {
  const list = await api("/api/projects");
  const box = $("#projects");
  box.innerHTML = "";

  if (!list.length) {
    box.append(el("div", "muted", "Henüz kayıtlı proje yok."));
    return;
  }

  list.forEach((p) => {
    const item = el("div", "proj-item");
    if (p.id === project.id) item.classList.add("active");

    const title = el("span", "proj-item-name", p.name || p.id);
    const del = el("span", "proj-item-del", "🗑");

    del.onclick = async (e) => {
      e.stopPropagation();
      await api(`/api/projects/${p.id}`, { method: "DELETE" });
      loadProjects();
      toast("Proje silindi");
    };

    item.onclick = async () => {
      project = await api(`/api/projects/${p.id}`);
      $("#pname").value = project.name;
      readSettingsIntoUI();
      renderTimeline();
      renderTexts();
      renderBg();
      closeSheet();
      toast(`"${project.name}" açıldı`);
    };

    item.append(title, del);
    box.append(item);
  });
}

// ---- DISA AKTARMA (RENDER) ----
async function exportVideo() {
  if (!project.clips.length) {
    toast("Önce en az bir klip ekleyin");
    return;
  }
  openSheet("sheetSettings");
  await saveProject();
  toast("Render kuyruğa alınıyor...");
  const { job } = await api(`/api/projects/${project.id}/render`, { method: "POST" });
  watchJob(job);
}

$("#btnExport").onclick = exportVideo;
$("#btnStartRender").onclick = exportVideo;

function watchJob(jid) {
  const box = $("#job");
  box.className = "job";
  box.innerHTML = "Hazırlanıyor...";

  const bar = el("div", "bar");
  const fill = el("i");
  bar.append(fill);
  box.append(bar);

  const ws = new WebSocket(`${API.replace(/^http/, "ws")}/ws/jobs/${jid}`);
  ws.onmessage = (ev) => {
    const j = JSON.parse(ev.data);
    if (j.error) {
      box.textContent = "Hata: " + j.error;
      return;
    }
    fill.style.width = j.progress + "%";
    box.firstChild.textContent = `${j.status} — ${j.progress}% (${j.message || ""})`;

    if (j.status === "done") {
      box.className = "job done";
      const url = `${API}/api/renders/${j.out.split("/").pop()}`;
      $("#pv").src = url;
      $("#pv").hidden = false;
      $("#pvi").hidden = true;
      $("#pvempty").hidden = true;

      const a = $("#download");
      a.href = url;
      a.hidden = false;
      toast("🎉 Render tamamlandı!");
      ws.close();
    } else if (j.status === "error") {
      box.className = "job error";
      box.firstChild.textContent = "Hata: " + j.error;
      ws.close();
    }
  };
  ws.onerror = () => {
    box.textContent = "Bağlantı hatası";
  };
}

// ---- BASLAT (BOOT) ----
async function boot() {
  const me = await api("/api/auth/me");
  if (!me.user) {
    showLogin();
    return;
  }
  $("#who").textContent = me.user;
  showApp();
  initDrive();
  readSettingsIntoUI();
  renderTimeline();
  renderTexts();
  renderBg();
  await loadProjects();
}

boot().catch(() => showLogin());
