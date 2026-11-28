// Markalar (AI Studyo "Marka" sekmesi): marka secimi, Instagram baglantisi, marka kiti + urun katalogu;
// "Icerik" sekmesinde secili markanin urunleri ve hizli fikirleri.
// Veri sunucuda (data/brand.json); AI her videoda secili markanin kitini, urununu, logosunu ve kapanis kartini kullanir.
// Instagram baglantisi tektir (ayni Facebook hesabi); video, markanin Instagram adiyla eslesen hesaba yuklenir.
import { $, API, api, el, toast, uid, url } from "./api.js";
import { confirmBox } from "./dialog.js";
import { openMedia } from "./ui.js";
import { openPainter } from "./painter.js";

let brands = [];
let ideas = {};
let palette = []; // klasik 3B yazici renkleri [[ad, hex]] (sunucudan)
let ig = null; // /api/instagram/status
let yt = null; // /api/youtube/status
let ytPending = false; // Google izin sekmesi acildi: geri donulunce durum tazelenir
let ctx = null; // { opts, save, setPrompt, onChange }
let pickFor = null; // Drive'dan gelen gorselin ekleneceği yer: { kind: "logo" } | { kind: "product", product }
const drafts = {}; // marka id -> kaydedilmemis duzenleme
let exportPick = ""; // disa aktar penceresinde secilen marka

const FIELDS = [
  ["name", "Marka adı"], ["tagline", "Slogan"], ["site", "Web sitesi"], ["handle", "Instagram"],
  ["whatsapp", "WhatsApp"], ["cta", "Kapanış çağrısı (CTA)"], ["audience", "Hedef kitle"], ["tone", "Anlatım tonu"],
  ["hashtags", "Marka etiketleri"],
];
const DEFAULT_COLORS = ["#1E293B", "#3B82F6", "#F8F9FB"];

const clone = (o) => JSON.parse(JSON.stringify(o));
const byId = (id) => brands.find((b) => b.id === id);
const curId = () => (byId(ctx?.opts.brand) ? ctx.opts.brand : brands[0]?.id || "");
// eski ayarlarda marka true/false idi: gecerli bir marka ve satista olan urun secili olsun
function normalize() {
  if (!ctx || !brands.length) return;
  let dirty = false;
  if (!byId(ctx.opts.brand)) {
    ctx.opts.brand = brands[0].id;
    dirty = true;
  }
  const cur = byId(ctx.opts.brand);
  if (ctx.opts.product && !cur?.products?.some((p) => p.id === ctx.opts.product)) {
    ctx.opts.product = "";
    dirty = true;
  }
  if (dirty) ctx.save();
}
const draftOf = (id) => {
  if (!drafts[id] && byId(id)) drafts[id] = clone(byId(id));
  return drafts[id];
};

export const getBrand = () => byId(curId()) || null;

// Secili (ya da verilen) markanin Instagram durumu: { id, name, handle, connected, linked, username, expires }
export function igTarget(id = curId()) {
  const b = byId(id);
  const s = ig?.brands?.find((x) => x.id === id);
  return {
    id, name: b?.name || "", handle: b?.handle || "", connected: Boolean(ig?.connected),
    linked: Boolean(s?.linked), username: s?.username || "", expires: s?.expires ?? null, loaded: Boolean(ig),
  };
}

// Markanin YouTube kanali (Shorts): linked = kanal bagli ve belirteci gecerli
export function ytTarget(id = curId()) {
  const s = yt?.brands?.find((x) => x.id === id);
  const ch = s?.channel || null;
  return {
    id, name: byId(id)?.name || s?.name || "", configured: Boolean(yt?.configured), channel: ch,
    auto: s ? s.auto !== false : true, linked: Boolean(ch && !ch.error), loaded: Boolean(yt),
  };
}

export async function refreshYt() {
  try {
    yt = await api("/api/youtube/status");
  } catch (e) {
    if (!yt) yt = { configured: false, brands: [] };
  }
  renderYt();
  ctx?.onChange?.();
  return yt;
}

// Kimlik ve gizli anahtar tek kutuya birlikte (arada bosluk) ya da indirilen JSON olarak da yapistirilabilir:
// telefonda iki ayri kutu arasinda sekme degistirmek kutuyu kapatabiliyor
const YT_ID_RE = /\d+-[0-9a-z]+\.apps\.googleusercontent\.com/;
const YT_SEC_RE = /GOCSPX-[A-Za-z0-9_-]+/;
async function ytConfig() {
  const first = prompt("Client ID ve Client secret'ı yapıştır (ikisi birlikte, arada boşlukla; ya da önce yalnız Client ID)", yt?.client_id || "");
  if (first === null || !first.trim()) return false;
  const cid = (first.match(YT_ID_RE) || [first.trim()])[0];
  let sec = (first.match(YT_SEC_RE) || [""])[0];
  if (!sec) {
    sec = prompt("Client secret (GOCSPX- ile başlar)");
    if (sec === null || !sec.trim()) return false;
    sec = (sec.match(YT_SEC_RE) || [sec.trim()])[0];
  }
  try {
    yt = await api("/api/youtube/config", { method: "POST", body: { client_id: cid, client_secret: sec } });
    toast("OAuth istemcisi kaydedildi");
    return true;
  } catch (e) {
    toast(e.message, 5000);
    return false;
  }
}

// Google izin sayfasi yeni sekmede acilir (acilir pencere engeline takilmasin diye sekme tiklamada acilir, adresi sonra
// verilir); donus sayfasi kanali kaydeder, bu sekmeye donulunce durum tazelenir
export async function linkYoutube(id = curId()) {
  if (!yt?.configured && !(await ytConfig())) {
    renderYt();
    return;
  }
  const w = window.open("", "_blank");
  try {
    const { url: u } = await api("/api/youtube/auth", { method: "POST", body: { brand: id } });
    ytPending = true;
    if (w) w.location.href = u;
    else location.href = u;
  } catch (e) {
    if (w) w.close();
    toast(e.message, 5000);
  }
}

