// Marka kiti + urun katalogu (AI Studyo "Marka" sekmesi) ve hizli baslangic: urun + video fikri secimi.
// Veri sunucuda (data/brand.json); AI her videoda marka kitini, secili urunu, logoyu ve kapanis kartini kullanir.
import { $, api, el, icon, toast, url } from "./api.js";
import { openMedia } from "./ui.js";

let brand = null;
let ideas = [];
let ctx = null; // { opts, save, setPrompt, getPrompt }
let pickFor = null; // Drive'dan gelen gorselin ekleneceği yer: { kind: "logo" } | { kind: "product", product }

const FIELDS = [
  ["name", "Marka adı"], ["tagline", "Slogan"], ["site", "Web sitesi"], ["handle", "Instagram"],
  ["whatsapp", "WhatsApp"], ["cta", "Kapanış çağrısı (CTA)"], ["audience", "Hedef kitle"], ["tone", "Anlatım tonu"],
  ["hashtags", "Marka etiketleri"],
];

const clone = (o) => JSON.parse(JSON.stringify(o));
const THUMB_PX = 72;

export const getBrand = () => brand;

async function load() {
  try {
    const r = await api("/api/brand");
    brand = r.brand;
    ideas = r.ideas || [];
  } catch (e) {
    brand = null;
  }
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
  row.append(input("Fiyat", p.price, (v) => { p.price = v; }, { ph: "179,90 TL" }),
    input("Bağlantı", p.url, (v) => { p.url = v; }, { ph: "3d.engrare.com/urun/…" }));
  d.append(row);
  d.append(input("Kısa açıklama", p.desc, (v) => { p.desc = v; }, { area: true }));
  d.append(input("Öne çıkan özellikler (her satıra bir tane)", (p.features || []).join("\n"),
    (v) => { p.features = v.split("\n").map((x) => x.trim()).filter(Boolean); }, { area: true, rows: 4 }));
  const imgs = el("div", "field");
  imgs.append(el("div", "field-head", "Ürün görselleri"));
  imgs.append(imageStrip(p.images || [], (i) => { p.images.splice(i, 1); rerender(); },
    () => { pickFor = { kind: "product", product: p }; openMedia("image", "brand"); }, "+ Görsel"));
  d.append(imgs);
  const del = el("button", "btn danger sm", "Ürünü sil");
  del.type = "button";
  del.onclick = () => {
    draft.products = draft.products.filter((x) => x !== p);
    if (ctx.opts.product === p.id) { ctx.opts.product = ""; ctx.save(); }
    rerender();
  };
  d.append(del);
  return d;
}

let draft = null;

function renderEditor() {
  const box = $("#stBrandEdit");
  box.textContent = "";
  if (!draft) {
    box.append(el("div", "muted", "Marka bilgisi yüklenemedi."));
    return;
  }
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
    c.value = (draft.colors || [])[i] || ["#1E293B", "#3B82F6", "#F8F9FB"][i];
    c.oninput = () => {
      draft.colors = draft.colors || [];
      draft.colors[i] = c.value.toUpperCase();
    };
    cr.append(c);
  }
  cols.append(cr);
  box.append(cols);
  const lg = el("div", "field");
  lg.append(el("div", "field-head", "Logo (videolarda otomatik kullanılır)"));
  lg.append(imageStrip(draft.logo ? [draft.logo] : [], () => { draft.logo = ""; renderEditor(); },
    () => { pickFor = { kind: "logo" }; openMedia("image", "brand"); }, draft.logo ? "Değiştir" : "+ Logo"));
  box.append(lg);
  box.append(el("div", "sub-head", "Ürünler"));
  for (const p of draft.products) box.append(productCard(draft, p, rerender));
  const add = el("button", "btn ghost sm", "+ Ürün ekle");
  add.type = "button";
  add.onclick = () => {
    draft.products.push({ id: `u${Date.now().toString(36)}`, name: "", price: "", url: "", desc: "", features: [], images: [] });
    rerender();
    box.querySelectorAll(".br-prod").forEach((d, i, a) => { d.open = i === a.length - 1; });
  };
  box.append(add);
  const save = el("button", "btn primary", "Marka bilgilerini kaydet");
  save.type = "button";
  save.onclick = async () => {
    save.disabled = true;
    try {
      const r = await api("/api/brand", { method: "PUT", body: draft });
      brand = r.brand;
      draft = clone(brand);
      if (!brand.products.some((p) => p.id === ctx.opts.product)) { ctx.opts.product = ""; ctx.save(); }
      toast("Marka bilgileri kaydedildi");
      renderEditor();
      renderQuick();
    } catch (e) {
      toast(e.message, 4000);
    } finally {
      save.disabled = false;
    }
  };
  box.append(save);
}

