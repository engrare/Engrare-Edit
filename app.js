// Engrare Edit v2: giris, acilis, zaman cubugu ve klavye kisayollari.
//
// Kisayollar (masaustu):
//   Bosluk oynat/durdur · S bol · Q basini sil · W sonunu sil · Delete sil
//   Ctrl+Z geri al · Ctrl+Shift+Z / Ctrl+Y yinele · <- -> kare (Shift: 1 sn)
//   + / - zoom · Home / End basa / sona · Esc secimi kaldir
import { $, api, fmtTime, iconBtn } from "./api.js";
import {
  S, flushOnExit, forgetLastProject, frame, lastProjectId, newProject, on, openProject, redo,
  select, setTime, total, undo,
} from "./state.js";
import { loadFontList } from "./fonts.js";
import * as player from "./player.js";
import * as studio from "./studio.js";
import * as tl from "./timeline.js";
import * as ui from "./ui.js";

// ---- ust bar ve zaman cubugu ----
iconBtn($("#btnMenu"), "menu");
iconBtn($("#btnUndo"), "undo");
iconBtn($("#btnRedo"), "redo");
iconBtn($("#btnPrev"), "prev");
iconBtn($("#btnNext"), "next");
iconBtn($("#btnZoomOut"), "zoomOut");
iconBtn($("#btnZoomIn"), "zoomIn");
iconBtn($("#btnStudio"), "magic");

const playBtn = $("#btnPlay");
const syncPlay = () => iconBtn(playBtn, S.playing ? "pause" : "play");
syncPlay();
on("playing", syncPlay);

function togglePlay() {
  tl.stopInertia();
  player.toggle();
}

function step(frames, seconds = 0) {
  player.pause();
  tl.stopInertia();
  if (seconds) {
    setTime(S.time + seconds, "step");
    return;
  }
  const f = frame();
  setTime((Math.round(S.time / f) + frames) * f, "step");
}

playBtn.onclick = togglePlay;
$("#btnPrev").onclick = () => step(-1);
$("#btnNext").onclick = () => step(1);
$("#btnZoomOut").onclick = () => tl.zoomBy(1 / 1.5);
$("#btnZoomIn").onclick = () => tl.zoomBy(1.5);
$("#btnUndo").onclick = () => { player.pause(); undo(); };
$("#btnRedo").onclick = () => { player.pause(); redo(); };
$("#btnMenu").onclick = () => ui.openProjects();
$("#btnExport").onclick = () => ui.openExport();
$("#btnStudio").onclick = () => studio.openStudio();

let timeRaf = 0;
function syncTime() {
  if (timeRaf) return;
  timeRaf = requestAnimationFrame(() => {
    timeRaf = 0;
    $("#tcur").textContent = fmtTime(S.time);
    $("#ttot").textContent = fmtTime(total());
  });
}
on("time", syncTime);
on("project", syncTime);

// ---- klavye ----
document.addEventListener("keydown", (ev) => {
  if ($("#app").hidden || ev.target.closest("input, textarea, select, [contenteditable]")) return;
  const k = ev.key;
  if (!$("#sheetStudio").hidden) { // AI Stüdyo açıkken editör kısayolları çalışmaz
    if (k === "Escape") ui.closeSheet();
    return;
  }
  if (ev.ctrlKey || ev.metaKey) {
    if (k === "z" || k === "Z") {
      ev.preventDefault();
      player.pause();
      if (ev.shiftKey) redo();
      else undo();
    } else if (k === "y" || k === "Y") {
      ev.preventDefault();
      player.pause();
      redo();
    }
    return;
  }
  if (ev.altKey) return;
  switch (k) {
    case " ": ev.preventDefault(); togglePlay(); break;
    case "ArrowLeft": ev.preventDefault(); step(-1, ev.shiftKey ? -1 : 0); break;
    case "ArrowRight": ev.preventDefault(); step(1, ev.shiftKey ? 1 : 0); break;
    case "s": case "S": ui.act("split"); break;
    case "q": case "Q": ui.act("trimL"); break;
    case "w": case "W": ui.act("trimR"); break;
    case "Delete": case "Backspace": ev.preventDefault(); ui.act("del"); break;
    case "Escape": ui.closeSheet(); ui.closePanel(); select(null); break;
    case "+": case "=": tl.zoomBy(1.5); break;
    case "-": case "_": tl.zoomBy(1 / 1.5); break;
    case "Home": ev.preventDefault(); player.pause(); setTime(0, "step"); break;
    case "End": ev.preventDefault(); player.pause(); setTime(total(), "step"); break;
    default: break;
  }
});

// ---- giris / acilis ----
function showLogin() {
  player.pause();
  $("#login").hidden = false;
  $("#app").hidden = true;
  setTimeout(() => $("#lu").focus(), 50);
}
window.addEventListener("auth:required", showLogin);

$("#loginform").onsubmit = async (e) => {
  e.preventDefault();
  $("#lerr").textContent = "";
  const btn = e.target.querySelector("button");
  btn.disabled = true;
  try {
    await api("/api/auth/login", { method: "POST", body: { username: $("#lu").value.trim(), password: $("#lp").value } });
    $("#lp").value = "";
    await start();
  } catch (err) {
    $("#lerr").textContent = err.status === 401 ? "Kullanıcı adı veya şifre hatalı" : err.message;
  } finally {
    btn.disabled = false;
  }
};

async function start() {
  const me = await api("/api/auth/me");
  if (!me.user) {
    showLogin();
    return;
  }
  $("#who").textContent = me.user;
  $("#login").hidden = true;
  $("#app").hidden = false;
  studio.init();
  ui.warmProjects();
  const last = lastProjectId();
  if (last) {
    try {
      await openProject(last);
      return;
    } catch (e) {
      forgetLastProject();
    }
  }
  await newProject();
  if ($("#sheetStudio").hidden) ui.openNewProject(); // proje yoksa once ad ve format sor (AI Studyo acilmiyorsa)
}

loadFontList();

window.addEventListener("pagehide", flushOnExit);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    player.pause();
    flushOnExit();
  }
});

start().catch(showLogin);
