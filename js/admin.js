/* لوحة البلاغات: تسجيل دخول الأدمن، وعرض البلاغات مجمّعة حسب الكلمة.
   الحماية الحقيقية في قاعدة البيانات (Row Level Security): غير الأدمن ما يوصله شي حتى لو فتح الصفحة. */
(() => {
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const ar = (n) => String(n).replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[d]);
  const reasonLabel = (id) => (WB.Reports.REASONS.find((r) => r.id === id) || { label: id }).label;

  const db = window.supabase.createClient(WB.CONFIG.SUPABASE_URL, WB.CONFIG.SUPABASE_ANON_KEY);
  let rows = [];      // كل البلاغات
  let tab = "new";    // new | done

  function ago(iso) {
    const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return "قبل شوي";
    if (s < 3600) return `قبل ${ar(Math.floor(s / 60))} دقيقة`;
    if (s < 86400) return `قبل ${ar(Math.floor(s / 3600))} ساعة`;
    return `قبل ${ar(Math.floor(s / 86400))} يوم`;
  }

  /* ===== تسجيل الدخول ===== */
  function showLogin() {
    $("#login").hidden = false;
    $("#dash").hidden = true;
    $("#logoutBtn").hidden = true;
    $("#whoami").textContent = "";
    $("#loginEmail").focus();
  }
  function showDash(user) {
    $("#login").hidden = true;
    $("#dash").hidden = false;
    $("#logoutBtn").hidden = false;
    $("#whoami").textContent = user.email;
    load();
  }

  $("#loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("#loginBtn");
    btn.disabled = true;
    $("#loginError").textContent = "";
    const { data, error } = await db.auth.signInWithPassword({
      email: $("#loginEmail").value.trim(),
      password: $("#loginPass").value
    });
    btn.disabled = false;
    $("#loginPass").value = "";
    if (error) { $("#loginError").textContent = "الإيميل أو كلمة السر غلط."; return; }
    showDash(data.user);
  });

  $("#logoutBtn").addEventListener("click", async () => {
    await db.auth.signOut();
    rows = [];
    $("#cards").innerHTML = "";
    showLogin();
  });

  /* ===== البيانات ===== */
  async function load() {
    $("#dashError").textContent = "";
    $("#cards").innerHTML = `<p class="empty">جاري التحميل…</p>`;
    const { data, error } = await db
      .from("word_reports")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(2000);
    if (error) {
      $("#cards").innerHTML = "";
      $("#dashError").textContent = "ما قدرنا نجيب البلاغات. تأكد إن جدول البلاغات مضاف في Supabase.";
      return;
    }
    rows = data || [];
    render();
  }

  /** يجمع البلاغات حسب الكلمة، والأكثر بلاغات فوق */
  function groups(list) {
    const map = new Map();
    for (const r of list) {
      if (!map.has(r.word_id)) map.set(r.word_id, { wordId: r.word_id, word: r.word, category: r.category, level: r.level, items: [] });
      map.get(r.word_id).items.push(r);
    }
    return [...map.values()].sort((a, b) => b.items.length - a.items.length || new Date(b.items[0].created_at) - new Date(a.items[0].created_at));
  }

  function render() {
    const open = rows.filter((r) => !r.resolved);
    const done = rows.filter((r) => r.resolved);
    $("#statNew").textContent = ar(open.length);
    $("#statWords").textContent = ar(new Set(open.map((r) => r.word_id)).size);
    $("#statDone").textContent = ar(done.length);

    const q = $("#search").value.trim();
    const list = (tab === "new" ? open : done).filter((r) => !q || (r.word || "").includes(q));
    const g = groups(list);
    if (!g.length) {
      $("#cards").innerHTML = `<p class="empty">${q ? "ما فيه نتائج لهالبحث." : tab === "new" ? "ما فيه بلاغات جديدة. كل شي تمام 👌" : "ما فيه بلاغات محلولة للحين."}</p>`;
      return;
    }
    $("#cards").innerHTML = g.map((w) => `
      <article class="word-report">
        <div class="wr-head">
          <div class="wr-title">
            <span class="wr-word">${esc(w.word)}</span>
            <div class="wr-tags">
              ${w.category ? `<span class="wr-tag">${esc(w.category)}</span>` : ""}
              ${w.level ? `<span class="wr-tag">${esc(w.level)}</span>` : ""}
              <span class="wr-tag wr-count">${ar(w.items.length)} ${w.items.length === 1 ? "بلاغ" : "بلاغات"}</span>
            </div>
          </div>
          ${tab === "new"
            ? `<button class="btn btn-soft btn-sm" data-resolve="${esc(w.wordId)}">تم ✓</button>`
            : `<button class="btn btn-ghost btn-sm" data-reopen="${esc(w.wordId)}">رجّعها</button>`}
        </div>
        <ul class="wr-list">
          ${w.items.map((r) => `
            <li class="wr-item">
              <span class="wr-reason">${esc(reasonLabel(r.reason))}</span>
              ${r.details ? `<p class="wr-details">${esc(r.details)}</p>` : ""}
              <div class="wr-meta">
                <span>المبلّغ: <b>${esc(r.reporter || "بدون اسم")}</b></span>
                ${r.room_code ? `<span>الغرفة: <b>${esc(r.room_code)}</b></span>` : `<span><b>جهاز واحد</b></span>`}
                <span>الجهاز: <b dir="ltr">${esc((r.device_id || "").slice(0, 6))}</b></span>
                <span>${esc(ago(r.created_at))}</span>
              </div>
            </li>`).join("")}
        </ul>
      </article>`).join("");
  }

  /* ===== تم / رجّعها ===== */
  $("#cards").addEventListener("click", async (e) => {
    const res = e.target.closest("[data-resolve]");
    const reo = e.target.closest("[data-reopen]");
    const btn = res || reo;
    if (!btn) return;
    btn.disabled = true;
    const wordId = btn.dataset.resolve || btn.dataset.reopen;
    const { error } = await db.from("word_reports").update({ resolved: !!res }).eq("word_id", wordId).eq("resolved", !res);
    if (error) { btn.disabled = false; $("#dashError").textContent = "ما قدرنا نحدّث البلاغ، جرّب مرة ثانية."; return; }
    rows.forEach((r) => { if (r.word_id === wordId) r.resolved = !!res; });
    render();
  });

  $$(".tab").forEach((t) => t.addEventListener("click", () => {
    tab = t.dataset.tab;
    $$(".tab").forEach((x) => x.setAttribute("aria-selected", String(x === t)));
    render();
  }));
  $("#search").addEventListener("input", render);
  $("#refreshBtn").addEventListener("click", load);

  /* ===== البداية: إذا مسجّل دخول من قبل ندخله على طول ===== */
  db.auth.getSession().then(({ data }) => {
    if (data.session) showDash(data.session.user);
    else showLogin();
  });
})();
