// Onay penceresi: confirm() yerine. Promise<boolean> doner (Onayla = true, Vazgec / Esc / disina tik = false).
import { API, el, api, toast } from "./api.js";

export function confirmBox({ title, text = "", ok = "Onayla", cancel = "Vazgeç", danger = false, hold = 0, content = null }) {
  return new Promise((resolve) => {
    const prev = document.activeElement;
    const scrim = el("div", "dlg-scrim");
    const box = el("div", "dlg");
    box.setAttribute("role", "alertdialog");
    box.setAttribute("aria-modal", "true");
    const yes = el("button", `btn ${danger ? "danger" : "primary"}`, ok);
    const no = el("button", "btn ghost", cancel);
    box.append(el("div", "dlg-title", title));
    if (text) box.append(el("div", "dlg-text", text));
    if (content) box.append(content);
    box.append(el("div", "dlg-actions", ""));
    box.lastChild.append(no, yes);
    scrim.append(box);

    const done = (v) => {
      document.removeEventListener("keydown", onKey, true);
      scrim.classList.add("out");
      setTimeout(() => scrim.remove(), 140);
      prev?.focus?.();
      resolve(v);
    };
    const onKey = (e) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); done(false); }
      else if (e.key === "Tab") {
        e.preventDefault();
        (document.activeElement === yes ? no : yes).focus();
      }
    };
    if (hold) {
      // Onay tusu `hold` ms basili tutulunca gecerli olur
      yes.classList.add("hold");
      yes.style.setProperty("--hold", `${hold}ms`);
      yes.replaceChildren(el("span", "hold-fill"), el("span", "hold-label", `${ok} (${hold / 1000} sn basılı tut)`));
      let timer = 0;
      const start = (e) => {
        if (timer || e.repeat) return;
        yes.classList.add("holding");
        timer = setTimeout(() => done(true), hold);
      };
      const stop = () => {
        clearTimeout(timer);
        timer = 0;
        yes.classList.remove("holding");
      };
      yes.addEventListener("pointerdown", (e) => { e.preventDefault(); yes.focus(); start(e); });
      for (const t of ["pointerup", "pointerleave", "pointercancel"]) yes.addEventListener(t, stop);
      yes.addEventListener("contextmenu", (e) => e.preventDefault());
      yes.addEventListener("keydown", (e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); start(e); } });
      yes.addEventListener("keyup", stop);
      yes.addEventListener("blur", stop);
    } else yes.onclick = () => done(true);
    no.onclick = () => done(false);
    // Disina tik: basma da birakma da karartili alanda olmali (pencerenin icinden surukleyip disarida birakmak kapatmaz)
    let downOnScrim = false;
    scrim.addEventListener("pointerdown", (e) => { downOnScrim = e.target === scrim; });
    scrim.addEventListener("click", (e) => { if (downOnScrim && e.target === scrim) done(false); downOnScrim = false; });
    document.addEventListener("keydown", onKey, true);
    document.body.append(scrim);
    (danger ? no : yes).focus(); // yikici islemde varsayilan odak "Vazgec"
  });
}

// Indirme kalitesi secimi: Promise<"high" | "balanced" | "small" | null>
const DL_OPTS = [
  ["high", "En yüksek kalite", "Videonun aslı, hiçbir kayıp yok. Dosya en büyük olan."],
  ["balanced", "Dengeli", "Gözle fark edilmez kalite, belirgin şekilde daha küçük dosya."],
  ["small", "En düşük dosya boyutu", "720p ve yüksek sıkıştırma. Mesajla göndermek için ideal."],
];

export function pickQuality() {
  return new Promise((resolve) => {
    const prev = document.activeElement;
    const scrim = el("div", "dlg-scrim");
    const box = el("div", "dlg");
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "true");
    box.append(el("div", "dlg-title", "İndirme kalitesi"));
    const list = el("div", "dlg-opts");
    const cancel = el("button", "btn ghost", "Vazgeç");
    const done = (v) => {
      document.removeEventListener("keydown", onKey, true);
      scrim.classList.add("out");
      setTimeout(() => scrim.remove(), 140);
      prev?.focus?.();
      resolve(v);
    };
    const onKey = (e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); done(null); } };
    DL_OPTS.forEach(([id, name, desc], i) => {
      const b = el("button", "dlg-opt");
      b.type = "button";
      b.append(el("b", null, name), el("small", null, desc));
      b.onclick = () => done(id);
      list.append(b);
      if (!i) setTimeout(() => b.focus(), 0);
    });
    box.append(list, el("div", "dlg-actions"));
    box.lastChild.append(cancel);
    cancel.onclick = () => done(null);
    scrim.append(box);
    let downOnScrim = false;
    scrim.addEventListener("pointerdown", (e) => { downOnScrim = e.target === scrim; });
    scrim.addEventListener("click", (e) => { if (downOnScrim && e.target === scrim) done(null); downOnScrim = false; });
    document.addEventListener("keydown", onKey, true);
    document.body.append(scrim);
  });
}

const fmtMB = (n) => `${(n / 1048576).toFixed(n < 10485760 ? 1 : 0)} MB`;

// Kalite sorar, secime gore dosyayi hazirlar ve indirir.
let dlBusy = false;
export async function downloadRender(file) {
  if (dlBusy) { toast("Başka bir video hazırlanıyor, lütfen bekle."); return; }
  const q = await pickQuality();
  if (!q) return;
  dlBusy = true;
  try {
    if (q !== "high") toast("Video hazırlanıyor, birkaç saniye sürebilir…", 60000);
    const r = await api(`/api/renders/${encodeURIComponent(file)}/variant?q=${q}`);
    const a = document.createElement("a");
    a.href = `${API}${r.url}`;
    a.download = r.file;
    document.body.append(a);
    a.click();
    a.remove();
    toast(`İndiriliyor · ${fmtMB(r.size)}`, 3000);
  } catch (e) {
    toast(e.message || "Video hazırlanamadı", 4000);
  } finally {
    dlBusy = false;
  }
}