// "İçerik" sekmesi: urun + video fikri secimi (fikir, istek kutusunu doldurur)
function renderQuick() {
  const box = $("#stBrandQuick");
  const on = Boolean(brand) && ctx.opts.brand !== false;
  box.hidden = !brand;
  if (!brand) return;
  const body = $("#stBrandQuickBody");
  body.textContent = "";
  body.hidden = !on;
  if (!on) return;
  const prods = brand.products.map((p) => [p.id, p.name]);
  const f1 = el("div", "field");
  f1.append(el("div", "field-head", "Ürün"));
  const row = el("div", "chips");
  for (const [id, name] of [["", "Seçme"], ...prods]) {
    const b = el("button", `chip${(ctx.opts.product || "") === id ? " on" : ""}`, name);
    b.type = "button";
    b.onclick = () => {
      ctx.opts.product = id;
      ctx.save();
      row.querySelectorAll(".chip").forEach((x) => x.classList.toggle("on", x === b));
    };
    row.append(b);
  }
  f1.append(row);
  body.append(f1);
  const f2 = el("div", "field");
  f2.append(el("div", "field-head", "Hızlı fikir (isteği doldurur)"));
  const r2 = el("div", "chips");
  for (const i of ideas) {
    const b = el("button", "chip", i.label);
    b.type = "button";
    b.onclick = () => {
      const p = brand.products.find((x) => x.id === ctx.opts.product);
      const dur = $("#stDurations .chip.on")?.textContent.replace(/\D/g, "") || "15";
      const text = i.text.replaceAll("{urun}", p ? p.name : "Ürünümüz").replaceAll("{sn}", dur);
      ctx.setPrompt(text);
    };
    r2.append(b);
  }
  f2.append(r2);
  body.append(f2);
}

function renderSwitch() {
  const box = $("#stBrandSwitch");
  box.textContent = "";
  const b = el("button", `chip${ctx.opts.brand !== false ? " on" : ""}`, "Marka kitini kullan");
  b.type = "button";
  b.onclick = () => {
    ctx.opts.brand = ctx.opts.brand === false;
    ctx.save();
    b.classList.toggle("on", ctx.opts.brand !== false);
    renderQuick();
  };
  box.append(b);
}

// Drive medya cekmecesinden gelen gorsel
window.addEventListener("brand:pick", (e) => {
  const d = e.detail;
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

// Instagram paylasim kutusu: AI ile aciklama + etiket
export function bindCaption(getProject) {
  const b = $("#btnCaptionAI");
  if (!b) return;
  b.innerHTML = `${icon("magic")}<span>AI ile açıklama yaz</span>`;
  b.onclick = async () => {
    const pid = getProject();
    b.disabled = true;
    b.querySelector("span").textContent = "Yazılıyor…";
    try {
      const r = await api("/api/brand/caption", { method: "POST", body: { project: pid || "", product: ctx?.opts?.product || "" } });
      const t = $("#igCaption");
      t.value = r.caption;
      t.rows = 8;
    } catch (e) {
      toast(e.message, 4000);
    } finally {
      b.disabled = false;
      b.querySelector("span").textContent = "AI ile açıklama yaz";
    }
  };
}

// Ayarlar disaridan degisince (ör. "yeniden olustur") marka dugmeleri tazelenir
export function syncBrand() {
  if (!ctx || !brand) return;
  renderSwitch();
  renderQuick();
}

export async function initBrand(c) {
  ctx = c;
  if (ctx.opts.brand === undefined) ctx.opts.brand = true;
  await load();
  draft = brand ? clone(brand) : null;
  renderSwitch();
  renderEditor();
  renderQuick();
}
