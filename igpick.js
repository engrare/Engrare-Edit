// Instagram yukleme menusu (onay penceresinin icerigi): zaman (Hemen | Zamanla) + video ayarlari (aciklama, etiketler).
// "AI doldursun" isaretliyken aciklama ve etiketleri AI yazar: kendiliginden baslamaz; "Simdi hazirla" ile hemen
// yazdirilabilir, basilmazsa onaylayinca (video hazirsa) ya da yuklenirken (video daha olusmadiysa) yazilir.
// AI Studyo ve editorun Disa aktar penceresi ortak kullanir.
import { api, el, toast, url } from "./api.js";

// son secimler (sunucuda, AI Studyo ayarlariyla birlikte saklanir; studio.js doldurur ve kaydeder)
export const prefs = { when: "now", time: "", ai: true };
let saver = () => {};
export const setSaver = (fn) => { saver = fn; };

// Zamanlama her zaman Turkiye saatiyle: kullanici yurt disindayken de girilen ve gosterilen saat TR saatidir
// (tarayicinin saat dilimi degil; ornegin Yunanistan'da secilen 19:15, TR'de 20:15 oluyordu).
const TZ = "Europe/Istanbul";
const trFmt = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit",
  day: "2-digit", hour: "2-digit", minute: "2-digit" });