window.addEventListener("message", (e) => {
  if (e.data?.type === "youtube:linked") { ytPending = false; refreshYt(); }
});
window.addEventListener("focus", () => {
  if (ytPending) { ytPending = false; refreshYt(); }
});

function renderYt() {
  const box = $("#stYtBody");
  if (!box) return;
  box.textContent = "";
  const t = ytTarget();
  const line = (cls, text) => box.append(el("div", `st-ig-line ${cls}`, text));
  if (!yt) {
    line("", "Yükleniyor…");
  } else if (!t.configured) {
    line("warn", "YouTube bağlı değil. Önce Google Cloud'da oluşturduğun OAuth istemcisini gir, sonra kanalı bağla.");
    line("", "OAuth istemcisinde yetkili yönlendirme adresi olarak bunu ekle:");
    line("mono", yt.redirect_uri || "");
  } else if (!t.channel) {
    line("warn", `${t.name} için YouTube kanalı bağlı değil.`);
  } else if (t.channel.error) {
    line("warn", t.channel.error);
  } else {
    const c = t.channel;
    line("ok", `✓ ${t.name} videoları ${c.title}${c.handle ? ` (${c.handle})` : ""} kanalına Shorts olarak yüklenir.`);
  }
  if (t.channel) {
    const lab = el("label", "st-yt-auto");
    const cb = el("input");
    cb.type = "checkbox";
    cb.checked = t.auto;
    cb.onchange = async () => {
      try {
        yt = await api("/api/youtube/brand", { method: "POST", body: { brand: t.id, auto: cb.checked } });
        toast(cb.checked ? "Instagram'a giden videolar YouTube'a da yüklenecek" : "Otomatik YouTube yüklemesi kapatıldı");
      } catch (e) {
        toast(e.message, 4000);
      }
      renderYt();
      ctx?.onChange?.();
    };
    lab.append(cb, document.createTextNode("Instagram'a giden her video (otomatik Reels dahil) aynı anda YouTube Shorts olarak da yüklensin"));
    box.append(lab);
  }
  const acts = el("div", "st-ig-acts");
  const btn = (text, cls, fn) => {
    const b = el("button", cls, text);
    b.type = "button";
    b.onclick = fn;
    acts.append(b);
  };
  btn(t.channel ? (t.channel.error ? "Yeniden bağla" : "Kanalı değiştir") : "YouTube'u bağla", "btn sm", () => linkYoutube(t.id));
  if (t.channel) {
    btn("Bağlantıyı kaldır", "btn ghost sm", async () => {
      const ok = await confirmBox({ title: "YouTube bağlantısı kaldırılsın mı?", text: `${t.name} videoları artık YouTube'a yüklenmez.`, ok: "Kaldır", cancel: "Vazgeç", danger: true });
      if (!ok) return;
      try {
        yt = await api("/api/youtube/brand", { method: "POST", body: { brand: t.id, unlink: true } });
      } catch (e) {
        toast(e.message, 4000);
      }
      renderYt();
      ctx?.onChange?.();
    });
  }
  if (yt?.configured) btn("OAuth istemcisini değiştir", "btn ghost sm", async () => { await ytConfig(); renderYt(); });
  box.append(acts);
}

async function load(refresh = false) {
  try {
    const r = await api(`/api/brand${refresh ? "?refresh=1" : ""}`);
    brands = r.brands || [];
    ideas = r.ideas || {};
    palette = r.palette || [];
  } catch (e) {
    if (!brands.length) brands = [];
  }
}

export async function refreshBrand(force = false) {
  const prevJson = JSON.stringify(brands.map((b) => [b.id, (b.products || []).map((p) => [p.id, p.name, p.price])]));
  await load(force);
  normalize();
  const nextJson = JSON.stringify(brands.map((b) => [b.id, (b.products || []).map((p) => [p.id, p.name, p.price])]));
  if (force || prevJson !== nextJson) {
    for (const b of brands) {
      if (b.site_synced) drafts[b.id] = clone(b);
    }
    renderSwitch();
    keepOpen(renderEditor);
    renderQuick();
    ctx?.onChange?.();
  }
}

export async function refreshIg(rescan = false) {
  try {
    ig = await api(`/api/instagram/status${rescan ? "?refresh=1" : ""}`);
  } catch (e) {
    if (!ig) ig = { connected: false, brands: [] };
  }
  renderIg();
  renderExportBox();
  ctx?.onChange?.();
  return ig;
}

function input(label, value, onInput, { area = false, rows = 2, ph = "" } = {}) {
  const f = el("label", "field");
  f.append(el("div", "field-head", label));
  const i = el(area ? "textarea" : "input", "text-input");
  if (area) i.rows = rows;
  i.value = value || "";
  i.placeholder = ph;
  i.autocomplete = "off";
  i.oninput = () => onInput(i.value);
  f.append(i);
  return f;
}

function imageStrip(paths, onRemove, onAdd, label) {
  const row = el("div", "br-imgs");
  paths.forEach((p, i) => {
    const w = el("div", "br-img");
    const im = el("img");
    im.alt = "";
    im.src = url.thumb(p);
    const x = el("button", "br-x", "✕");
    x.type = "button";
    x.title = "Kaldır";
    x.onclick = () => onRemove(i);
    w.append(im, x);
    row.append(w);
  });
  const add = el("button", "br-add", label);
  add.type = "button";
  add.onclick = onAdd;
  row.append(add);
  return row;
}

