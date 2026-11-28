/* بلاغات الكلمات: يرسل البلاغ لجدول word_reports في Supabase،
   ويخفي الكلمة من هالجهاز على طول (حتى لو ما فيه نت). */
window.WB = window.WB || {};

WB.Reports = (() => {
  const HIDDEN_KEY = "wb.hiddenWords"; // الكلمات اللي بلّغ عنها هالجهاز
  const DEVICE_KEY = "wb.deviceId";    // رقم عشوائي للجهاز (ما يكشف هوية)
  const LIB = "js/vendor/supabase.min.js";

  const REASONS = [
    { id: "spelling", label: "غلط إملائي" },
    { id: "unclear", label: "غير واضحة أو ما أحد يعرفها" },
    { id: "duplicate", label: "مكررة" },
    { id: "inappropriate", label: "غير مناسبة" },
    { id: "other", label: "غير ذلك" }
  ];

  const cut = (v, n) => (v == null || v === "" ? null : String(v).slice(0, n));

  function read(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  }
  function write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* تجاهل */ }
  }

  function hiddenIds() { return read(HIDDEN_KEY, []); }
  function isHidden(id) { return hiddenIds().includes(id); }
  function hide(id) {
    const list = hiddenIds();
    if (!list.includes(id)) { list.push(id); write(HIDDEN_KEY, list); }
  }

  function deviceId() {
    let id = read(DEVICE_KEY, null);
    if (!id) {
      id = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
      write(DEVICE_KEY, id);
    }
    return id;
  }

  /* الإرسال الفعلي لـ Supabase (نحمّل المكتبة وقت الحاجة بس) */
  let client = null;
  async function supabaseInsert(row) {
    if (!window.supabase) {
      await new Promise((ok, fail) => {
        const s = document.createElement("script");
        s.src = LIB; s.onload = ok; s.onerror = fail;
        document.head.appendChild(s);
      });
    }
    client = client || window.supabase.createClient(WB.CONFIG.SUPABASE_URL, WB.CONFIG.SUPABASE_ANON_KEY);
    const { error } = await client.from("word_reports").insert(row);
    if (error) throw error;
  }
  let insert = supabaseInsert;

  /** يرسل بلاغ. يرجّع {sent, duplicate}.
      word: {id, text, catName, levelName}، reason: واحد من REASONS */
  async function send({ word, reason, details, reporter, roomCode }) {
    if (isHidden(word.id)) return { sent: false, duplicate: true };
    hide(word.id); // نخفيها أول، عشان ما ترجع حتى لو فشل الإرسال
    const row = {
      word_id: cut(word.id, 80),
      word: cut(word.text, 80),
      category: cut(word.catName, 40),
      level: cut(word.levelName, 20),
      reason: REASONS.some((r) => r.id === reason) ? reason : "other",
      details: cut(details && details.trim(), 200),
      reporter: cut(reporter, 40),
      room_code: cut(roomCode, 8),
      device_id: deviceId()
    };
    try {
      await insert(row);
      return { sent: true, duplicate: false };
    } catch {
      return { sent: false, duplicate: false };
    }
  }

  return {
    REASONS, send, isHidden, hiddenIds, deviceId,
    _setInsert: (fn) => { insert = fn; } // للاختبارات بس
  };
})();
