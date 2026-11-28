/* اللعب على جهاز واحد */
window.WB = window.WB || {};

WB.Local = (() => {
  const { Engine, Store, Sound, Words } = WB;
  const UI = WB.UI;
  let s = null;      // حالة المباراة
  let word = null;   // الكلمة الحالية (محلياً فقط)

  // المباراة تنحفظ للتبويب المفتوح بس (sessionStorage):
  // تحديث الصفحة يرجّعك لنفس المباراة، وإغلاق المتصفح أو الخروج ينهيها نهائياً.
  // نمسح أي مباراة محفوظة دائمة من النسخ القديمة.
  Store.clearGame();
  const SESSION_KEY = "wb.localMatch";
  function save() {
    try {
      if (!s || s.phase === "win") sessionStorage.removeItem(SESSION_KEY);
      else sessionStorage.setItem(SESSION_KEY, JSON.stringify({ s, word }));
    } catch { /* تجاهل */ }
  }
  function loadSession() {
    try { return JSON.parse(sessionStorage.getItem(SESSION_KEY)); } catch { return null; }
  }

  function render() {
    if (!s) return;
    UI.updateBar(s);
    switch (s.phase) {
      case "turn":
        UI.Timer.stop();
        UI.renderTurn({ state: s, role: "local" });
        UI.show("turn");
        break;
      case "reveal":
        UI.renderReveal(word);
        UI.setSkip(true, !s.skipUsed);
        UI.show("reveal");
        break;
      case "play":
      case "steal":
        UI.renderPlay({ state: s, word });
        UI.setSkip(s.phase === "play", !s.skipUsed);
        UI.show("play");
        UI.Timer.start(s.endsAt, s.timerTotal, onTimeUp);
        if (s.phase === "steal" && s.timeUp) UI.stealOver();
        break;
      case "result":
        UI.Timer.stop();
        UI.renderResult({ state: s, canNext: true });
        UI.show("result");
        break;
      case "win":
        UI.Timer.stop();
        UI.renderWin({ state: s, canAct: true });
        UI.show("win");
        break;
    }
  }

  /** خلص وقت الشرح ← يبدأ وقت السرقة. خلص وقت السرقة ← الشارح يحدد */
  function onTimeUp() {
    if (!s) return;
    if (s.phase === "play") {
      startSteal();
    } else if (s.phase === "steal" && !s.timeUp) {
      s.timeUp = true;
      UI.stealOver();
      Sound.play("timeUp");
      Sound.vibrate([220, 90, 220]);
      save();
    }
  }

  function startSteal() {
    Engine.startSteal(s);
    Sound.play("timeUp");
    Sound.vibrate([220, 90, 220]);
    save();
    render();
  }

  function finish(to) {
    UI.Timer.stop();
    Engine.record(s, to, word);
    word = null;
    const got = to !== null;
    if (s.phase === "win") { Sound.play("win"); Sound.vibrate([100, 60, 100, 60, 300]); }
    else { Sound.play(got ? "got" : "miss"); Sound.vibrate(got ? 70 : [40, 40, 40]); }
    save();
    render();
  }

  /* ===== شاشة الإعداد ===== */
  let setup = null;

  function renderSetup(focus) {
    setup = setup || Store.getSetup();
    const root = UI.$("#setupTeams");
    root.innerHTML = setup.teams.map((t, ti) => `
      <div class="team-card ${UI.teamClass(ti)}">
        <div class="team-head">
          <span class="team-dot"></span>
          <input type="text" class="team-name-input" data-team-name="${ti}" value="${UI.esc(t.name)}" maxlength="18" aria-label="اسم الفريق" />
          <span class="team-count">${t.players.filter((p) => p.trim()).length} لاعبين</span>
        </div>
        <ul class="players">
          ${t.players.map((p, pi) => `
            <li class="player">
              <input type="text" data-player="${ti}:${pi}" value="${UI.esc(p)}" maxlength="16" placeholder="اسم اللاعب ${pi + 1}" aria-label="اسم اللاعب" enterkeyhint="next" />
              <button type="button" class="player-del" data-del-player="${ti}:${pi}" aria-label="حذف اللاعب">${UI.icon("trash")}</button>
            </li>`).join("")}
        </ul>
        <button type="button" class="btn btn-ghost btn-sm" data-add-player="${ti}">${UI.icon("plus")}إضافة لاعب</button>
      </div>`).join("");
    UI.renderSteppers(UI.$('[data-screen="setup"]'));
    UI.$("#setupError").textContent = "";
    updateBalance();
    if (focus) {
      const el = root.querySelector(`[data-player="${focus}"]`);
      if (el) el.focus();
    }
  }

  function updateCounts() {
    UI.$$("#setupTeams .team-card").forEach((card, ti) => {
      card.querySelector(".team-count").textContent = `${setup.teams[ti].players.filter((p) => p.trim()).length} لاعبين`;
    });
    updateBalance();
  }

  /** تنبيه إذا الفرق مو متوازنة: الدور يتبادل بين الفريقين، فالفريق الأصغر يشرح لاعبينه أكثر */
  function updateBalance() {
    const n = setup.teams.map((t) => t.players.filter((p) => p.trim()).length);
    const hint = UI.$("#balanceHint");
    const diff = Math.abs(n[0] - n[1]);
    hint.hidden = diff < 2;
    if (diff >= 2) {
      const small = n[0] < n[1] ? 0 : 1;
      hint.textContent = `فريق ${setup.teams[small].name || "الثاني"} أقل بـ ${diff} لاعبين، فلاعبينه بيشرحون أكثر. وزّعوهم بالتساوي عشان الكل ياخذ حقه.`;
    }
  }

  /** يخلط كل الأسماء ويقسمها على الفريقين بالتساوي */
  function shuffleTeams() {
    const names = WB.Engine.shuffle(setup.teams.flatMap((t) => t.players.map((p) => p.trim()).filter(Boolean)));
    if (names.length < 2) { UI.toast("اكتبوا أسماء اللاعبين أول"); return; }
    setup.teams[0].players = names.filter((_, i) => i % 2 === 0);
    setup.teams[1].players = names.filter((_, i) => i % 2 === 1);
    Store.saveSetup(setup);
    renderSetup();
    Sound.play("reveal");
    UI.toast("توزّعت الفرق بالتساوي");
  }

  function bindSetup() {
    const root = UI.$("#setupTeams");
    root.addEventListener("input", (e) => {
      const t = e.target;
      if (t.dataset.teamName !== undefined) setup.teams[+t.dataset.teamName].name = t.value;
      if (t.dataset.player) {
        const [ti, pi] = t.dataset.player.split(":").map(Number);
        setup.teams[ti].players[pi] = t.value;
        updateCounts();
      }
      Store.saveSetup(setup);
    });
    root.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" || !e.target.dataset.player) return;
      e.preventDefault();
      const [ti, pi] = e.target.dataset.player.split(":").map(Number);
      const list = setup.teams[ti].players;
      if (pi === list.length - 1) {
        if (!e.target.value.trim()) return;
        list.push("");
        Store.saveSetup(setup);
      }
      renderSetup(`${ti}:${pi + 1}`);
    });
    root.addEventListener("click", (e) => {
      const add = e.target.closest("[data-add-player]");
      const del = e.target.closest("[data-del-player]");
      if (add) {
        const ti = +add.dataset.addPlayer;
        setup.teams[ti].players.push("");
        Store.saveSetup(setup);
        renderSetup(`${ti}:${setup.teams[ti].players.length - 1}`);
        Sound.play("tap");
      } else if (del) {
        const [ti, pi] = del.dataset.delPlayer.split(":").map(Number);
        setup.teams[ti].players.splice(pi, 1);
        Store.saveSetup(setup);
        renderSetup();
      }
    });
  }

  function validate() {
    const teams = setup.teams.map((t) => ({ name: t.name.trim(), players: t.players.map((p) => p.trim()).filter(Boolean) }));
    if (teams.some((t) => !t.name)) return { error: "اكتب اسم لكل فريق." };
    if (teams[0].name === teams[1].name) return { error: "خلّ أسماء الفرق مختلفة." };
    if (teams.some((t) => t.players.length < 2)) return { error: "كل فريق يحتاج لاعبين اثنين على الأقل: واحد يشرح والباقي يخمّنون." };
    const all = teams.flatMap((t) => t.players);
    if (new Set(all).size !== all.length) return { error: "فيه اسم لاعب مكرر، فرّق بينهم عشان ما تلخبطون." };
    if (!Store.settings.categories.length) return { error: "اختر فئة وحدة على الأقل." };
    return { teams };
  }

  /* ===== أوامر اللعب ===== */
  const ctrl = {
    kind: "local",

    shuffleTeams,

    openSetup() {
      setup = Store.getSetup();
      renderSetup();
      UI.show("setup");
    },

    start() {
      const v = validate();
      if (v.error) { UI.$("#setupError").textContent = v.error; Sound.vibrate(80); return; }
      const teams = v.teams.map((t) => ({ name: t.name, players: t.players.map((name) => ({ id: Engine.uid(), name })) }));
      s = Engine.create(teams, Store.settings);
      word = null;
      Engine.beginTurn(s);
      Sound.play("start");
      save();
      render();
    },

    /** تخطي واحد للشارح في دوره: كلمة جديدة والوقت يكمل */
    skipWord() {
      if (!s || !word || s.skipUsed || !["reveal", "play"].includes(s.phase)) return;
      const next = Words.pick(s.settings.categories, [...s.usedWords, word.id]);
      Words.markUsed(next.id);
      word = next;
      s.skipUsed = true;
      Sound.play("reveal");
      Sound.vibrate(30);
      save();
      UI.setSkip(true, false);
      UI.swapWord(word, s.phase);
    },

    ready() {
      if (!s || s.phase !== "turn") return;
      word = Words.pick(s.settings.categories, s.usedWords);
      Words.markUsed(word.id);
      s.phase = "reveal";
      Sound.play("reveal");
      Sound.vibrate(40);
      save();
      render();
    },

    startTimer() {
      if (!s || s.phase !== "reveal") return;
      Engine.startTimer(s);
      Sound.play("start");
      Sound.vibrate(60);
      save();
      render();
    },

    /** أثناء الشرح: جابوها = نقطة لفريق الشارح. ما جابوها = يبدأ وقت السرقة */
    verdict(got) {
      if (!s || s.phase !== "play") return;
      if (got) finish(s.turnTeam);
      else startSteal();
    },

    /** بعد الوقت: الشارح يحدد النقطة لمين ("own" أو "other" أو "none") */
    award(who) {
      if (!s || !["play", "steal"].includes(s.phase)) return;
      finish(who === "own" ? s.turnTeam : who === "other" ? 1 - s.turnTeam : null);
    },

    next() {
      if (!s || s.phase !== "result") return;
      Engine.next(s);
      save();
      render();
    },

    rematch() {
      if (!s) return;
      Engine.rematch(s);
      word = null;
      Sound.play("start");
      save();
      render();
    },

    /** تغيير الإعدادات أثناء المباراة: الوقت يطبَّق من الجولة الجاية، الهدف فوراً */
    applySetting(key) {
      if (!s) return;
      if (key === "roundTime") s.settings.roundTime = Store.settings.roundTime;
      if (key === "target") { s.settings.target = Store.settings.target; Engine.checkWin(s); }
      if (key === "categories") s.settings.categories = Store.settings.categories.slice();
      save();
      UI.updateBar(s);
    },

    canEditSettings: () => true,
    inGame: () => !!s,
    render,

    /** بعد تحديث الصفحة: نرجع لنفس المباراة بصمت */
    hasSession: () => { const g = loadSession(); return !!(g && g.s && g.s.phase !== "win"); },
    restore() {
      const g = loadSession();
      if (!g || !g.s) return false;
      s = g.s; word = g.word;
      if (["reveal", "play", "steal"].includes(s.phase) && !word) s.phase = "turn";
      render();
      return true;
    },

    quit() {
      UI.Timer.stop();
      s = null; word = null;
      save();
    }
  };

  bindSetup();
  return ctrl;
})();