function productCard(draft, p, rerender) {
  const d = el("details", "br-prod");
  const sum = el("summary", "", p.name || "Yeni ürün");
  d.append(sum);
  d.append(input("Ürün adı", p.name, (v) => { p.name = v; sum.textContent = v || "Yeni ürün"; }));
  const row = el("div", "st-row");
  row.append(input("Fiyat", p.price, (v) => { p.price = v; }, { ph: "289 TL" }),
    input("Bağlantı", p.url, (v) => { p.url = v; }, { ph: draft.site ? `${draft.site}/urun/…` : "site.com/urun/…" }));
  d.append(row);
  d.append(input("Kısa açıklama", p.desc, (v) => { p.desc = v; }, { area: true }));
  d.append(input("Öne çıkan özellikler (her satıra bir tane)", (p.features || []).join("\n"),
    (v) => { p.features = v.split("\n").map((x) => x.trim()).filter(Boolean); }, { area: true, rows: 4 }));
  const imgs = el("div", "field");
  imgs.append(el("div", "field-head", "Ürün görselleri"));
  imgs.append(imageStrip(p.images || [], (i) => { p.images.splice(i, 1); rerender(); },
    () => { pickFor = { kind: "product", product: p }; openMedia("image", "brand"); }, "+ Görsel"));
  d.append(imgs);
  d.append(partsSection(draft, p));
  if (!draft.site_synced) {
    const del = el("button", "btn danger sm", "Ürünü sil");
    del.type = "button";
    del.onclick = () => {
      draft.products = draft.products.filter((x) => x !== p);
      if (ctx.opts.product === p.id) { ctx.opts.product = ""; ctx.save(); }
      rerender();
    };
    d.append(del);
  }
  return d;
}

// ---- 3B model: urun basina 3MF (SolidWorks montaji) ya da tek parca STL; parca-parca renk, onizleme, onay ----
const dimText = (d) => `${d.map((x) => String(+Number(x).toFixed(1)).replace(".", ",")).join(" × ")} mm`;
const mb = (n) => String(+(n / 1048576).toFixed(1)).replace(".", ",");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// XMLHttpRequest: fetch yukleme ilerlemesini vermez. onProgress(oran 0-1); gonderim bitince sunucu dosyayi okur (oran 1)
function uploadModel(file, onProgress, prev = "") {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open("POST", `${API}/api/parts/upload?name=${encodeURIComponent(file.name)}&prev=${encodeURIComponent(prev)}`);
    x.withCredentials = true;
    x.setRequestHeader("content-type", "application/octet-stream");
    x.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    x.onload = () => {
      let body = null;
      try { body = JSON.parse(x.responseText); } catch (e) { /* govde yok */ }
      if (x.status >= 200 && x.status < 300 && body) return resolve(body);
      const msg = x.status === 413
        ? "Dosya en fazla 90 MB olabilir"
        : x.status >= 502
          ? "Sunucuya ulaşılamadı — sunucu kapalı veya bağlantı yok."
          : (body?.detail || `Yükleme başarısız (${x.status})`);
      reject(new Error(msg));
    };
    x.onerror = () => reject(new Error("Bağlantı koptu, yükleme tamamlanmadı. Tekrar dene."));
    x.ontimeout = () => reject(new Error("Yükleme zaman aşımına uğradı. Tekrar dene."));
    x.onabort = () => reject(new Error("Yükleme iptal edildi"));
    x.send(file);
  });
}

// Yukleme durumu urun kartinin disinda tutulur: kart yeniden cizilse (gorsel ekle, urun sil...) cubuk ve sonuc kaybolmasin.
const uploads = new Map(); // "marka/urun" -> { pct, text, err }
const views = new Map(); // "marka/urun" -> en son cizilen bolum { paint, bar }