const trParts = (ms) => Object.fromEntries(trFmt.formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
// epoch ms -> "YYYY-MM-DDTHH:MM" (TR saati, datetime-local girisi icin)
const trInput = (ms) => { const p = trParts(ms); return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`; };
// "YYYY-MM-DDTHH:MM" (TR saati) -> epoch ms
const trParse = (s) => {
  const m = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)/.exec(s || "");
  if (!m) return NaN;
  const guess = Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5]);
  const p = trParts(guess);
  return guess - (Date.UTC(+p.year, p.month - 1, +p.day, +p.hour, +p.minute) - guess);
};
const away = new Date().getTimezoneOffset() !== -180; // cihazin saati TR saatinden farkli (TR: hep UTC+3)
export const fmtAt = (at) => new Date(at * 1000).toLocaleString("tr-TR", { timeZone: TZ, day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })
  + (away ? " (TR saati)" : "");

// Kapak (thumbnail) bolumu: hazir kapagi gosterir, "Simdi AI oluştursun" ile arka planda urettirir.
// Hazir kapak yuklemede aynen kullanilir (sunucu AI'yi ikinci kez cagirmaz); yoksa yuklenirken AI uretir.
// Uretim sunucuda surer; pencere kapansa da izleme devam eder ve bitince (ya da hata verince) ekranda bildirilir.
const coverWatch = new Map(); // render adi -> en son izleyen kutu (ayni render icin tek izleyici, bildirim cift cikmasin)

function coverBox(cfg, getCaption) {
  const me = {};
  coverWatch.set(cfg.render, me);
  const node = el("div", "ig-opts ig-cover");
  const img = el("img", "ig-cover-img");
  img.alt = "Kapak";
  img.hidden = true;
  const msg = el("div", "ig-when-hint");
  const btn = el("button", "btn ghost sm", "Şimdi AI oluştursun");
  btn.type = "button";
  node.append(el("div", "ig-opts-head", "Kapak (thumbnail)"), img, msg, btn);
  let st = { exists: false, running: false, error: "" };
  let armed = 0; // "Yeniden oluştur" ilk basista onay ister (hazir kapagin yanlislikla ezilmesin)
  const draw = () => {
    img.hidden = !st.exists;
    if (st.exists) {
      const u = `${url.cover(cfg.render)}?t=${st.created}`;
      if (img.dataset.src !== u) { img.dataset.src = u; img.src = u; }
    }
    btn.disabled = st.running;
    btn.textContent = st.running ? "AI tasarlıyor…" : armed > Date.now() ? "Emin misin? Yeniden oluştur" : st.exists ? "Yeniden oluştur (AI)" : "Şimdi AI oluştursun";
    msg.textContent = st.running ? "AI kapağı tasarlıyor, bu 1-3 dakika sürebilir. Pencereyi kapatsan da sunucuda devam eder."
      : st.error ? `Hata: ${st.error}`
        : st.exists ? "Kapak hazır, yüklemede bu kullanılır (AI tekrar oluşturmaz)."
          : "Kapak hazırlanmadı: yüklenirken AI kendisi oluşturur. İstersen şimdi oluşturup bakabilirsin.";
  };
  let timer = 0;
  let wasRunning = false;
  const poll = async () => {
    clearTimeout(timer);
    if (coverWatch.get(cfg.render) !== me) return; // ayni render icin daha yeni bir pencere izliyor
    try { st = await api(`/api/covers/state?render=${encodeURIComponent(cfg.render)}`, { cache: "no-store" }); } catch { /* sonraki turda tekrar */ }
    draw();
    if (st.running) {
      wasRunning = true;
      timer = setTimeout(poll, 3000);
    } else if (wasRunning) {
      wasRunning = false;
      if (!node.isConnected) { // pencere kapanmis: sonucu ekranda goster
        if (st.error) toast(`Kapak oluşturulamadı: ${st.error}`, 15000);
        else if (st.exists) toast("Kapak hazır", 4000);
      }
    }
  };
  btn.onclick = async () => {
    if (st.exists && armed < Date.now()) {
      armed = Date.now() + 4000;
      draw();
      setTimeout(draw, 4100);
      return;
    }
    armed = 0;
    btn.disabled = true;
    try {
      st = await api("/api/covers/make", { method: "POST", body: {
        render: cfg.render, job: cfg.job || "", brand: cfg.brand || "", project: cfg.project || "", caption: getCaption(), force: true,
      } });
    } catch (e) {
      toast(e.message, 4000);
    }
    draw();
    if (st.running) { wasRunning = true; timer = setTimeout(poll, 3000); }
    else if (st.error) toast(`Kapak oluşturulamadı: ${st.error}`, 15000);
  };
  draw();
  poll();
  return { node, running: () => st.running };
}

// fill: async () => ({ text, hashtags }) | null (video hazir degilse null: AI yuklenirken yazar)
// text/tags: baslangic degerleri (editorde zaten yazilmis aciklama varsa AI ustune yazmaz)
// edit: zamanlanmis yuklemeyi duzenleme (at: mevcut zaman, ai: AI yazacak mi); Hemen/Zamanla secimi yok, secimler hatirlanmaz
// cover: { render, job?, brand?, project? } verilirse pencerede kapak bolumu cikar (video hazirsa)
export function whenPicker({ fill = null, text = "", tags = "", mode = null, edit = false, at = 0, ai = null, cover = null } = {}) {
  let when = edit ? "later" : mode || prefs.when;
  const node = el("div", "ig-when");
  const seg = el("div", "ig-when-seg");
  const nowB = el("button", "", "Hemen yükle");
  const laterB = el("button", "", "Zamanla");
  for (const b of [nowB, laterB]) b.type = "button";
  seg.append(nowB, laterB);
  seg.hidden = edit;
  const input = el("input", "ig-when-input");
  input.type = "datetime-local";
  let d = Date.now() + 3600000;
  if (/^\d\d:\d\d$/.test(prefs.time)) { // son secilen saat (TR): bugun gecmediyse bugun, yoksa yarin
    d = trParse(`${trInput(Date.now()).slice(0, 10)}T${prefs.time}`);
    if (d < Date.now() + 5 * 60000) d += 86400000; // TR'de yaz saati yok: gun hep 24 saat
  }
  input.value = trInput(edit && at ? at * 1000 : d);
  input.min = trInput(Date.now());
  const tz = away ? "Saat Türkiye saatine göredir (bulunduğun yerin saati değil). " : "";
  const hint = el("div", "ig-when-hint", tz + (edit ? "Yükleme bu zamana ertelenir ya da öne çekilir. Açıklamayı boş bırakıp AI seçeneğini işaretlersen yüklenirken AI yazar." : "Video hazır olunca bekler, bu zamanda yüklenir. Hazırlık geç biterse hemen yüklenir. İptal etmek için yükleme durumundan “Zamanlamayı iptal et” de."));

  // video ayarlari
  const opts = el("div", "ig-opts");
  const head = el("div", "ig-ai");
  const lab = el("label", "ig-ai-lab");
  const tick = el("input");
  tick.type = "checkbox";
  tick.checked = ai ?? prefs.ai;
  const prepB = el("button", "btn ghost sm ig-prep", "Şimdi hazırla");
  prepB.type = "button";
  lab.append(tick, el("span", "", "AI açıklama ve etiketleri hazırlasın"));
  head.append(lab, prepB);
  const cap = el("textarea", "ig-cap");
  cap.rows = 5;
  cap.maxLength = 2000;
  cap.placeholder = "Açıklama";
  cap.value = text;
  const tg = el("input", "ig-tags");
  tg.type = "text";
  tg.maxLength = 400;
  tg.placeholder = "#etiket #etiket";
  tg.value = tags;
  const note = el("div", "ig-when-hint");
  opts.append(el("div", "ig-opts-head", "Video ayarları"), head, cap, tg, note);

  let busy = false;
  let seq = 0;
  const syncFields = () => {
    const lazy = tick.checked && !fill && !cap.value && !tg.value; // video daha yok: AI yuklenirken yazar
    prepB.hidden = !(tick.checked && fill);
    prepB.disabled = busy;
    cap.disabled = tg.disabled = busy || lazy;
    cap.placeholder = busy ? "AI yazıyor…" : lazy ? "Video hazır olunca AI yazacak" : "Açıklama";
    tg.placeholder = busy ? "" : lazy ? "" : "#etiket #etiket";
    note.textContent = tick.checked
      ? (fill ? "“Şimdi hazırla”ya basarsan AI hemen yazar, düzenleyebilirsin. Basmazsan gönder’e basınca hazırlar."
        : "Video hazır olunca AI açıklamayı ve etiketleri yazar.")
      : "Açıklama ve etiketleri kendin yaz.";
  };
  const aiFill = async () => {
    if (!fill) return syncFields();
    const my = ++seq;
    busy = true;
    syncFields();
    try {
      const r = await fill();
      if (my === seq && r) { cap.value = r.text || ""; tg.value = r.hashtags || ""; }
    } catch (e) {
      if (my === seq) toast(`AI yazamadı: ${e.message}`, 4000);
    } finally {
      if (my === seq) { busy = false; syncFields(); }
    }
  };
  tick.onchange = () => {
    if (!tick.checked) { seq++; busy = false; }
    syncFields();
  };
  prepB.onclick = aiFill;
  syncFields();

  const sync = () => {
    nowB.classList.toggle("on", when === "now");
    laterB.classList.toggle("on", when === "later");
    input.hidden = hint.hidden = when !== "later";
  };
  nowB.onclick = () => { when = "now"; sync(); };
  laterB.onclick = () => { when = "later"; sync(); };
  node.append(seg, input, hint, opts);
  const cv = cover?.render ? coverBox(cover, () => [cap.value, tg.value].filter(Boolean).join("\n\n")) : null;
  if (cv) node.append(cv.node);
  sync();
  return {
    node,
    fill, // gonderirken AI aciklamasi hazirlanmamissa cagirana: await when.fill()
    // secimi kaydeder -> { at (epoch sn, 0 = hemen), caption, hashtags, ai }; gecersizse null
    commit() {
      if (busy) {
        toast("AI yazıyor, bitmesini bekle", 3000);
        return null;
      }
      let at = 0;
      if (when === "later") {
        const t = trParse(input.value);
        if (!(t > Date.now() + 60000)) {
          toast("Yükleme zamanı en az 1 dakika sonrası olmalı", 3500);
          return null;
        }
        at = Math.floor(t / 1000);
        if (!edit) prefs.time = input.value.slice(11, 16);
      }
      if (cv?.running()) toast("Kapak arka planda hazırlanmaya devam ediyor, bitince haber verilecek", 4000);
      const caption = cap.value.trim();
      const hashtags = tg.value.trim();
      if (!tick.checked && !caption && !hashtags) {
        toast("Açıklama yaz ya da AI doldursun seçeneğini işaretle", 3500);
        return null;
      }
      if (!edit) {
        prefs.when = when;
        prefs.ai = tick.checked;
        saver();
      }
      return { at, caption, hashtags, ai: tick.checked };
    },
  };
}
