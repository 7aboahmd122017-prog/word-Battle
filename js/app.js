/* ربط الأزرار والتنقل بين الشاشات */
window.WB = window.WB || {};

WB.App = (() => {
  const { UI, Store, Sound, Local, Online, Words } = WB;
  let ctrl = null; // Local أو Online حسب طريقة اللعب

  function refreshHome() {
    UI.$("#resumeBtn").hidden = !Local.canResume();
  }

  function goHome() {
    UI.Timer.stop();
    delete document.body.dataset.team;
    refreshHome();
    UI.show("home");
  }

  function openSettings() {
    UI.syncSettingsScreen();
    const editable = !ctrl || !ctrl.inGame() || ctrl.canEditSettings();
    const scr = UI.$('[data-screen="settings"]');
    const values = !editable && ctrl.settingsValues ? ctrl.settingsValues() : null;
    UI.renderSteppers(scr, { disabled: !editable, values });
    UI.$("#settingsOnlineNote").hidden = editable;
    UI.show("settings");
  }

  function closeSettings() {
    const prev = UI.previous();
    if (ctrl && ctrl.inGame() && ["turn", "reveal", "play", "result", "win", "online"].includes(prev)) {
      ctrl.render();
    } else if (prev === "setup") {
      Local.openSetup();
    } else {
      goHome();
    }
  }

  /** حركة الكرت قبل تسجيل النتيجة: يطير لفوق إذا جابوها، ويهتز إذا لا */
  let judging = false;
  function verdict(got) {
    if (!ctrl || judging) return;
    judging = true;
    UI.$$(".verdict .btn").forEach((b) => (b.disabled = true));
    const card = UI.$("#playCard");
    card.classList.add("shown", got ? "fly" : "shake");
    if (got) {
      const r = card.getBoundingClientRect();
      UI.sparks(r.left + r.width / 2, r.top + r.height / 2);
    }
    setTimeout(() => {
      judging = false;
      ctrl && ctrl.verdict(got);
    }, 480);
  }

  /* ===== سحب كرت الكلمة: لفوق جابوها، لتحت ما جابوها ===== */
  function bindSwipe() {
    const card = UI.$("#playCard");
    const LIMIT = 90;
    let start = null;

    card.addEventListener("pointerdown", (e) => {
      if (judging || UI.$("#playExplainer").hidden) return;
      start = { x: e.clientX, y: e.clientY, moved: false };
      card.setPointerCapture(e.pointerId);
      card.classList.add("dragging");
    });
    card.addEventListener("pointermove", (e) => {
      if (!start) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (Math.abs(dx) + Math.abs(dy) > 8) start.moved = true;
      card.style.transform = `translate(${dx * 0.25}px, ${dy}px) rotate(${dx / 25}deg)`;
      card.classList.toggle("swipe-up", dy < -LIMIT / 2);
      card.classList.toggle("swipe-down", dy > LIMIT / 2);
    });
    const end = (e) => {
      if (!start) return;
      const dy = e.clientY - start.y;
      const moved = start.moved;
      start = null;
      card.classList.remove("dragging");
      if (moved) card.dataset.dragged = "1"; // لا نقلب الكرت بعد السحب
      if (dy < -LIMIT) { verdict(true); return; }
      if (dy > LIMIT) { verdict(false); return; }
      card.classList.remove("swipe-up", "swipe-down");
      card.style.transition = "transform 0.35s cubic-bezier(0.3, 1.5, 0.5, 1)";
      card.style.transform = "";
      setTimeout(() => { card.style.transition = ""; }, 380);
    };
    card.addEventListener("pointerup", end);
    card.addEventListener("pointercancel", end);
  }

  /* ===== دستة الكروت في شاشة البداية ===== */
  function bindDeck() {
    const deck = UI.$("#deck");
    const tints = ["var(--mint)", "var(--violet)", "var(--blue)"];
    let i = 0;
    deck.addEventListener("click", () => {
      if (deck.classList.contains("dealing")) return;
      deck.classList.add("dealing");
      Sound.play("reveal");
      Sound.vibrate(20);
      setTimeout(() => {
        i = (i + 1) % tints.length;
        const top = deck.querySelector(".dc-1");
        top.querySelector("i").style.color = tints[i];
        top.style.transition = "none";
        deck.classList.remove("dealing");
        void top.offsetWidth;
        top.style.transition = "";
      }, 420);
    });
    // ميلان الدستة والرسومات مع حركة المؤشر (للكمبيوتر)
    if (window.matchMedia("(hover: hover) and (prefers-reduced-motion: no-preference)").matches) {
      const doodles = UI.$(".doodles");
      window.addEventListener("pointermove", (e) => {
        const nx = e.clientX / window.innerWidth - 0.5;
        const ny = e.clientY / window.innerHeight - 0.5;
        doodles.style.setProperty("--px", `${nx * -18}px`);
        doodles.style.setProperty("--py", `${ny * -18}px`);
        if (UI.current() === "home") {
          deck.style.setProperty("--rx", `${nx * 18}deg`);
          deck.style.setProperty("--ry", `${ny * -14}deg`);
        }
      });
    }
  }

  async function quit(skipConfirm) {
    if (!skipConfirm && ctrl && ctrl.inGame()) {
      const online = ctrl.kind === "online";
      const ok = await UI.confirm(
        "تطلع من المباراة؟",
        online ? "بتطلع من الغرفة. إذا كنت المضيف، الغرفة بتنقفل على الكل." : "تقدر تكمّلها بعدين من شاشة البداية.",
        "اطلع"
      );
      if (!ok) return;
    }
    if (ctrl && ctrl.kind === "online") ctrl.quit();
    if (ctrl && ctrl.kind === "local" && UI.current() === "win") ctrl.quit();
    if (ctrl && ctrl.kind === "local") UI.Timer.stop();
    ctrl = null;
    goHome();
  }

  const actions = {
    "go-home": goHome,
    "go-mode": () => UI.show("mode"),
    "go-setup": () => { ctrl = Local; Local.openSetup(); },
    "go-online": () => { ctrl = Online; Online.openEntry(); },
    "resume-local": () => { ctrl = Local; Local.resume(); },
    "start-local": () => { ctrl = Local; Local.start(); },
    "open-settings": openSettings,
    "close-settings": closeSettings,
    "quit": () => quit(false),
    "quit-now": () => quit(true),
    "ready": () => ctrl && ctrl.ready(),
    "start-timer": () => ctrl && ctrl.startTimer(),
    "got": () => verdict(true),
    "miss": () => verdict(false),
    "next": () => ctrl && ctrl.next(),
    "rematch": () => ctrl && ctrl.rematch(),
    "skip-turn": async () => {
      if (!ctrl || ctrl.kind !== "online") return;
      if (await UI.confirm("تخطي الدور؟", "بيتم اختيار شارح ثاني من نفس الفريق بدون نقطة.", "تخطي")) ctrl.skip();
    },
    "online-create": () => Online.create(),
    "online-join": () => Online.join(),
    "online-start": () => Online.start(),
    "online-back": async () => {
      if (Online.connected()) {
        const ok = await UI.confirm("تطلع من الغرفة؟", "إذا كنت المضيف، الغرفة بتنقفل على الكل.", "اطلع");
        if (!ok) return;
        Online.quit();
      }
      ctrl = null;
      UI.show("mode");
    },
    "copy-code": async () => {
      const code = Online.code();
      if (!code) return;
      try { await navigator.clipboard.writeText(code); UI.toast("تم نسخ الرمز"); }
      catch { UI.toast(`الرمز: ${code}`); }
    },
    "reset-words": async () => {
      if (await UI.confirm("إعادة بنك الكلمات؟", "الكلمات اللي طلعت قبل بترجع ممكن تطلع من جديد.", "إعادة")) {
        Words.reset();
        UI.toast("رجعنا الكلمات من البداية");
      }
    }
  };

  function bind() {
    document.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-action]");
      if (btn && !btn.disabled) {
        const fn = actions[btn.dataset.action];
        if (fn) {
          if (!["got", "miss", "ready", "start-timer"].includes(btn.dataset.action)) Sound.play("tap");
          fn();
        }
        return;
      }
      // أزرار الزيادة والنقص
      const step = e.target.closest("[data-step]");
      if (step && !step.disabled) {
        const key = step.dataset.step;
        const lim = Store.LIMITS[key];
        Store.set(key, Store.settings[key] + lim.step * Number(step.dataset.dir));
        Sound.play("tap");
        return;
      }
      // الفئات
      const chip = e.target.closest("[data-cat]");
      if (chip && !chip.disabled) {
        const id = chip.dataset.cat;
        let cats = Store.settings.categories.slice();
        if (cats.includes(id)) {
          if (cats.length === 1) { UI.toast("لازم تبقى فئة وحدة على الأقل"); return; }
          cats = cats.filter((c) => c !== id);
        } else cats.push(id);
        Store.set("categories", cats);
        Sound.play("tap");
        return;
      }
      // اختيار الفريق في الغرفة
      const jt = e.target.closest("[data-join-team]");
      if (jt) Online.joinTeam(Number(jt.dataset.joinTeam));
    });

    // أسماء الفرق في الغرفة (المضيف)
    UI.$("#lobbyTeams").addEventListener("input", (e) => {
      const i = e.target.dataset.lobbyTeamName;
      if (i !== undefined) Online.setTeamName(Number(i), e.target.value);
    });

    // مفاتيح الإعدادات
    UI.$$("[data-setting]").forEach((el) => {
      el.addEventListener(el.type === "range" ? "input" : "change", () => {
        const key = el.dataset.setting;
        Store.set(key, el.type === "checkbox" ? el.checked : Number(el.value));
        if (key === "volume" || key === "sound") Sound.play("tap");
        if (key === "vibrate" && el.checked) Sound.vibrate(40);
      });
    });

    // إدخال رمز الغرفة
    const codeInput = UI.$("#onCode");
    codeInput.addEventListener("input", () => {
      codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5);
    });
    codeInput.addEventListener("keydown", (e) => { if (e.key === "Enter") Online.join(); });

    // تحديث العناصر عند تغيّر أي إعداد
    Store.onChange((key) => {
      if (key === "roundTime" || key === "target") UI.$$("[data-stepper]").forEach((el) => UI.renderSteppers(el.parentElement));
      if (key === "categories") UI.$$("[data-categories]").forEach((el) => {
        const disabled = el.querySelector(".chip:disabled") !== null;
        if (!disabled) UI.renderCategoryChips(el.parentElement);
      });
      if (ctrl && ctrl.inGame()) ctrl.applySetting(key);
    });

    UI.$("#modal").addEventListener("click", (e) => { if (e.target.id === "modal") UI.$("#modalCancel").click(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !UI.$("#modal").hidden) UI.$("#modalCancel").click(); });
  }

  async function init() {
    bind();
    bindDeck();
    bindSwipe();
    refreshHome();
    UI.show("home");
    // الرجوع تلقائياً للغرفة بعد تحديث الصفحة
    if (Online.canRejoin()) {
      ctrl = Online;
      await Online.rejoin();
    }
  }

  document.addEventListener("DOMContentLoaded", init);
  return { refreshHome };
})();
