/* عرض الشاشات والعناصر المشتركة */
window.WB = window.WB || {};

WB.UI = (() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const icon = (id) => `<svg><use href="#i-${id}"/></svg>`;
  const teamClass = (i) => (i === 1 ? "b" : "a");
  const initial = (name) => (String(name || "؟").trim()[0] || "؟");
  const toArabicDigits = (n) => String(n).replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[d]);

  let current = "home";
  let previous = "home";
  const GAME_SCREENS = ["turn", "reveal", "play", "result", "win"];
  const WIDE_SCREENS = ["setup", "online"];

  function show(name) {
    if (name !== current) {
      if (current !== "settings") previous = current;
      current = name;
    }
    $$(".screen").forEach((s) => s.classList.toggle("active", s.dataset.screen === name));
    document.body.classList.toggle("wide", WIDE_SCREENS.includes(name));
    $("#gamebar").hidden = !GAME_SCREENS.includes(name);
    window.scrollTo({ top: 0 });
  }

  /* ===== شريط النقاط ===== */
  function updateBar(s) {
    if (!s) return;
    const bind = (k, v) => $$(`[data-bind="${k}"]`).forEach((el) => (el.textContent = v));
    bind("teamA", s.teams[0].name);
    bind("teamB", s.teams[1].name);
    bind("scoreA", s.teams[0].score);
    bind("scoreB", s.teams[1].score);
    bind("target", s.settings.target);
    document.body.dataset.team = s.turnTeam === 1 ? "b" : "a";
  }

  /* ===== عناصر الإعدادات المشتركة ===== */
  function renderSteppers(root = document, { disabled = false, values = null } = {}) {
    $$("[data-stepper]", root).forEach((el) => {
      const key = el.dataset.stepper;
      const lim = WB.Store.LIMITS[key];
      const val = values ? values[key] : WB.Store.settings[key];
      const text = key === "roundTime" ? `${val} ثانية` : `${val} نقاط`;
      el.innerHTML = `
        <button type="button" data-step="${key}" data-dir="-1" aria-label="إنقاص" ${disabled || val <= lim.min ? "disabled" : ""}>−</button>
        <output>${text}</output>
        <button type="button" data-step="${key}" data-dir="1" aria-label="زيادة" ${disabled || val >= lim.max ? "disabled" : ""}>+</button>`;
    });
  }

  function renderCategoryChips(root = document, { disabled = false, values = null } = {}) {
    const selected = values || WB.Store.settings.categories;
    $$("[data-categories]", root).forEach((el) => {
      el.innerHTML = WB.CATEGORIES.map(
        (c) => `<button type="button" class="chip" data-cat="${c.id}" aria-pressed="${selected.includes(c.id)}" ${disabled ? "disabled" : ""}>${esc(c.name)}</button>`
      ).join("");
    });
  }

  function syncSettingsScreen() {
    const s = WB.Store.settings;
    $("#setSound").checked = s.sound;
    $("#setVolume").value = s.volume;
    $("#setTicks").checked = s.ticks;
    $("#setVibrate").checked = s.vibrate;
  }

  /* ===== شاشة الدور ===== */
  function renderTurn(v) {
    const s = v.state;
    const ti = s.turnTeam;
    const team = s.teams[ti];
    const ex = WB.Engine.explainer(s);
    const name = ex ? ex.name : "؟";
    const badge = `<span class="team-badge ${teamClass(ti)}">دور فريق ${esc(team.name)}</span>`;
    let html;
    if (v.role === "local" || v.role === "me") {
      html = `
        ${badge}
        <div class="handoff-avatar ${teamClass(ti)}">${esc(initial(name))}</div>
        <div>
          <p class="muted">${v.role === "me" ? "دورك تشرح!" : "استلم الجهاز يا"}</p>
          <p class="who">${esc(name)}</p>
        </div>
        <p class="hint">${v.role === "me" ? "الكلمة بتطلع على جوالك بس. اشرحها لفريقك بدون ما تقولها." : "خذ الجهاز وتأكد إن ما أحد يشوف الشاشة غيرك."}</p>
        <button class="btn btn-primary btn-xl" data-action="ready">${icon("eye")}أنا جاهز، ورّني الكلمة</button>`;
    } else {
      const reading = s.phase === "reveal";
      html = `
        ${badge}
        <div class="handoff-avatar ${teamClass(ti)}">${esc(initial(name))}</div>
        <div>
          <p class="who">${esc(name)}</p>
          <p class="muted">${reading ? "يقرأ الكلمة الحين" : "يستلم الدور"} <span class="dots"><i></i><i></i><i></i></span></p>
        </div>
        <p class="hint">${v.myTeam === ti ? "جهّز نفسك، أنت من فريقه وبتخمّن!" : v.myTeam === 1 - ti ? "فريقك يتفرج هالدور. ركّز وانتبه لا يقول الكلمة!" : ""}</p>
        ${v.offlineNote ? `<p class="banner">${esc(v.offlineNote)}</p>` : ""}
        ${v.canSkip ? `<button class="btn btn-ghost" data-action="skip-turn">${icon("shuffle")}تخطي واختيار شارح ثاني</button>` : ""}`;
    }
    $("#turnView").innerHTML = html;
  }

  /* ===== عرض الكلمة ===== */
  let flipTimer = null;
  /** يعبّي الكرت. animate: يبدأ مقلوب ثم ينقلب ليكشف الكلمة */
  function fillWord(card, catEl, wordEl, word, animate) {
    catEl.textContent = word.catName;
    wordEl.textContent = word.text;
    wordEl.classList.toggle("long", word.text.length > 12);
    card.classList.remove("fly", "shake");
    clearTimeout(flipTimer);
    if (animate) {
      card.classList.remove("shown");
      flipTimer = setTimeout(() => card.classList.add("shown"), 380);
    } else {
      const inner = card.querySelector(".flip-inner");
      inner.style.transition = "none";
      card.classList.add("shown");
      void inner.offsetWidth;
      inner.style.transition = "";
    }
  }
  function renderReveal(word) {
    fillWord($("#revealCard"), $("#revealCat"), $("#revealWord"), word, true);
  }

  // الضغط على الكرت يخفي الكلمة أو يظهرها
  function toggleFlip(card) {
    card.classList.toggle("shown");
    WB.Sound.play("tap");
  }
  document.addEventListener("click", (e) => {
    const card = e.target.closest(".flip");
    if (card) toggleFlip(card);
  });
  document.addEventListener("keydown", (e) => {
    if ((e.key === "Enter" || e.key === " ") && e.target.classList && e.target.classList.contains("flip")) {
      e.preventDefault();
      toggleFlip(e.target);
    }
  });

  /** شرارات صغيرة من نقطة معيّنة */
  function sparks(x, y, colors = ["#3fe0b5", "#8f7bff", "#4c9dff"]) {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    for (let i = 0; i < 18; i++) {
      const s = document.createElement("i");
      s.className = "spark";
      const a = (Math.PI * 2 * i) / 18;
      const d = 60 + Math.random() * 70;
      s.style.left = x + "px";
      s.style.top = y + "px";
      s.style.background = colors[i % colors.length];
      s.style.setProperty("--dx", Math.cos(a) * d + "px");
      s.style.setProperty("--dy", Math.sin(a) * d + "px");
      document.body.appendChild(s);
      setTimeout(() => s.remove(), 800);
    }
  }

  /* ===== المؤقت ===== */
  const Timer = (() => {
    const C = 2 * Math.PI * 54;
    let raf = null, endsAt = 0, total = 1, onEnd = null, lastSec = null, ended = false;

    function paint() {
      const ms = Math.max(0, endsAt - Date.now());
      const sec = Math.ceil(ms / 1000);
      const ring = $("#timerRing");
      ring.style.strokeDasharray = C;
      ring.style.strokeDashoffset = C * (1 - ms / total);
      const el = $("#timer");
      el.classList.toggle("warn", sec <= 15 && sec > 5);
      el.classList.toggle("danger", sec <= 5 && ms > 0);
      el.classList.toggle("done", ms <= 0);
      document.body.classList.toggle("hurry", sec <= 5 && ms > 0);
      if (sec !== lastSec) {
        $("#timerNum").textContent = toArabicDigits(sec);
        if (lastSec !== null && sec > 0 && sec <= 10 && WB.Store.settings.ticks) {
          WB.Sound.play(sec <= 3 ? "tickHard" : "tick");
          if (sec <= 3) WB.Sound.vibrate(30);
        }
        lastSec = sec;
      }
      if (ms <= 0) {
        if (!ended) { ended = true; stop(); onEnd && onEnd(); }
        return;
      }
      raf = requestAnimationFrame(paint);
    }

    function start(end, totalMs, cb) {
      stop();
      endsAt = end; total = totalMs; onEnd = cb; lastSec = null; ended = false;
      paint();
    }
    function stop() { if (raf) cancelAnimationFrame(raf); raf = null; document.body.classList.remove("hurry"); }
    // عند الرجوع للتبويب نحدّث فوراً (requestAnimationFrame يتوقف بالخلفية)
    document.addEventListener("visibilitychange", () => { if (!document.hidden && raf) { cancelAnimationFrame(raf); paint(); } });
    // احتياط إذا كان التبويب بالخلفية: فحص كل ثانية
    setInterval(() => { if (raf && document.hidden) paint(); }, 1000);
    return { start, stop };
  })();

  function renderPlay(v) {
    const s = v.state;
    $("#playExplainer").hidden = !v.word;
    $("#playWatcher").hidden = !!v.word;
    $("#timeupMsg").hidden = !s.timeUp;
    if (v.word) {
      fillWord($("#playCard"), $("#playCat"), $("#playWord"), v.word, false);
      $$(".verdict .btn").forEach((b) => (b.disabled = false));
    } else {
      const ex = WB.Engine.explainer(s);
      $("#watchTitle").textContent = `${ex ? ex.name : "الشارح"} يشرح الحين`;
      $("#watchSub").textContent = v.myTeam === s.turnTeam ? "خمّن بصوت عالي! الكلمة عند الشارح بس." : `دور فريق ${s.teams[s.turnTeam].name}. انتظر دورك.`;
    }
  }

  /* ===== لوحة النقاط ===== */
  function scoreboardHTML(s, bumpTeam = null) {
    const lead = s.teams[0].score === s.teams[1].score ? -1 : s.teams[0].score > s.teams[1].score ? 0 : 1;
    return `<div class="scoreboard">${s.teams.map((t, i) => `
      <div class="score-card ${teamClass(i)} ${lead === i ? "lead" : ""}">
        <span class="sc-name">${esc(t.name)}</span>
        <span class="sc-num ${bumpTeam === i ? "bump" : ""}">${t.score}</span>
        <span class="bar"><i style="width:${Math.min(100, (t.score / s.settings.target) * 100)}%"></i></span>
      </div>`).join("")}</div>`;
  }

  function renderResult(v) {
    const s = v.state;
    const r = s.lastResult || {};
    const nextTeam = s.teams[1 - s.turnTeam];
    $("#resultView").innerHTML = `
      <div class="verdict-badge">
        <div class="verdict-icon ${r.got ? "got" : "miss"}">${icon(r.got ? "check" : "x")}</div>
        <h2>${r.got ? `جابوها! +١ لـ ${esc(s.teams[r.team].name)}` : "ما جابوها هالمرة"}</h2>
        ${r.word ? `<p class="was">الكلمة كانت: <b>${esc(r.word)}</b></p>` : ""}
      </div>
      ${scoreboardHTML(s, r.got ? r.team : null)}
      <p class="next-up">الدور الجاي لفريق <b>${esc(nextTeam.name)}</b></p>
      ${v.canNext
        ? `<button class="btn btn-primary btn-xl" data-action="next">الدور الجاي</button>`
        : `<p class="muted center">${esc(v.waitText || "")} <span class="dots"><i></i><i></i><i></i></span></p>`}`;
    // العدّاد يرتفع قدام اللاعبين
    if (r.got) {
      const num = $(`#resultView .score-card.${teamClass(r.team)} .sc-num`);
      if (num) {
        num.textContent = s.teams[r.team].score - 1;
        num.classList.remove("bump");
        setTimeout(() => { num.textContent = s.teams[r.team].score; num.classList.add("bump"); }, 450);
      }
    }
  }

  function renderWin(v) {
    const s = v.state;
    const w = s.winner;
    $("#winView").innerHTML = `
      <div class="trophy ${teamClass(w)}">${icon("crown")}</div>
      <p class="muted">انتهت المباراة</p>
      <h1>فريق ${esc(s.teams[w].name)} فاز!</h1>
      ${scoreboardHTML(s)}
      <div class="actions">
        ${v.canAct ? `<button class="btn btn-primary btn-xl" data-action="rematch">مباراة ثانية بنفس الفرق</button>` : `<p class="muted center">المضيف يقدر يبدأ مباراة ثانية</p>`}
        <button class="btn btn-ghost" data-action="quit-now">${icon("home")}القائمة الرئيسية</button>
      </div>`;
    confetti(w);
  }

  function confetti(team) {
    const wrap = document.createElement("div");
    wrap.className = "confetti";
    const colors = team === 1 ? ["#3fe0b5", "#4c9dff", "#eef0f7"] : ["#8f7bff", "#4c9dff", "#eef0f7"];
    for (let i = 0; i < 60; i++) {
      const p = document.createElement("i");
      p.style.left = Math.random() * 100 + "%";
      p.style.background = colors[i % colors.length];
      p.style.animationDuration = 2.2 + Math.random() * 2 + "s";
      p.style.animationDelay = Math.random() * 0.8 + "s";
      p.style.transform = `rotate(${Math.random() * 360}deg)`;
      wrap.appendChild(p);
    }
    document.body.appendChild(wrap);
    setTimeout(() => wrap.remove(), 5000);
  }

  /* ===== نافذة التأكيد والتنبيه ===== */
  function confirm(title, text, okText = "تمام") {
    return new Promise((resolve) => {
      const m = $("#modal");
      $("#modalTitle").textContent = title;
      $("#modalText").textContent = text;
      $("#modalOk").textContent = okText;
      m.hidden = false;
      const done = (v) => { m.hidden = true; $("#modalOk").onclick = $("#modalCancel").onclick = null; resolve(v); };
      $("#modalOk").onclick = () => done(true);
      $("#modalCancel").onclick = () => done(false);
      $("#modalOk").focus();
    });
  }

  let toastTimer = null;
  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 2200);
  }

  return {
    $, $$, esc, icon, teamClass,
    show, current: () => current, previous: () => previous,
    updateBar, renderSteppers, renderCategoryChips, syncSettingsScreen,
    renderTurn, renderReveal, renderPlay, renderResult, renderWin, scoreboardHTML,
    Timer, confirm, toast, sparks
  };
})();