function partsSection(draft, p) {
  const key = `${draft.id}/${p.id}`;
  const sec = el("div", "field pt-sec");
  sec.append(el("div", "field-head", "3B model (3MF)"));
  const body = el("div", "pt-body");
  const status = el("div", "pt-status");
  const touch = () => { p._dirty = true; paintStatus(); };
  const imgs = new Map(); // parca anahtari -> resim kutusu
  const view = { paint: () => paintBody(), bar: () => paintUp() };
  views.set(key, view);
  const live = () => views.get(key) === view;

  function paintStatus() {
    const m = p.model;
    status.hidden = !m;
    if (!m) return;
    const st = p.model3d?.state;
    status.className = "pt-status";
    if (!p._dirty && st === "approved") {
      status.classList.add("ok");
      status.textContent = "✓ Model kayıtlı. AI videolarda bu hazır modeli kullanır, yeniden kurmaz.";
    } else if (p._dirty || st === "stale") {
      status.classList.add("warn");
      status.textContent = "Ayarlar değişti: yeniden önizleyip onayla.";
    } else {
      status.textContent = "Henüz önizlenmedi. Önizle, doğruysa kaydet.";
    }
  }

  // ---- dosya secimi + yukleme cubugu
  const fi = el("input");
  fi.type = "file";
  fi.accept = ".3mf,.stl,model/3mf,model/stl";
  fi.hidden = true;
  const up = el("div", "pt-up");
  const bar = el("div", "pt-bar");
  const fill = el("i");
  bar.append(fill);
  const txt = el("div", "pt-up-txt");
  up.append(bar, txt);
  function paintUp() {
    const u = uploads.get(key);
    up.hidden = !u;
    if (!u) return;
    up.className = `pt-up${u.err ? " err" : ""}`;
    fill.style.width = `${u.pct}%`;
    txt.textContent = u.text;
  }
  fi.onchange = async () => {
    const f = fi.files?.[0];
    fi.value = "";
    if (!f) return;
    if (!/\.(3mf|stl)$/i.test(f.name)) return toast("Yalnızca .3mf ya da .stl dosyası", 4000);
    if (f.size > 90 * 1024 * 1024) return toast("Dosya en fazla 90 MB olabilir", 4000);
    if (uploads.get(key) && !uploads.get(key).err) return;
    const u = { pct: 0, text: `%0 · ${mb(f.size)} MB`, err: false };
    uploads.set(key, u);
    views.get(key)?.paint();
    try {
      const r = await uploadModel(f, (v) => {
        u.pct = Math.round(v * 100);
        u.text = u.pct >= 100 ? "Sunucu dosyayı işliyor, parçalar ayrılıyor…" : `%${u.pct} · ${mb(v * f.size)} / ${mb(f.size)} MB`;
        views.get(key)?.bar();
      }, p.model?.file || "");
      uploads.delete(key);
      const cur = draftOf(draft.id)?.products.find((x) => x.id === p.id);
      if (cur) {
        const old = new Map((cur.model?.parts || []).map((x) => [x.key, x])); // ayni parca: renk/ad korunur
        for (const x of r.parts) {
          const o = old.get(x.key);
          if (o) Object.assign(x, { name: o.name, color: o.color, paint: o.paint || null });
        }
        const same = cur.model?.file === r.file;
        cur.model = { ...r, up: same ? cur.model.up : "z", front: same ? cur.model.front || 0 : 0, front_note: same ? cur.model.front_note || "" : "" };
        cur._dirty = true;
      }
    } catch (e) {
      Object.assign(u, { err: true, text: `Yüklenemedi: ${e.message}` });
      toast(e.message, 5000);
    }
    views.get(key)?.paint();
  };

  function pickBtn(label) {
    const b = el("button", "btn sm pt-pick", label);
    b.type = "button";
    b.onclick = () => fi.click();
    return b;
  }

  // ---- parca resimleri (sunucu cizer; hazir olunca yerine konur)
  async function pollThumbs() {
    const m = p.model;
    if (!m) return;
    const { file, up: ax } = m;
    for (let i = 0; i < 200; i++) {
      let r;
      try {
        r = await api(`/api/parts/thumbs/${file}/${ax}`);
      } catch (e) {
        return;
      }
      if (!live() || p.model?.file !== file || p.model.up !== ax) return;
      if (r.status === "done") {
        for (const [k, im] of imgs) { im.src = `${API}/api/parts/thumb/${file}/${ax}/${k}.jpg`; im.classList.add("ok"); }
        return;
      }
      if (r.status === "error") return;
      await sleep(1500);
    }
  }

  function swatches(part, onPick) {
    const row = el("div", "pt-colors");
    for (const [name, hex] of palette) {
      const b = el("button", "pt-sw");
      b.type = "button";
      b.style.background = hex;
      b.title = name;
      b.dataset.hex = hex;
      b.setAttribute("aria-label", name);
      b.onclick = () => { part.color = hex; touch(); onPick(); };
      row.append(b);
    }
    if (part.hint) {
      const h = el("button", "chip pt-hint");
      h.type = "button";
      h.dataset.hex = part.hint;
      h.append(el("i"), document.createTextNode("Dosyadaki renk"));
      h.firstChild.style.background = part.hint;
      h.onclick = () => { part.color = part.hint; touch(); onPick(); };
      row.append(h);
    }
    const m = el("button", "chip pt-multi", "Çok renkli · boya");
    m.type = "button";
    m.onclick = () => paintPart(part, onPick);
    row.append(m);
    return row;
  }

  // 3B boyama penceresi: kaydedilince parca "boyali" (color: multi) olur
  function paintPart(part, onDone) {
    openPainter({
      file: p.model.file, up: p.model.up, part, palette,
      onDone: (paint) => { Object.assign(part, { color: "multi", paint }); touch(); onDone(); },
    });
  }

  function partRow(part) {
    const row = el("div", "pt-row");
    const im = el("img", "pt-img");
    im.alt = "";
    imgs.set(part.key, im);
    const main = el("div", "pt-main");
    const nm = el("input", "text-input pt-name");
    nm.value = part.name || "";
    nm.placeholder = "Parça adı";
    nm.autocomplete = "off";
    nm.oninput = () => { part.name = nm.value; touch(); };
    const dims = el("div", "pt-dims", `${part.count > 1 ? `${part.count} adet · ` : ""}${dimText(part.dims || [0, 0, 0])}`);
    const need = el("div", "pt-need", "Renk seçilmedi");
    const painted = el("div", "pt-painted");
    const edit = el("button", "btn sm ghost", "Boyamayı düzenle");
    edit.type = "button";
    edit.onclick = () => paintPart(part, sync);
    const sync = () => {
      row.querySelectorAll(".pt-sw, .pt-hint").forEach((x) => x.classList.toggle("on", x.dataset.hex === part.color));
      row.querySelector(".pt-multi").classList.toggle("on", part.color === "multi");
      need.hidden = Boolean(part.color);
      painted.hidden = part.color !== "multi";
      painted.textContent = "";
      if (part.color === "multi") {
        painted.append(el("span", "pt-painted-txt", `Boyandı · ${part.paint?.cols?.length || 0} renk`), edit);
      }
    };
    main.append(nm, dims, swatches(part, sync), need, painted);
    row.append(im, main);
    sync();
    return row;
  }

  function paintBody() {
    body.textContent = "";
    imgs.clear();
    const m = p.model;
    const u = uploads.get(key);
    if (!m) {
      body.append(el("div", "pt-help", "SolidWorks'te montajı 3MF olarak dışa aktar (Dosya → Farklı Kaydet → 3MF), buraya yükle; parçaları ayırıp her biri için renk soracağım. Birden fazla renkli parçayı 3B görünümde kendin boyarsın. Tek parça için STL de olur."));
      const acts = el("div", "pt-acts");
      acts.append(pickBtn(u && !u.err ? "Yükleniyor…" : "3MF / STL dosyası seç"));
      if (u && !u.err) acts.firstChild.disabled = true;
      body.append(acts, up);
      paintUp();
      paintStatus();
      return;
    }
    const head = el("div", "pt-mhead");
    head.append(el("div", "pt-mname", `${m.name} · ${m.parts.length} parça, ${m.parts.reduce((n, x) => n + x.count, 0)} adet`));
    const swap = pickBtn(u && !u.err ? "Yükleniyor…" : "Dosyayı değiştir");
    if (u && !u.err) swap.disabled = true;
    const del = el("button", "br-x pt-x", "✕");
    del.type = "button";
    del.title = "Modeli kaldır";
    del.onclick = async () => {
      if (!(await confirmBox({ title: "Model kaldırılsın mı?", text: "Seçtiğin renkler de silinir.", ok: "Kaldır" }))) return;
      p.model = null;
      touch();
      paintBody();
    };
    head.append(swap, del);
    body.append(head, up);
    const upRow = el("div", "pt-uprow");
    upRow.append(el("span", "pt-uplabel", "Modelin üstü:"));
    for (const [v, label] of [["z", "Z yukarı"], ["y", "Y yukarı"]]) {
      const c = el("button", `chip${m.up === v ? " on" : ""}`, label);
      c.type = "button";
      c.onclick = () => {
        if (m.up === v) return;
        m.up = v;
        m.front = 0; // ön yüz seçimi üst eksene bağlı: yeniden seçilsin
        touch();
        paintFront();
        upRow.querySelectorAll(".chip").forEach((x) => x.classList.toggle("on", x === c));
        for (const im of imgs.values()) { im.removeAttribute("src"); im.classList.remove("ok"); }
        pollThumbs();
      };
      upRow.append(c);
    }
    upRow.append(el("div", "pt-uphelp", "Önizlemede model yan yatık çıkarsa Y yukarı'yı dene."));
    body.append(upRow);
    const frontRow = el("div", "pt-frontrow");
    function paintFront() {
      frontRow.textContent = "";
      const pick = el("button", "btn sm", m.front ? "Ön yüzü değiştir" : "Ön yüzü seç");
      pick.type = "button";
      pick.onclick = () => pickFront(p, () => { touch(); paintFront(); });
      const note = el("input", "pt-frontnote");
      note.type = "text";
      note.maxLength = 200;
      note.placeholder = "Ön yüz nasıl tarif edilir? (ör. telefon numarasının göründüğü yüz)";
      note.value = m.front_note || "";
      note.oninput = () => { m.front_note = note.value; p._dirty = true; };
      frontRow.append(el("span", "pt-uplabel", "Ürünün ön yüzü:"), pick,
        el("span", "pt-frontstate", m.front ? `seçildi (${m.front * 90}° döndürüldü)` : "varsayılan"), note,
        el("div", "pt-uphelp", "AI videolarda ürün arkası dönük çıkıyorsa buradan gerçek ön yüzü işaretle; önizleme, görünümler ve dönen video ön yüzden başlar."));
    }
    paintFront();
    body.append(frontRow);
    const list = el("div", "pt-list");
    for (const part of m.parts) list.append(partRow(part));
    body.append(list);
    const acts = el("div", "pt-acts");
    const prev = el("button", "btn sm primary pt-prev", "Önizleme oluştur");
    prev.type = "button";
    prev.onclick = async () => {
      prev.disabled = true;
      try {
        await runPreview(draft, p);
      } finally {
        prev.disabled = false;
      }
    };
    acts.append(prev);
    body.append(acts);
    paintUp();
    paintStatus();
    pollThumbs();
  }

  sec.append(body, status, fi);
  paintBody();
  return sec;
}

