// Onizleme tani paneli: adres sonuna ?pvdebug=1 eklenince (ya da localStorage.pvdebug = "1") sol ustte
// kare araliklari, klip degisiminde baslama gecikmesi, takilma ve dusen kareler gorunur.
// Kapali iken hicbir is yapmaz.
export const on = /[?&]pvdebug\b/.test(location.search) || localStorage.getItem("pvdebug") === "1";

const lines = [];
let box = null;
let lastRaf = 0;
export const ctx = { phase: "-", t: 0 }; // player her karede gunceller

export function log(msg) {
  if (!on) return;
  lines.push(`${ctx.t.toFixed(2)}s ${ctx.phase} ${msg}`);
  if (lines.length > 16) lines.shift();
  if (box) box.textContent = lines.join("\n");
}

export function resetRaf() {
  lastRaf = 0;
}

// requestAnimationFrame araligi uzarsa ana is parcacigi mesguldur (JS/boya yuku)
export function raf(now) {
  if (!on) return;
  if (lastRaf && now - lastRaf > 45) log(`RAF gecikti ${Math.round(now - lastRaf)}ms`);
  lastRaf = now;
}

export function init(vids) {
  if (!on) return;
  box = document.createElement("pre");
  box.style.cssText = "position:fixed;top:4px;left:4px;z-index:99999;margin:0;padding:4px 6px;font:10px/1.3 monospace;"
    + "color:#8f8;background:rgba(0,0,0,.72);pointer-events:none;max-width:96vw;white-space:pre-wrap";
  box.textContent = "pvdebug acik: oynat, gecis yerlerine bak";
  document.body.append(box);
  vids.forEach((v, i) => {
    const name = i ? "vb" : "va";
    let last = 0;
    const cb = (now, md) => {
      const gap = last ? now - last : 0;
      last = now;
      // yalniz oynayan ve gorunen oge icin: 80 ms'den uzun kare araligi = gozle gorulur donma
      if (gap > 80 && !v.paused && v.classList.contains("on")) {
        const q = v.getVideoPlaybackQuality?.();
        log(`${name} kare ${Math.round(gap)}ms rs=${v.readyState} dusen=${q ? q.droppedVideoFrames : "?"}`);
      }
      if (v._playAt != null && Math.abs(md.mediaTime - v._ct) > 0.001) {
        log(`${name} baslama gecikmesi ${Math.round(now - v._playAt)}ms`);
        v._playAt = null;
      }
      v.requestVideoFrameCallback(cb);
    };
    v.addEventListener("playing", () => { last = 0; });
    v.addEventListener("seeked", () => { last = 0; });
    v.addEventListener("waiting", () => log(`${name} WAITING rs=${v.readyState}`));
    v.addEventListener("stalled", () => log(`${name} stalled`));
    if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(cb);
  });
}
