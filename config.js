// API adresi: edit.engrare.com GitHub Pages uzerinden acilir, API istekleri edit-api.engrare.com'a gider.
// Yerel gelistirmede backend arayuzu de servis ettigi icin ayni koken kullanilir.
window.API = location.hostname === "edit.engrare.com" ? "https://edit-api.engrare.com" : location.origin;