function previewModal() {
  const scrim = el("div", "dlg-scrim");
  const box = el("div", "dlg pt-dlg");
  scrim.append(box);
  document.body.append(scrim);
  const close = () => { scrim.classList.add("out"); setTimeout(() => scrim.remove(), 140); };
  return { box, close };
}

// Modeli dört yönden gösterir; "ön yüz bu" denen yön m.front olur (sunucu modeli o yüz öne gelecek şekilde döndürür)
async function pickFront(p, done) {
  const m = p.model;
  if (!m) return;
  const { file, up } = m;
  const dlg = previewModal();
  let closed = false;
  const shut = dlg.close;
  dlg.close = () => { closed = true; shut(); };
  dlg.box.append(el("div", "dlg-title", "Ön yüzü seç"));
  const msg = el("div", "dlg-text", "Resimler hazırlanıyor…");
  const grid = el("div", "pt-fronts");
  const acts = el("div", "dlg-actions");
  const cancel = el("button", "btn ghost", "Vazgeç");
  cancel.type = "button";
  cancel.onclick = dlg.close;
  acts.append(cancel);
  dlg.box.append(msg, grid, acts);
  for (let i = 0; i < 200 && !closed; i++) {
    let r;
    try {
      r = await api(`/api/parts/fronts/${file}/${up}`);
    } catch (e) {
      msg.textContent = e.message;
      return;
    }
    if (r.status === "error") { msg.textContent = "Resimler çizilemedi, tekrar dene."; return; }
    if (r.status === "done") break;
    await sleep(1500);
  }
  if (closed) return;
  msg.textContent = "Ürünün müşteriye gösterilen ön yüzü hangisi? (Montajlanmış, kullanıma hazır hali.) Başka bir yüz görünüyorsa onu seç.";
  const cur = m.front || 0;
  for (let i = 0; i < 4; i++) {
    const b = el("button", `pt-front${i === cur ? " on" : ""}`);
    b.type = "button";
    const im = el("img");
    im.src = `${API}/api/parts/front/${file}/${up}/${i}.jpg`;
    im.alt = `Yön ${i + 1}`;
    b.append(im);
    b.onclick = () => {
      m.front = i; // resimler ham modelden çizilir: i. resim = i. yüz; sunucu o yüzü öne çevirir
      dlg.close();
      done();
    };
    grid.append(b);
  }
}

