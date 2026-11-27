/* مشاركة اللعبة: رمز QR ورابط مباشر للغرفة */
window.WB = window.WB || {};

WB.Share = (() => {
  const LIB = "https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js";
  let libPromise = null;

  function loadLib() {
    if (window.qrcode) return Promise.resolve();
    if (!libPromise) {
      libPromise = new Promise((resolve, reject) => {
        const el = document.createElement("script");
        el.src = LIB;
        el.onload = resolve;
        el.onerror = () => { libPromise = null; reject(new Error("qr")); };
        document.head.appendChild(el);
      });
    }
    return libPromise;
  }

  /** رابط الموقع بدون أي إضافات */
  function siteUrl() {
    return location.origin + location.pathname;
  }

  /** رابط يفتح اللعبة على شاشة الدخول والرمز معبّى */
  function roomUrl(code) {
    return `${siteUrl()}?room=${encodeURIComponent(code)}`;
  }

  /** يرسم QR داخل العنصر. نرسمه بأنفسنا كـ SVG عشان يكون حاد على كل الشاشات */
  async function renderQR(el, text, label) {
    el.innerHTML = `<span class="qr-loading">جاري تجهيز الرمز…</span>`;
    try {
      await loadLib();
    } catch {
      el.innerHTML = `<span class="qr-loading">ما قدرنا نجهز الرمز، استخدم الرابط بدله.</span>`;
      return;
    }
    const qr = window.qrcode(0, "M");
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    const m = 2; // هامش أبيض حول الرمز يحتاجه الماسح
    let d = "";
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + m} ${r + m}h1v1h-1z`;
    }
    const size = n + m * 2;
    el.innerHTML = `<svg viewBox="0 0 ${size} ${size}" role="img" aria-label="${label}" shape-rendering="crispEdges">
      <rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="#0f1020"/></svg>`;
  }

  /** مشاركة عبر قائمة الجوال، أو نسخ الرابط إذا ما كانت متوفرة */
  async function share(url, text) {
    if (navigator.share) {
      try { await navigator.share({ title: "وِش الكلمة؟", text, url }); return "shared"; }
      catch (e) { if (e && e.name === "AbortError") return "cancelled"; }
    }
    try { await navigator.clipboard.writeText(url); return "copied"; }
    catch { return "failed"; }
  }

  /** يقرأ رمز الغرفة من الرابط (?room=XXXXX) ويشيله من العنوان */
  function takeRoomFromUrl() {
    const params = new URLSearchParams(location.search);
    const code = (params.get("room") || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5);
    if (params.has("room")) {
      params.delete("room");
      const q = params.toString();
      history.replaceState(null, "", location.pathname + (q ? `?${q}` : "") + location.hash);
    }
    return code.length === 5 ? code : "";
  }

  return { siteUrl, roomUrl, renderQR, share, takeRoomFromUrl };
})();
