// Onay penceresi: confirm() yerine. Promise<boolean> doner (Onayla = true, Vazgec / Esc / disina tik = false).
import { el } from "./api.js";

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