async function runPreview(draft, p) {
  const model = p.model;
  if (!model) return toast("Önce bir 3MF yükle");
  const none = model.parts.find((x) => !x.color);
  if (none) return toast(`"${none.name}" için renk seç ya da boya`, 4500);
  const bad = model.parts.find((x) => x.color === "multi" && !x.paint);
  if (bad) return toast(`"${bad.name}" için boyama yap`, 4500);
  const ok = await confirmBox({
    title: "Önizleme oluşturulsun mu?",
    text: "Model sunucuda çizilir; birkaç saniye ile bir dakika sürebilir.",
    ok: "Evet, oluştur",
  });
  if (!ok) return;
  const m = previewModal();
  let stop = false;
  const title = el("div", "dlg-title", "Önizleme hazırlanıyor");
  const msg = el("div", "dlg-text", "Başlıyor…");
  const bar = el("div", "pt-bar");
  const fill = el("i");
  bar.append(fill);
  const hide = el("button", "btn ghost", "Kapat");
  hide.type = "button";
  hide.onclick = () => { stop = true; m.close(); };
  const acts = el("div", "dlg-actions");
  acts.append(hide);
  m.box.append(title, msg, bar, acts);
  const fail = (text) => {
    title.textContent = "Önizleme yapılamadı";
    msg.textContent = text;
    bar.remove();
  };
  let job;
  try {
    job = (await api("/api/parts/preview", { method: "POST", body: {
      brand: draft.id, product: p.id,
      model: { file: model.file, up: model.up, front: model.front || 0, front_note: model.front_note || "", parts: model.parts.map(({ key, name, color, paint }) => ({ key, name, color, paint })) },
    } })).job;
  } catch (e) {
    return fail(e.message);
  }
  for (;;) {
    await new Promise((r) => setTimeout(r, 1000));
    if (stop) return;
    let j;
    try {
      j = await api(`/api/parts/job/${job}`);
    } catch (e) {
      return fail(e.message);
    }
    msg.textContent = j.message || "";
    fill.style.width = `${Math.round((j.progress || 0) * 100)}%`;
    if (j.status === "error") return fail(j.error || "Bilinmeyen hata");
    if (j.status === "done") {
      showPreview(m, draft, p, job, j.result);
      return;
    }
  }
}

function showPreview(m, draft, p, job, res) {
  m.box.textContent = "";
  const file = (n) => `${API}/api/parts/file/${job}/${n}`;
  m.box.append(el("div", "dlg-title", res.reused ? "Kayıtlı model" : "Önizleme"));
  const stage = el("div", "pt-stage");
  const show = (kind, name) => {
    stage.textContent = "";
    let node;
    if (kind === "video") {
      node = el("video");
      node.src = file(name);
      node.autoplay = true;
      node.loop = true;
      node.muted = true;
      node.playsInline = true;
      node.controls = true;
    } else {
      node = el("img");
      node.src = file(name);
      node.alt = "";
    }
    stage.append(node);
  };
  const thumbs = el("div", "pt-thumbs");
  const items = [["video", res.turn, "Dönen"], ...res.views.map((v) => ["img", v.name, v.label])];
  items.forEach(([kind, name, label], i) => {
    const b = el("button", `pt-th${i ? "" : " on"}`, label);
    b.type = "button";
    b.onclick = () => {
      thumbs.querySelectorAll(".pt-th").forEach((x) => x.classList.toggle("on", x === b));
      show(kind, name);
    };
    thumbs.append(b);
  });
  show("video", res.turn);
  m.box.append(stage, thumbs);
  const info = el("div", "pt-info");
  info.append(el("div", "", `Birleşik boyut: ${dimText(res.size)}`));
  for (const x of res.parts) info.append(el("div", "pt-part", `${x.name}${x.count > 1 ? ` ×${x.count}` : ""} · ${x.color}${x.paint?.length ? ` (${x.paint.join(", ")})` : ""} · ${dimText(x.dims)}`));
  m.box.append(info);
  m.box.append(el("div", "dlg-text", "Doğruysa kaydet: model bu haliyle saklanır, AI videolarda yeniden kurmaz. Yanlışsa \"Düzelt\" de, boyamayı ya da yönü değiştirip tekrar önizle."));
  const acts = el("div", "dlg-actions");
  const no = el("button", "btn ghost", "Düzelt");
  no.type = "button";
  no.onclick = m.close;
  const yes = el("button", "btn primary", "Doğru, kaydet");
  yes.type = "button";
  yes.onclick = async () => {
    yes.disabled = no.disabled = true;
    yes.textContent = "Kaydediliyor…";
    try {
      await saveBrand(draft.id);
      await api("/api/parts/approve", { method: "POST", body: { job } });
      await load();
      drafts[draft.id] = clone(byId(draft.id));
      keepOpen(renderEditor);
      renderQuick();
      toast("Model kaydedildi");
      m.close();
    } catch (e) {
      yes.disabled = no.disabled = false;
      yes.textContent = "Doğru, kaydet";
      toast(e.message, 5000);
    }
  };
  acts.append(no, yes);
  m.box.append(acts);
}

