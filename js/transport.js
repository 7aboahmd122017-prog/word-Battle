/* طبقة الاتصال للعب الجماعي.
   - Supabase Realtime (Broadcast + Presence) إذا تم ضبط js/config.js
   - وإلا BroadcastChannel للتجربة بين تبويبات نفس المتصفح
   الواجهة: connect(code, meta, {onMessage, onPresence}) → {send, track, leave, kind} */
window.WB = window.WB || {};

WB.Transport = (() => {
  // supabase-js 2.100.0 محفوظة داخل المشروع عشان ما نعتمد على سيرفر خارجي ممكن ينحجب
  const SUPABASE_CDN = "js/vendor/supabase.min.js";
  const configured = () => !!(WB.CONFIG && WB.CONFIG.SUPABASE_URL && WB.CONFIG.SUPABASE_ANON_KEY);

  let libPromise = null;
  function loadLib() {
    if (window.supabase && window.supabase.createClient) return Promise.resolve();
    if (!libPromise) {
      libPromise = new Promise((resolve, reject) => {
        const el = document.createElement("script");
        el.src = SUPABASE_CDN;
        el.onload = resolve;
        el.onerror = () => { libPromise = null; reject(new Error("تعذّر تحميل مكتبة Supabase، تأكد من الإنترنت.")); };
        document.head.appendChild(el);
      });
    }
    return libPromise;
  }

  let client = null;
  async function supabaseConnect(code, meta, h) {
    await loadLib();
    client = client || window.supabase.createClient(WB.CONFIG.SUPABASE_URL, WB.CONFIG.SUPABASE_ANON_KEY, {
      realtime: { params: { eventsPerSecond: 20 } }
    });
    const ch = client.channel(`wordbattle-${code}`, {
      config: { broadcast: { self: false }, presence: { key: meta.id } }
    });
    ch.on("broadcast", { event: "msg" }, ({ payload }) => h.onMessage(payload));
    ch.on("presence", { event: "sync" }, () => {
      const st = ch.presenceState();
      h.onPresence(Object.values(st).map((arr) => arr[arr.length - 1]).filter(Boolean));
    });
    let current = { ...meta };
    await new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => { if (!settled) { settled = true; reject(new Error("انتهت مهلة الاتصال بالخادم.")); } }, 10000);
      ch.subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await ch.track(current);
          if (!settled) { settled = true; clearTimeout(timer); resolve(); }
        } else if ((status === "CHANNEL_ERROR" || status === "TIMED_OUT") && !settled) {
          settled = true; clearTimeout(timer);
          reject(new Error("تعذّر الاتصال بالغرفة. تأكد من إعدادات Supabase."));
        }
      });
    });
    return {
      kind: "supabase",
      send: (payload) => ch.send({ type: "broadcast", event: "msg", payload }),
      track: (m) => { current = { ...m }; return ch.track(current); },
      leave: () => { try { ch.untrack(); client.removeChannel(ch); } catch { /* تجاهل */ } }
    };
  }

  /* ===== وضع التجربة: تبويبات نفس المتصفح ===== */
  function localConnect(code, meta, h) {
    const bc = new BroadcastChannel(`wordbattle-${code}`);
    let me = { ...meta };
    const peers = new Map(); // id → {meta, seen}
    let lastSig = "";

    function emit(force) {
      const list = [me, ...[...peers.values()].map((p) => p.meta)];
      const sig = JSON.stringify(list.map((m) => [m.id, m.name, m.team, m.host]).sort());
      if (force || sig !== lastSig) { lastSig = sig; h.onPresence(list); }
    }
    bc.onmessage = (e) => {
      const m = e.data || {};
      if (m.t === "hb") {
        const isNew = !peers.has(m.meta.id);
        peers.set(m.meta.id, { meta: m.meta, seen: Date.now() });
        if (isNew) bc.postMessage({ t: "hb", meta: me });
        emit();
      } else if (m.t === "bye") {
        peers.delete(m.id);
        emit();
      } else if (m.t === "msg") {
        h.onMessage(m.payload);
      }
    };
    const hb = setInterval(() => {
      bc.postMessage({ t: "hb", meta: me });
      const now = Date.now();
      for (const [id, p] of peers) if (now - p.seen > 5000) peers.delete(id);
      emit();
    }, 1500);
    const bye = () => bc.postMessage({ t: "bye", id: me.id });
    window.addEventListener("pagehide", bye);
    bc.postMessage({ t: "hb", meta: me });
    setTimeout(() => emit(true), 0);

    return Promise.resolve({
      kind: "local",
      send: (payload) => bc.postMessage({ t: "msg", payload }),
      track: (m) => { me = { ...m }; bc.postMessage({ t: "hb", meta: me }); emit(); },
      leave: () => { bye(); clearInterval(hb); window.removeEventListener("pagehide", bye); bc.close(); }
    });
  }

  function connect(code, meta, handlers) {
    return configured() ? supabaseConnect(code, meta, handlers) : localConnect(code, meta, handlers);
  }

  return { connect, configured };
})();
