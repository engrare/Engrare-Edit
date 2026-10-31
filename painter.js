// Parca boyama penceresi: parcayi 3B gorunumde acar; yuzey / firca / dilim araclariyla ucgen basina renk verilir.
// Sonuc sunucuya (PUT /api/parts/paint) yazilir: ucgen basina 1 bayt renk indeksi + en cok 16 renklik tablo.
// three.js yalnizca bu pencere acilinca sunucudan yuklenir (/api/parts/js/three.js).
import { API, api, el, toast } from "./api.js";
import { confirmBox } from "./dialog.js";

let THREE = null;
const loadThree = async () => (THREE = THREE || (await import(`${API}/api/parts/js/three.js`)));

const MAX_COLS = 16;
const REGION = { dar: 12, orta: 30, genis: 60 };
const fmt = (v) => String(+Number(v).toFixed(v < 10 ? 2 : 1)).replace(".", ",");

async function getBytes(path) {
  const r = await fetch(`${API}${path}`, { credentials: "include" });
  if (!r.ok) {
    let msg = `İstek başarısız (${r.status})`;
    try { msg = (await r.json()).detail || msg; } catch (e) { /* govde yok */ }
    throw new Error(msg);
  }
  return r.arrayBuffer();
}

// part: { key, name, color, paint:{rev,cols}|null, dims }; onDone(paint) kaydedilince cagrilir
export async function openPainter({ file, up, part, palette, onDone }) {
  const scrim = el("div", "pn-scrim");
  const box = el("div", "pn");
  scrim.append(box);
  document.body.append(scrim);
  const head = el("div", "pn-head");
  const title = el("div", "pn-title", `Boya: ${part.name}`);
  const closeBtn = el("button", "br-x pn-x", "✕");
  closeBtn.type = "button";
  head.append(title, closeBtn);
  const stage = el("div", "pn-stage");
  const status = el("div", "pn-status", "Parça yükleniyor…");
  stage.append(status);
  const ctl = el("div", "pn-ctl");
  box.append(head, stage, ctl);

  let disposed = false;
  let renderer = null;
  let dirty = false;
  const cleanup = () => {
    disposed = true;
    scrim.remove();
    if (renderer) { renderer.dispose(); renderer.forceContextLoss?.(); }
  };
  const close = async () => {
    if (dirty && !(await confirmBox({ title: "Boyama kaydedilmesin mi?", text: "Yaptığın değişiklikler silinir.", ok: "Kaydetme, kapat" }))) return;
    cleanup();
  };
  closeBtn.onclick = close;

  let info, meshBuf, idx, T;
  try {
    [T, info] = await Promise.all([loadThree(), api(`/api/parts/paintinfo/${file}/${part.key}/${up}`)]);
    [meshBuf, idx] = await Promise.all([
      getBytes(`/api/parts/mesh/${file}/${part.key}`),
      part.paint ? getBytes(`/api/parts/paint/${file}/${part.key}/${part.paint.rev}`).then((b) => new Uint8Array(b)) : null,
    ]);
  } catch (e) {
    status.textContent = e.message;
    status.classList.add("err");
    return;
  }
  if (disposed) return;

  // ---- geometri: parca montajdaki yonuyle (Z yukari), ucgen basina renk
  const dv = new DataView(meshBuf);
  const n = dv.getUint32(80, true);
  const M = info.matrix; // sutun-oncelikli 4x4; yalniz donme/olcek kismi kullanilir
  const det = M[0] * (M[5] * M[10] - M[9] * M[6]) - M[4] * (M[1] * M[10] - M[9] * M[2]) + M[8] * (M[1] * M[6] - M[5] * M[2]);
  const pos = new Float32Array(n * 9);
  for (let t = 0; t < n; t++) {
    const o = 84 + t * 50 + 12;
    for (let v = 0; v < 3; v++) {
      const x = dv.getFloat32(o + v * 12, true), y = dv.getFloat32(o + v * 12 + 4, true), z = dv.getFloat32(o + v * 12 + 8, true);
      const k = t * 9 + (det < 0 && v > 0 ? 3 - v : v) * 3; // ayna donusumunde sarmal yonu korunur
      pos[k] = M[0] * x + M[4] * y + M[8] * z;
      pos[k + 1] = M[1] * x + M[5] * y + M[9] * z;
      pos[k + 2] = M[2] * x + M[6] * y + M[10] * z;
    }
  }
  const cen = new Float32Array(n * 3);
  const nrm = new Float32Array(n * 3);
  const bmin = [Infinity, Infinity, Infinity], bmax = [-Infinity, -Infinity, -Infinity];
  for (let t = 0; t < n; t++) {
    const b = t * 9;
    for (let a = 0; a < 3; a++) {
      cen[t * 3 + a] = (pos[b + a] + pos[b + 3 + a] + pos[b + 6 + a]) / 3;
      for (let v = 0; v < 3; v++) {
        const c = pos[b + v * 3 + a];
        if (c < bmin[a]) bmin[a] = c;
        if (c > bmax[a]) bmax[a] = c;
      }
    }
    const ux = pos[b + 3] - pos[b], uy = pos[b + 4] - pos[b + 1], uz = pos[b + 5] - pos[b + 2];
    const vx = pos[b + 6] - pos[b], vy = pos[b + 7] - pos[b + 1], vz = pos[b + 8] - pos[b + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nrm[t * 3] = nx / l; nrm[t * 3 + 1] = ny / l; nrm[t * 3 + 2] = nz / l;
  }
  const size = bmax.map((v, i) => v - bmin[i]);
  const diag = Math.hypot(...size) || 1;
  if (!idx || idx.length !== n) idx = new Uint8Array(n);
  let cols = part.paint?.cols?.slice() || [/^#[0-9a-f]{6}$/i.test(part.color) ? part.color.toUpperCase() : "#F2F2F2"];
  const rgbOf = (hex) => new T.Color(hex);

  const geo = new T.BufferGeometry();
  geo.setAttribute("position", new T.BufferAttribute(pos, 3));
  geo.computeVertexNormals(); // ucgen basina duz normal
  const colArr = new Float32Array(n * 9);
  const colAttr = new T.BufferAttribute(colArr, 3);
  geo.setAttribute("color", colAttr);
  const setTri = (t) => {
    const c = rgbOf(cols[idx[t]] || cols[0]);
    for (let v = 0; v < 3; v++) { colArr[t * 9 + v * 3] = c.r; colArr[t * 9 + v * 3 + 1] = c.g; colArr[t * 9 + v * 3 + 2] = c.b; }
  };
  for (let t = 0; t < n; t++) setTri(t);

  // ---- sahne
  const W = () => stage.clientWidth || 360, H = () => stage.clientHeight || 360;
  renderer = new T.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(W(), H());
  renderer.setClearColor(0x9aa4b2, 1);
  const cv = renderer.domElement;
  cv.className = "pn-cv";
  stage.append(cv);
  status.hidden = true;
  const scene = new T.Scene();
  const camera = new T.PerspectiveCamera(35, W() / H(), 0.1, 1000);
  scene.add(camera);
  camera.add(new T.DirectionalLight(0xffffff, 2.2));
  scene.add(new T.HemisphereLight(0xffffff, 0x9aa3af, 1.5));
  const root = new T.Group();
  root.rotation.x = -Math.PI / 2; // Z yukari -> dunya Y yukari
  scene.add(root);
  const mesh = new T.Mesh(geo, new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0, side: T.DoubleSide }));
  root.add(mesh);
  const axes = new T.AxesHelper(diag * 0.3);
  axes.position.set(bmin[0], bmin[1], bmin[2]);
  root.add(axes);
  const slabBox = new T.Mesh(new T.BoxGeometry(1, 1, 1), new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.28, depthWrite: false }));
  slabBox.visible = false;
  root.add(slabBox);

  // ucgen secimi: kimlik renkli ekran disi cizim (buyuk parcada bile hizli)
  const idBytes = new Uint8Array(n * 9);
  for (let t = 0; t < n; t++) {
    const v = t + 1;
    for (let k = 0; k < 3; k++) { idBytes[t * 9 + k * 3] = v & 255; idBytes[t * 9 + k * 3 + 1] = (v >> 8) & 255; idBytes[t * 9 + k * 3 + 2] = (v >> 16) & 255; }
  }
  const idGeo = new T.BufferGeometry();
  idGeo.setAttribute("position", geo.attributes.position);
  idGeo.setAttribute("aId", new T.BufferAttribute(idBytes, 3, true));
  const pickScene = new T.Scene();
  const idRoot = new T.Group();
  idRoot.rotation.x = -Math.PI / 2;
  idRoot.add(new T.Mesh(idGeo, new T.ShaderMaterial({
    side: T.DoubleSide,
    vertexShader: "attribute vec3 aId; varying vec3 vId; void main(){ vId = aId; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: "varying vec3 vId; void main(){ gl_FragColor = vec4(vId, 1.0); }",
  })));
  pickScene.add(idRoot);
  const rt = new T.WebGLRenderTarget(W(), H(), { minFilter: T.NearestFilter, magFilter: T.NearestFilter, depthBuffer: true });
  const px = new Uint8Array(4);
  let pickStale = true;
  const pick = (x, y) => {
    if (pickStale) {
      renderer.setRenderTarget(rt);
      renderer.setClearColor(0x000000, 1);
      renderer.clear();
      renderer.render(pickScene, camera);
      renderer.setRenderTarget(null);
      renderer.setClearColor(0x9aa4b2, 1);
      pickStale = false;
    }
    const ix = Math.max(0, Math.min(rt.width - 1, Math.round(x))), iy = Math.max(0, Math.min(rt.height - 1, Math.round(rt.height - 1 - y)));
    renderer.readRenderTargetPixels(rt, ix, iy, 1, 1, px);
    return (px[0] | (px[1] << 8) | (px[2] << 16)) - 1;
  };

  // ---- kamera: parcanin ortasi etrafinda dondur / yaklas / kaydir
  const target = new T.Vector3((bmin[0] + bmax[0]) / 2, (bmin[2] + bmax[2]) / 2, -(bmin[1] + bmax[1]) / 2);
  const R0 = diag / 2;
  const cam = { yaw: 0.6, pitch: 0.45, r: 3 };
  const fit = () => { // dikey ya da yatay goruş acisindan hangisi dardaysa ona gore sigdir
    const v = (camera.fov * Math.PI) / 360;
    const half = Math.min(v, Math.atan(Math.tan(v) * camera.aspect));
    cam.r = (R0 / Math.sin(half)) * 1.0;
  };
  fit();
  let queued = false;
  const draw = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      if (disposed) return;
      camera.position.set(
        target.x + cam.r * Math.cos(cam.pitch) * Math.sin(cam.yaw),
        target.y + cam.r * Math.sin(cam.pitch),
        target.z + cam.r * Math.cos(cam.pitch) * Math.cos(cam.yaw),
      );
      camera.near = Math.max(cam.r * 0.01, 0.05);
      camera.far = cam.r * 40;
      camera.lookAt(target);
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld(true);
      renderer.render(scene, camera);
    });
  };
  const moved = () => { pickStale = true; draw(); };
  const ro = new ResizeObserver(() => {
    if (disposed) return;
    renderer.setSize(W(), H());
    rt.setSize(W(), H());
    camera.aspect = W() / H();
    moved();
  });
  ro.observe(stage);

  // ---- renk tablosu + geri alma
  let color = palette[0]?.[1] || "#F2F2F2";
  const colIdx = (hex) => {
    hex = hex.toUpperCase();
    let i = cols.indexOf(hex);
    if (i < 0) {
      if (cols.length >= MAX_COLS) { toast(`Bir parçada en fazla ${MAX_COLS} renk`, 3500); return -1; }
      cols.push(hex);
      i = cols.length - 1;
    }
    return i;
  };
  const undo = []; // { tris:[], old:[] }
  let stroke = null;
  let lo = n, hi = -1;
  const flush = () => {
    if (hi < lo) return;
    colAttr.clearUpdateRanges?.();
    colAttr.addUpdateRange?.(lo * 9, (hi - lo + 1) * 9);
    colAttr.needsUpdate = true;
    lo = n; hi = -1;
    draw();
  };
  const apply = (list, ci, op) => {
    for (let k = 0; k < list.length; k++) {
      const t = list[k];
      if (idx[t] === ci) continue;
      op.tris.push(t);
      op.old.push(idx[t]);
      idx[t] = ci;
      setTri(t);
      if (t < lo) lo = t;
      if (t > hi) hi = t;
    }
    flush();
  };
  const commit = (op) => {
    if (!op.tris.length) return;
    undo.push(op);
    if (undo.length > 40) undo.shift();
    dirty = true;
    refresh();
  };
  const doOp = (list) => {
    const ci = colIdx(color);
    if (ci < 0) return;
    const op = { tris: [], old: [] };
    apply(list, ci, op);
    commit(op);
  };

  // ---- araclar
  let tool = "face";
  let sens = "orta";
  let radius = 40; // 0-100 kaydirici
  const brushR = () => diag * 0.002 * Math.pow(75, radius / 100);
  const regions = {}; // derece -> { reg, starts, items }
  async function regionsFor(deg) {
    if (regions[deg]) return regions[deg];
    status.hidden = false;
    status.textContent = "Yüzeyler hesaplanıyor…";
    try {
      const reg = new Uint32Array(await getBytes(`/api/parts/regions/${file}/${part.key}/${deg}`));
      let nr = 0;
      for (let t = 0; t < n; t++) if (reg[t] >= nr) nr = reg[t] + 1;
      const starts = new Uint32Array(nr + 1);
      for (let t = 0; t < n; t++) starts[reg[t] + 1]++;
      for (let i = 0; i < nr; i++) starts[i + 1] += starts[i];
      const fill = starts.slice(0, nr);
      const items = new Uint32Array(n);
      for (let t = 0; t < n; t++) items[fill[reg[t]]++] = t;
      return (regions[deg] = { reg, starts, items });
    } finally {
      status.hidden = true;
    }
  }
  const nearBrush = (t0) => {
    const r2 = brushR() ** 2;
    const cx = cen[t0 * 3], cy = cen[t0 * 3 + 1], cz = cen[t0 * 3 + 2];
    const nx = nrm[t0 * 3], ny = nrm[t0 * 3 + 1], nz = nrm[t0 * 3 + 2];
    const out = [];
    for (let t = 0; t < n; t++) {
      const dx = cen[t * 3] - cx, dy = cen[t * 3 + 1] - cy, dz = cen[t * 3 + 2] - cz;
      if (dx * dx + dy * dy + dz * dz > r2) continue;
      if (nrm[t * 3] * nx + nrm[t * 3 + 1] * ny + nrm[t * 3 + 2] * nz < 0.5) continue; // yalniz ayni yone bakan yuzey
      out.push(t);
    }
    return out;
  };

  // dilim: eksen + aralik (mm, parcanin o eksendeki en kucuk ucundan)
  const slab = { axis: 2, a: 0, b: Math.min(1, size[2]) };
  const slabTris = () => {
    const lo2 = bmin[slab.axis] + Math.min(slab.a, slab.b) - 0.001, hi2 = bmin[slab.axis] + Math.max(slab.a, slab.b) + 0.001;
    const out = [];
    for (let t = 0; t < n; t++) {
      const c = cen[t * 3 + slab.axis];
      if (c >= lo2 && c <= hi2) out.push(t);
    }
    return out;
  };
  const showSlab = () => {
    slabBox.visible = tool === "slab";
    if (!slabBox.visible) return;
    const a = Math.min(slab.a, slab.b), b = Math.max(slab.a, slab.b);
    const sc = [size[0] * 1.04, size[1] * 1.04, size[2] * 1.04];
    const ct = [(bmin[0] + bmax[0]) / 2, (bmin[1] + bmax[1]) / 2, (bmin[2] + bmax[2]) / 2];
    sc[slab.axis] = Math.max(b - a, diag * 0.002);
    ct[slab.axis] = bmin[slab.axis] + (a + b) / 2;
    slabBox.scale.set(...sc);
    slabBox.position.set(...ct);
    draw();
  };

  // ---- isaretci olaylari
  cv.style.touchAction = "none";
  const ptrs = new Map();
  let g = null; // surmekte olan hareket
  const local = (e) => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const orbit = (dx, dy) => {
    cam.yaw -= dx * 0.008;
    cam.pitch = Math.max(-1.5, Math.min(1.5, cam.pitch + dy * 0.008));
    moved();
  };
  const zoom = (f) => { cam.r = Math.max(R0 * 0.05, Math.min(R0 * 30, cam.r * f)); moved(); };
  const pan = (dx, dy) => {
    const k = (2 * cam.r * Math.tan((camera.fov * Math.PI) / 360)) / H();
    const right = new T.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    const upv = new T.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
    target.addScaledVector(right, -dx * k).addScaledVector(upv, dy * k);
    moved();
  };
  const two = () => { const [a, b] = [...ptrs.values()]; return { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 }; };
  cv.onpointerdown = (e) => {
    cv.setPointerCapture(e.pointerId);
    const [x, y] = local(e);
    ptrs.set(e.pointerId, { x, y });
    if (ptrs.size === 2) {
      if (stroke) { commit(stroke); stroke = null; }
      g = { kind: "multi", ...two() };
      return;
    }
    g = { kind: "one", x0: x, y0: y, drag: false };
    if (e.button === 2 || e.shiftKey) { g.kind = "pan"; return; }
    if (tool === "brush") {
      const t = pick(x, y);
      if (t >= 0) {
        g.kind = "paint";
        stroke = { tris: [], old: [] };
        const ci = colIdx(color);
        if (ci < 0) { g.kind = "one"; stroke = null; return; }
        g.ci = ci;
        apply(nearBrush(t), ci, stroke);
      }
    }
  };
  cv.onpointermove = (e) => {
    const p = ptrs.get(e.pointerId);
    if (!p || !g) return;
    const [x, y] = local(e);
    const dx = x - p.x, dy = y - p.y;
    p.x = x; p.y = y;
    if (g.kind === "multi" && ptrs.size === 2) {
      const s = two();
      zoom(g.d / s.d);
      pan(s.mx - g.mx, s.my - g.my);
      Object.assign(g, s);
    } else if (g.kind === "paint") {
      const t = pick(x, y);
      if (t >= 0) apply(nearBrush(t), g.ci, stroke);
    } else if (g.kind === "pan") {
      pan(dx, dy);
    } else if (g.kind === "one") {
      if (Math.hypot(x - g.x0, y - g.y0) > 6) g.drag = true;
      if (g.drag) orbit(dx, dy);
    }
  };
  const end = async (e) => {
    const p = ptrs.get(e.pointerId);
    ptrs.delete(e.pointerId);
    if (!g || !p) return;
    if (g.kind === "paint" && stroke) { commit(stroke); stroke = null; }
    if (g.kind === "one" && !g.drag && tool === "face" && e.type === "pointerup") {
      const t = pick(p.x, p.y);
      if (t >= 0) {
        try {
          const r = await regionsFor(REGION[sens]);
          doOp(r.items.subarray(r.starts[r.reg[t]], r.starts[r.reg[t] + 1]));
        } catch (err) {
          toast(err.message, 4000);
        }
      }
    }
    if (ptrs.size === 0) g = null;
    else if (ptrs.size === 1) g = { kind: "one", x0: 0, y0: 0, drag: true };
  };
  cv.onpointerup = end;
  cv.onpointercancel = end;
  cv.oncontextmenu = (e) => e.preventDefault();
  cv.onwheel = (e) => { e.preventDefault(); zoom(Math.exp(e.deltaY * 0.0012)); };

  // ---- kontrol paneli
  const hint = el("div", "pn-hint");
  const tools = el("div", "pn-tools");
  const opts = el("div", "pn-opts");
  const sw = el("div", "pt-colors pn-sw");
  const acts = el("div", "pn-acts");
  const views = el("div", "pn-views");
  ctl.append(tools, hint, opts, sw, views, acts);

  const TOOLS = [
    ["face", "Yüzey", "Bir yüzeye dokun: o düz/yuvarlak yüzeyin tamamı seçili renge boyanır. Sürükleyerek döndür."],
    ["brush", "Fırça", "Parmağınla sürükleyerek boya (iki parmakla yakınlaştır / kaydır). Boş yere sürüklersen döner."],
    ["slab", "Dilim", "Bir eksende başlangıç–bitiş (mm) aralığını boya; örn. alttan ilk 1,2 mm."],
    ["orbit", "Döndür", "Sürükleyerek döndür, iki parmakla yakınlaştır / kaydır."],
  ];
  function paintTools() {
    tools.textContent = "";
    for (const [id, label] of TOOLS) {
      const b = el("button", `chip${tool === id ? " on" : ""}`, label);
      b.type = "button";
      b.onclick = () => { tool = id; paintTools(); paintOpts(); showSlab(); };
      tools.append(b);
    }
    hint.textContent = TOOLS.find((x) => x[0] === tool)[2];
  }
  function row(label, ...nodes) {
    const r = el("div", "pn-row");
    r.append(el("span", "pn-lab", label), ...nodes);
    return r;
  }
  function paintOpts() {
    opts.textContent = "";
    if (tool === "face") {
      const w = el("div", "pn-seg");
      for (const [k, label] of [["dar", "Dar"], ["orta", "Orta"], ["genis", "Geniş"]]) {
        const b = el("button", `chip${sens === k ? " on" : ""}`, label);
        b.type = "button";
        b.onclick = () => { sens = k; paintOpts(); };
        w.append(b);
      }
      opts.append(row("Yüzey genişliği", w), el("div", "pn-sub", "Dar: yalnız aynı düz yüzey · Geniş: hafif kıvrımlı komşu yüzeyleri de katar"));
    } else if (tool === "brush") {
      const rg = el("input");
      rg.type = "range";
      rg.min = "0"; rg.max = "100"; rg.value = String(radius);
      const val = el("span", "pn-val", `${fmt(brushR())} mm`);
      rg.oninput = () => { radius = Number(rg.value); val.textContent = `${fmt(brushR())} mm`; };
      opts.append(row("Fırça boyu", rg, val));
    } else if (tool === "slab") {
      const w = el("div", "pn-seg");
      for (const [i, label] of [[0, "X"], [1, "Y"], [2, "Z (yukarı)"]]) {
        const b = el("button", `chip${slab.axis === i ? " on" : ""}`, label);
        b.type = "button";
        b.onclick = () => { slab.axis = i; slab.a = 0; slab.b = Math.min(1, size[i]); paintOpts(); showSlab(); };
        w.append(b);
      }
      const mk = (k) => {
        const inp = el("input", "text-input pn-num");
        inp.type = "number";
        inp.step = "0.1"; inp.min = "0"; inp.max = String(+size[slab.axis].toFixed(2));
        inp.value = String(+slab[k].toFixed(2));
        inp.inputMode = "decimal";
        inp.oninput = () => { const v = parseFloat(String(inp.value).replace(",", ".")); if (Number.isFinite(v)) { slab[k] = Math.max(0, Math.min(size[slab.axis], v)); showSlab(); } };
        return inp;
      };
      const go = el("button", "btn sm primary", "Aralığı boya");
      go.type = "button";
      go.onclick = () => doOp(slabTris());
      opts.append(row("Eksen", w), row("Başlangıç / bitiş (mm)", mk("a"), mk("b")),
        el("div", "pn-sub", `Parça bu eksende ${fmt(size[slab.axis])} mm. 0 = en alt (en küçük) uç.`), go);
    }
  }
  function paintSw() {
    sw.textContent = "";
    for (const [name, hex] of palette) {
      const b = el("button", `pt-sw${color.toUpperCase() === hex.toUpperCase() ? " on" : ""}`);
      b.type = "button";
      b.style.background = hex;
      b.title = name;
      b.setAttribute("aria-label", name);
      b.onclick = () => { color = hex; paintSw(); };
      sw.append(b);
    }
    const c = el("input", "pn-custom");
    c.type = "color";
    c.title = "Başka renk";
    c.value = color.toLowerCase().slice(0, 7);
    c.oninput = () => { color = c.value.toUpperCase(); sw.querySelectorAll(".pt-sw").forEach((x) => x.classList.remove("on")); };
    sw.append(c);
  }
  function paintViews() {
    for (const [label, yaw, pitch] of [["Üst", cam.yaw, 1.5], ["Alt", cam.yaw, -1.5], ["Ön", 0, 0.1], ["Arka", Math.PI, 0.1], ["Sol", -Math.PI / 2, 0.1], ["Sağ", Math.PI / 2, 0.1]]) {
      const b = el("button", "chip pn-view", label);
      b.type = "button";
      b.onclick = () => { cam.yaw = yaw; cam.pitch = pitch; fit(); target.set((bmin[0] + bmax[0]) / 2, (bmin[2] + bmax[2]) / 2, -(bmin[1] + bmax[1]) / 2); moved(); };
      views.append(b);
    }
  }
  const undoBtn = el("button", "btn sm ghost", "Geri al");
  undoBtn.type = "button";
  undoBtn.onclick = () => {
    const op = undo.pop();
    if (!op) return;
    for (let k = 0; k < op.tris.length; k++) { idx[op.tris[k]] = op.old[k]; setTri(op.tris[k]); if (op.tris[k] < lo) lo = op.tris[k]; if (op.tris[k] > hi) hi = op.tris[k]; }
    flush();
    refresh();
  };
  const allBtn = el("button", "btn sm ghost", "Hepsini boya");
  allBtn.type = "button";
  allBtn.onclick = () => doOp(Array.from({ length: n }, (_, i) => i));
  const save = el("button", "btn sm primary", "Kaydet");
  save.type = "button";
  save.onclick = async () => {
    save.disabled = true;
    save.textContent = "Kaydediliyor…";
    try {
      const r = await fetch(`${API}/api/parts/paint/${file}/${part.key}?cols=${cols.map((c) => c.slice(1)).join(",")}`, {
        method: "PUT", credentials: "include", headers: { "content-type": "application/octet-stream" }, body: idx,
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.detail || `Kaydedilemedi (${r.status})`);
      dirty = false;
      cleanup();
      onDone({ rev: body.rev, cols: body.cols });
    } catch (e) {
      toast(e.message, 5000);
      save.disabled = false;
      save.textContent = "Kaydet";
    }
  };
  acts.append(undoBtn, allBtn, save);
  function refresh() { undoBtn.disabled = !undo.length; }
  title.textContent = `Boya: ${part.name} · ${dims3(size)} mm`;
  paintTools(); paintOpts(); paintSw(); paintViews(); refresh();
  moved();
}

const dims3 = (s) => s.map((x) => String(+x.toFixed(1)).replace(".", ",")).join(" × ");