function renderEditor() {
  const box = $("#stBrandEdit");
  box.textContent = "";
  const id = curId();
  const draft = draftOf(id);
  if (!draft) {
    box.append(el("div", "muted", "Marka bilgisi yüklenemedi."));
    return;
  }
  box.append(el("div", "sub-head", `${draft.name || "Marka"} bilgileri`));
  const rerender = () => { renderEditor(); renderQuick(); };
  for (const [k, label] of FIELDS) {
    box.append(input(label, draft[k], (v) => { draft[k] = v; }, { area: k === "audience" || k === "tone", rows: 2 }));
  }
  const cols = el("div", "field");
  cols.append(el("div", "field-head", "Marka renkleri (koyu · vurgu · açık)"));
  const cr = el("div", "br-colors");
  for (let i = 0; i < 3; i++) {
    const c = el("input");
    c.type = "color";
    const set = (draft.colors || [])[i];
    c.value = set || DEFAULT_COLORS[i];
    c.classList.toggle("unset", !set);
    c.title = set ? set : "Seçilmedi";
    c.oninput = () => {
      draft.colors = draft.colors || [];
      for (let k = 0; k < i; k++) draft.colors[k] = draft.colors[k] || DEFAULT_COLORS[k]; // sira korunur
      draft.colors[i] = c.value.toUpperCase();
      cr.querySelectorAll("input").forEach((x, k) => x.classList.toggle("unset", !draft.colors[k]));
    };
    cr.append(c);
  }
  cols.append(cr);
  if (!(draft.colors || []).length) cols.append(el("div", "panel-note", "Renk seçilmedi: AI renkleri görsellere göre kendisi seçer."));
  box.append(cols);
  const lg = el("div", "field");
  lg.append(el("div", "field-head", "Logo (videolarda otomatik kullanılır)"));
  lg.append(imageStrip(draft.logo ? [draft.logo] : [], () => { draft.logo = ""; renderEditor(); },
    () => { pickFor = { kind: "logo" }; openMedia("image", "brand"); }, draft.logo ? "Değiştir" : "+ Logo"));
  box.append(lg);
  box.append(el("div", "sub-head", "Ürünler"));
  if (draft.site_synced) {
    box.append(el("div", "panel-note", "engrare.com'daki satıştaki ürünlerle otomatik eşlenir (satıştan kaldırılanlar gizlenir)."));
  }
  for (const p of draft.products) box.append(productCard(draft, p, rerender));
  if (draft.site_synced) {
    const syncBtn = el("button", "btn ghost sm", "Siteden yenile");
    syncBtn.type = "button";
    syncBtn.onclick = async () => {
      syncBtn.disabled = true;
      try {
        await refreshBrand(true);
        toast("Ürünler engrare.com ile eşitlendi");
      } catch (e) {
        toast(e.message, 4000);
      } finally {
        syncBtn.disabled = false;
      }
    };
    box.append(syncBtn);
  } else {
    const add = el("button", "btn ghost sm", "+ Ürün ekle");
    add.type = "button";
    add.onclick = () => {
      draft.products.push({ id: `u${Date.now().toString(36)}`, name: "", price: "", url: "", desc: "", features: [], images: [] });
      rerender();
      box.querySelectorAll(".br-prod").forEach((d, i, a) => { d.open = i === a.length - 1; });
    };
    box.append(add);
  }
  const save = el("button", "btn primary", "Marka bilgilerini kaydet");
  save.type = "button";
  save.onclick = async () => {
    save.disabled = true;
    try {
      await saveBrand(id);
      toast("Marka bilgileri kaydedildi");
    } catch (e) {
      toast(e.message, 4000);
    } finally {
      save.disabled = false;
    }
  };
  box.append(save);
}

// Acik urun kartlari yeniden cizimde kapanmasin
function keepOpen(fn) {
  const open = [...$("#stBrandEdit").querySelectorAll(".br-prod")].map((x) => x.open);
  fn();
  $("#stBrandEdit").querySelectorAll(".br-prod").forEach((x, i) => { x.open = Boolean(open[i]); });
}

async function saveBrand(id) {
  const r = await api(`/api/brand/${id}`, { method: "PUT", body: draftOf(id) });
  const handleChanged = (byId(id)?.handle || "") !== r.brand.handle;
  brands = brands.map((b) => (b.id === id ? r.brand : b));
  drafts[id] = clone(r.brand);
  if (curId() === id && !r.brand.products.some((p) => p.id === ctx.opts.product)) { ctx.opts.product = ""; ctx.save(); }
  renderSwitch();
  keepOpen(renderEditor);
  renderQuick();
  refreshIg(handleChanged);
  return r.brand;
}

// Olustur sayfasi: Marka panelinde secili markanin urunu; istek kutusunun altinda hizli fikirler (istegi doldurur)
function renderQuick() {
  const box = $("#stBrandQuick");
  const ideasBox = $("#stIdeas");
  const b = getBrand();
  box.hidden = !b;
  if (ideasBox) ideasBox.hidden = !b || !(ideas[b?.id] || []).length;
  if (!b) return;
  const body = $("#stBrandQuickBody");
  body.textContent = "";
  body.hidden = false;
  const f1 = el("div", "field");
  f1.append(el("div", "field-head", "Ürün"));
  const row = el("div", "chips");
  for (const [id, name] of [["", "Seçme"], ...b.products.map((p) => [p.id, p.name + (p.model3d?.state === "approved" ? " · 3B" : "")])]) {
    const c = el("button", `chip${(ctx.opts.product || "") === id ? " on" : ""}`, name);
    c.type = "button";
    c.onclick = () => {
      ctx.opts.product = id;
      ctx.save();
      row.querySelectorAll(".chip").forEach((x) => x.classList.toggle("on", x === c));
    };
    row.append(c);
  }
  f1.append(row);
  body.append(f1);
  if (!ideasBox) return;
  const r2 = el("div", "st-ideas-row");
  r2.append(el("span", "st-ideas-lab", "Fikir"));
  for (const i of ideas[b.id] || []) {
    const c = el("button", "chip sm", i.label);
    c.type = "button";
    c.onclick = () => {
      const p = b.products.find((x) => x.id === ctx.opts.product);
      const dur = $("#stDurations .chip.on")?.textContent.replace(/\D/g, "") || "15";
      const text = i.text.replaceAll("{urun}", p ? p.name : "Ürünümüz").replaceAll("{sn}", dur);
      ctx.setPrompt(text);
    };
    r2.append(c);
  }
  ideasBox.replaceChildren(r2);
}

function renderSwitch() {
  for (const box of document.querySelectorAll(".st-brand-switch")) box.replaceChildren(switchRow());
}

function switchRow() {
  const row = el("div", "chips");
  for (const b of brands) {
    const c = el("button", `chip${b.id === curId() ? " on" : ""}`, b.name);
    c.type = "button";
    c.onclick = () => {
      if (ctx.opts.brand === b.id) return;
      ctx.opts.brand = b.id;
      if (!b.products.some((p) => p.id === ctx.opts.product)) ctx.opts.product = "";
      ctx.save();
      renderSwitch();
      renderIg();
      renderEditor();
      renderQuick();
      ctx.onChange?.();
    };
    row.append(c);
  }
  return row;
}

// ---- Instagram baglantisi ----
function fmtLeft(ts) {
  const h = Math.round((ts * 1000 - Date.now()) / 3600000);
  if (h < 1) return "1 saatten kısa";
  return h < 48 ? `${h} saat` : `${Math.round(h / 24)} gün`;
}

// 0 = suresiz, null = bilinmiyor / kendiliginden yenilenir
function expiryNote(exp) {
  if (!exp) return null;
  if (exp * 1000 < Date.now()) return { warn: true, text: "Token'ın süresi doldu; yükleme yapılamaz. Yeni token yapıştır." };
  if (exp * 1000 - Date.now() > 7 * 86400000) return { warn: false, text: `Token ${fmtLeft(exp)} geçerli.` };
  return {
    warn: true,
    text: `Token ${fmtLeft(exp)} sonra bitiyor. Meta'nın Access Token Debugger sayfasında "Extend Access Token" ile uzun süreli token alıp yapıştır; sayfa token'ları süresiz olur.`,
  };
}

export async function linkInstagram() {
  const tok = prompt(`Facebook / Instagram erişim token'ını yapıştır${ig?.connected ? " (boş bırakırsan bağlantı kesilir)" : ""}`);
  if (tok === null) return false;
  try {
    if (!tok.trim()) {
      if (ig?.connected) ig = await api("/api/instagram/disconnect", { method: "POST" });
    } else {
      ig = await api("/api/instagram/connect", { method: "POST", body: { token: tok } });
      toast(`Bağlandı: ${(ig.accounts || []).map((a) => `@${a.username}`).join(", ")}`, 3500);
    }
  } catch (e) {
    toast(e.message, 5000);
  }
  renderIg();
  renderExportBox();
  ctx?.onChange?.();
  return Boolean(ig?.connected);
}

function renderIg() {
  const box = $("#stIgBody");
  if (!box) return;
  box.textContent = "";
  const t = igTarget();
  const line = (cls, text) => box.append(el("div", `st-ig-line ${cls}`, text));
  if (!ig) {
    line("", "Yükleniyor…");
  } else if (!ig.connected) {
    line("warn", "Instagram bağlı değil. Facebook hesabının erişim token'ını bağla; iki marka da aynı bağlantıyı kullanır.");
  } else {
    if (ig.accounts?.length) line("", `Bağlı hesaplar: ${ig.accounts.map((a) => `@${a.username}`).join(", ")}`);
    if (!t.handle) {
      line("warn", `${t.name} için Instagram adı yazılı değil; aşağıdaki "Instagram" alanına yaz.`);
    } else if (t.linked) {
      line("ok", `✓ ${t.name} videoları @${t.username} hesabına yüklenir.`);
      const n = expiryNote(t.expires);
      if (n) line(n.warn ? "warn" : "", n.text);
    } else {
      line("warn", `${t.name} (${t.handle}) bu bağlantıda henüz yok. Hesabı Facebook sayfasına bağlayıp token'ı o sayfayı da seçerek yenile; bağlanınca otomatik kullanılır.`);
    }
    if (ig.error) line("warn", ig.error);
  }
  const acts = el("div", "st-ig-acts");
  const link = el("button", "btn sm", ig?.connected ? "Token'ı değiştir" : "Bağla");
  link.type = "button";
  link.onclick = linkInstagram;
  acts.append(link);
  if (ig?.connected) {
    const scan = el("button", "btn ghost sm", "Hesapları yeniden tara");
    scan.type = "button";
    scan.onclick = async () => {
      scan.disabled = true;
      await refreshIg(true);
      toast(igTarget().linked ? `${igTarget().name} hesabı hazır` : "Tarandı");
    };
    acts.append(scan);
  }
  box.append(acts);
  renderYt();
}

// ---- Disa aktar penceresindeki Instagram kutusu (ui.js) ----
export const exportTarget = () => igTarget(byId(exportPick) ? exportPick : curId());

export function renderExportBox() {
  const box = $("#igBrands");
  if (!box || !brands.length) return;
  const t = exportTarget();
  box.textContent = "";
  for (const b of brands) {
    const c = el("button", `chip${b.id === t.id ? " on" : ""}`, b.name);
    c.type = "button";
    c.onclick = () => { exportPick = b.id; renderExportBox(); };
    box.append(c);
  }
  $("#igWho").textContent = !t.connected ? "Instagram bağlı değil"
    : t.linked ? `@${t.username} hesabına gönderilir` : `${t.name} hesabı henüz bağlı değil`;
}

// Drive medya cekmecesinden gelen gorsel
window.addEventListener("brand:pick", (e) => {
  const d = e.detail;
  const draft = draftOf(curId());
  if (!d?.path || d.type !== "image" || !pickFor || !draft) return;
  if (pickFor.kind === "logo") {
    draft.logo = d.path;
    toast("Logo seçildi (kaydetmeyi unutma)");
  } else {
    const p = pickFor.product;
    p.images = p.images || [];
    if (p.images.includes(d.path)) return toast("Bu görsel zaten ekli");
    if (p.images.length >= 8) return toast("En fazla 8 görsel");
    p.images.push(d.path);
    toast(`Eklendi: ${d.name}`);
  }
  const open = [...$("#stBrandEdit").querySelectorAll(".br-prod")].map((x) => x.open);
  renderEditor();
  $("#stBrandEdit").querySelectorAll(".br-prod").forEach((x, i) => { x.open = Boolean(open[i]); });
});

// Ayarlar disaridan degisince (ör. "yeniden olustur") marka dugmeleri tazelenir
export function syncBrand() {
  if (!ctx || !brands.length) return;
  normalize();
  renderSwitch();
  renderIg();
  renderEditor();
  renderQuick();
}

export async function initBrand(c) {
  ctx = c;
  await load();
  normalize();
  renderSwitch();
  renderIg();
  renderEditor();
  renderQuick();
  refreshIg();
}
