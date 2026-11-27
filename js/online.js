/* اللعب من جوالات متعددة.
   المضيف يملك حالة المباراة ويبثها للجميع. الكلمة تُختار على جهاز الشارح فقط
   ولا تُرسل لأحد إلا بعد انتهاء الدور (لعرضها في شاشة النتيجة). */
window.WB = window.WB || {};

WB.Online = (() => {
  const { Engine, Store, Sound, Words, Transport } = WB;
  const UI = WB.UI;
  const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const ROOM_KEY = "wb.room";
  const WORD_KEY = "wb.myWord";

  const sGet = (k) => { try { return JSON.parse(sessionStorage.getItem(k)); } catch { return null; } };
  const sSet = (k, v) => { try { v == null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, JSON.stringify(v)); } catch { /* تجاهل */ } };

  // معرّف لكل تبويب/جهاز (يبقى بعد التحديث)
  const myId = sGet("wb.clientId") || Engine.uid() + Engine.uid();
  sSet("wb.clientId", myId);

  let me = null;          // {id, name, team, host}
  let code = null;
  let tx = null;          // الاتصال
  let roster = [];        // المتصلون حالياً
  let st = null;          // آخر حالة
  let localEndsAt = null;
  let joinTimer = null, helloTimer = null, healTimer = null, nameTimer = null;
  let lastKey = "";
  let lastFx = "";
  let timeUpShown = false;

  const isHost = () => !!(me && me.host);
  const connected = () => !!tx;
  const hostKey = () => `wb.host.${code}`;
  const saveRoom = () => sSet(ROOM_KEY, { code, name: me.name, team: me.team, host: me.host });

  function genCode() {
    let c = "";
    for (let i = 0; i < 5; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    return c;
  }

  /* ================= المضيف ================= */
  function newLobby() {
    const setup = Store.getSetup();
    return {
      phase: "lobby",
      hostId: me.id,
      rev: 0,
      teamNames: setup.teams.map((t) => t.name || ""),
      settings: { roundTime: Store.settings.roundTime, target: Store.settings.target, categories: Store.settings.categories.slice() }
    };
  }

  function broadcast() {
    if (!tx || !st) return;
    tx.send({ type: "state", state: st, remaining: st.endsAt ? st.endsAt - Date.now() : null });
  }

  function commit() {
    st.rev = (st.rev || 0) + 1;
    Store.write(hostKey(), st);
    broadcast();
    applyState(st, null, true);
  }

  function teamSizes(useGame) {
    if (useGame && st && st.teams) return st.teams.map((t) => t.players.filter((p) => !p.off).length);
    return [0, 1].map((i) => roster.filter((r) => r.team === i).length);
  }
  const smaller = (sizes) => (sizes[1] < sizes[0] ? 1 : 0);

  function hostAction(from, a) {
    const s = st;
    if (!s || !s.teams) return;
    const isEx = s.explainerId === from;
    switch (a.act) {
      case "ready":
        if (s.phase === "turn" && isEx) { s.phase = "reveal"; commit(); }
        break;
      case "start":
        if (s.phase === "reveal" && isEx) { Engine.startTimer(s); commit(); }
        break;
      case "verdict":
        if (s.phase === "play" && isEx) {
          const w = a.word ? { id: String(a.word.id || ""), text: String(a.word.text || "").slice(0, 80), catName: String(a.word.catName || "").slice(0, 30) } : null;
          Engine.record(s, !!a.got, w);
          commit();
        }
        break;
      case "next":
        if (s.phase === "result" && (from === me.id || (s.lastResult && s.lastResult.explainerId === from))) { Engine.next(s); commit(); }
        break;
      case "skip":
        if (from === me.id && ["turn", "reveal", "play"].includes(s.phase)) { Engine.beginTurn(s); commit(); }
        break;
      case "rematch":
        if (from === me.id && s.phase === "win") { Engine.rematch(s); s.gameId = Engine.uid(); commit(); }
        break;
    }
  }

  /** مزامنة قائمة المتصلين مع لاعبي المباراة */
  function reconcile() {
    if (!st || !st.teams) return false;
    let changed = false;
    const inGame = new Map();
    st.teams.forEach((t) => t.players.forEach((p) => inGame.set(p.id, p)));
    const online = new Map(roster.map((r) => [r.id, r]));
    for (const [id, p] of inGame) {
      const r = online.get(id);
      if (!!p.off !== !r) { p.off = !r; changed = true; }
      if (r && r.name && r.name !== p.name) { p.name = r.name; changed = true; }
    }
    for (const r of roster) {
      if (inGame.has(r.id)) continue;
      const ti = r.team === 0 || r.team === 1 ? r.team : smaller(teamSizes(true));
      st.teams[ti].players.push({ id: r.id, name: r.name });
      changed = true;
    }
    return changed;
  }

  /* ================= الرسائل ================= */
  function onMessage(m) {
    if (!m || !m.type) return;
    if (isHost()) {
      if (m.type === "hello") broadcast();
      else if (m.type === "action") hostAction(m.from, m);
    } else {
      if (m.type === "state") applyState(m.state, m.remaining, false);
      else if (m.type === "closed" && st && m.hostId === st.hostId) roomClosed();
    }
  }

  function applyState(s, remaining, fromSelf) {
    if (!fromSelf) {
      if (!s) return;
      if (st && st.hostId === s.hostId && (s.rev || 0) < (st.rev || 0)) return;
      clearTimeout(joinTimer); clearInterval(helloTimer); joinTimer = helloTimer = null;
      st = s;
      localEndsAt = remaining != null ? Date.now() + remaining : null;
    } else {
      localEndsAt = st.endsAt;
    }
    if (st.teams) {
      const ti = st.teams.findIndex((t) => t.players.some((p) => p.id === me.id));
      if (ti !== -1 && me.team !== ti) { me.team = ti; tx.track(me); saveRoom(); }
    }
    if (autoTeam()) return;
    render();
  }

  function onPresence(list) {
    const before = new Set(roster.map((r) => r.id));
    roster = list;
    if (before.size && roster.some((r) => !before.has(r.id))) Sound.play("join");
    if (autoTeam()) return;
    if (isHost() && reconcile()) { commit(); return; }
    render();
  }

  /** اختيار الفريق الأقل عدداً للاعب الجديد — بعد ما نعرف مين موجود في الغرفة */
  function autoTeam() {
    if (me.team === 0 || me.team === 1) return false;
    if (!isHost() && (!st || !roster.some((r) => r.host))) return false;
    const others = roster.filter((r) => r.id !== me.id);
    const sizes = st && st.teams
      ? teamSizes(true)
      : [0, 1].map((i) => others.filter((r) => r.team === i).length);
    me.team = smaller(sizes);
    saveRoom();
    tx.track(me);
    return true;
  }

  function act(a) {
    if (!tx) return;
    if (isHost()) hostAction(me.id, a);
    else tx.send({ type: "action", from: me.id, ...a });
  }

  /* ================= الكلمة على جهاز الشارح ================= */
  function myWord() {
    const key = `${code}:${st.gameId}:${st.round}`;
    const saved = sGet(WORD_KEY);
    if (saved && saved.key === key) return saved.word;
    const w = Words.pick(st.settings.categories, st.usedWords || []);
    Words.markUsed(w.id);
    sSet(WORD_KEY, { key, word: w });
    return w;
  }

  /* ================= العرض ================= */
  function netBanner() {
    const b = UI.$("#netBanner");
    if (!st || isHost() || !connected()) { b.hidden = true; return; }
    const hostOn = roster.some((r) => r.host && r.id === st.hostId);
    b.hidden = hostOn;
    b.textContent = "المضيف انقطع اتصاله… بانتظار رجوعه.";
  }

  function fx() {
    // مؤثرات عند تغيّر المرحلة (مرة وحدة لكل مرحلة)
    const k = `${st.gameId}:${st.round}:${st.phase}`;
    if (k === lastFx) return;
    lastFx = k;
    const amEx = st.explainerId === me.id;
    if (st.phase === "turn" && amEx) { Sound.play("reveal"); Sound.vibrate([60, 50, 60]); }
    if (st.phase === "play") { Sound.play("start"); Sound.vibrate(60); }
    if (st.phase === "result" && st.lastResult) Sound.play(st.lastResult.got ? "got" : "miss");
    if (st.phase === "win") { Sound.play("win"); Sound.vibrate([100, 60, 100, 60, 300]); }
  }

  function render() {
    if (!st || !me) return;
    netBanner();
    if (st.phase === "lobby") {
      lastKey = "";
      renderLobby();
      if (UI.current() !== "settings") UI.show("online");
      return;
    }
    UI.updateBar(st);
    if (UI.current() === "settings") return;
    const key = JSON.stringify([
      st.gameId, st.phase, st.round, st.explainerId, st.winner, st.settings.target,
      st.teams.map((t) => [t.name, t.score, t.players.map((p) => `${p.id}${p.off ? 0 : 1}${p.name}`)])
    ]);
    if (key === lastKey) return;
    lastKey = key;
    fx();

    const amEx = st.explainerId === me.id;
    const ex = Engine.explainer(st);
    switch (st.phase) {
      case "turn":
      case "reveal":
        UI.Timer.stop();
        timeUpShown = false;
        if (amEx && st.phase === "reveal") {
          UI.renderReveal(myWord());
          UI.show("reveal");
        } else if (amEx) {
          UI.renderTurn({ state: st, role: "me" });
          UI.show("turn");
        } else {
          UI.renderTurn({
            state: st, role: "other", myTeam: me.team, canSkip: isHost(),
            offlineNote: ex && ex.off ? "الشارح غير متصل حالياً. المضيف يقدر يتخطى الدور." : ""
          });
          UI.show("turn");
        }
        break;
      case "play":
        UI.renderPlay({ state: { ...st, timeUp: timeUpShown && amEx }, word: amEx ? myWord() : null, myTeam: me.team });
        UI.$("#hostSkip").hidden = !(isHost() && !amEx);
        UI.show("play");
        UI.Timer.start(localEndsAt || Date.now(), st.timerTotal || st.settings.roundTime * 1000, onTimeUp);
        break;
      case "result": {
        const canNext = isHost() || (st.lastResult && st.lastResult.explainerId === me.id);
        UI.Timer.stop();
        UI.renderResult({ state: st, canNext, waitText: "بانتظار الشارح أو المضيف يكمّل" });
        UI.show("result");
        break;
      }
      case "win":
        UI.Timer.stop();
        UI.renderWin({ state: st, canAct: isHost() });
        UI.show("win");
        break;
    }
  }

  function onTimeUp() {
    if (!st || st.phase !== "play" || timeUpShown) return;
    timeUpShown = true;
    if (st.explainerId === me.id) UI.$("#timeupMsg").hidden = false;
    else UI.$("#watchSub").textContent = "خلص الوقت! بانتظار الشارح يسجّل النتيجة.";
    Sound.play("timeUp");
    Sound.vibrate([220, 90, 220]);
  }

  function renderLobby() {
    UI.$("#onlineEntry").hidden = true;
    UI.$("#onlineLobby").hidden = false;
    UI.$("#onlineTitle").textContent = "غرفة الانتظار";
    UI.$("#roomCode").textContent = code;

    // نحافظ على مكان الكتابة إذا كان المضيف يعدّل اسم فريق
    const ae = document.activeElement;
    const focusTeam = ae && ae.dataset ? ae.dataset.lobbyTeamName : undefined;
    const sel = focusTeam !== undefined ? [ae.selectionStart, ae.selectionEnd] : null;

    UI.$("#lobbyTeams").innerHTML = [0, 1].map((i) => {
      const list = roster.filter((r) => r.team === i);
      const name = st.teamNames[i] || `فريق ${i + 1}`;
      return `
      <div class="team-card ${UI.teamClass(i)}">
        <div class="team-head">
          <span class="team-dot"></span>
          ${isHost()
            ? `<input type="text" class="team-name-input" data-lobby-team-name="${i}" value="${UI.esc(st.teamNames[i])}" placeholder="فريق ${i + 1}" maxlength="18" aria-label="اسم الفريق" />`
            : `<h3 style="flex:1">${UI.esc(name)}</h3>`}
          <span class="team-count">${list.length} لاعبين</span>
        </div>
        <ul class="players">
          ${list.map((p) => `
            <li class="player">
              <span class="name">${UI.esc(p.name)}</span>
              ${p.host ? `<span class="tag host">${UI.icon("crown")}المضيف</span>` : ""}
              ${p.id === me.id ? `<span class="tag me">أنت</span>` : ""}
            </li>`).join("") || `<li class="muted small">ما فيه أحد للحين</li>`}
        </ul>
        ${me.team === i
          ? `<button class="btn btn-ghost btn-sm join-team joined" disabled>أنت في هالفريق</button>`
          : `<button class="btn btn-soft btn-sm join-team" data-join-team="${i}">انضم لهالفريق</button>`}
      </div>`;
    }).join("");

    if (focusTeam !== undefined) {
      const el = UI.$(`[data-lobby-team-name="${focusTeam}"]`);
      if (el) { el.focus(); try { el.setSelectionRange(sel[0], sel[1]); } catch { /* تجاهل */ } }
    }

    const panel = UI.$("#lobbySettings");
    const s = st.settings;
    if (isHost()) {
      panel.innerHTML = `
        <div class="panel-row"><label>وقت الجولة</label><div class="stepper" data-stepper="roundTime"></div></div>
        <div class="panel-row"><label>نقاط الفوز</label><div class="stepper" data-stepper="target"></div></div>
        <div class="panel-block"><span class="label">الفئات</span><div class="chips" data-categories="lobby"></div></div>`;
      UI.renderSteppers(panel);
      UI.renderCategoryChips(panel);
    } else {
      panel.innerHTML = `
        <div class="panel-row"><span>وقت الجولة</span><b>${s.roundTime} ثانية</b></div>
        <div class="panel-row"><span>نقاط الفوز</span><b>${s.target} نقاط</b></div>
        <div class="panel-block"><span class="label">الفئات</span><div class="chips" data-categories="lobby"></div></div>`;
      UI.renderCategoryChips(panel, { disabled: true, values: s.categories });
    }
    UI.$("#lobbyStart").hidden = !isHost();
    UI.$("#lobbyWait").hidden = isHost();
  }

  /* ================= الاتصال ================= */
  async function connect() {
    tx = await Transport.connect(code, { ...me }, { onMessage, onPresence });
    clearInterval(healTimer);
    // المضيف يعيد بث الحالة دورياً لتعويض أي رسالة ضايعة
    healTimer = setInterval(() => { if (isHost()) broadcast(); }, 4000);
  }

  function resetLocal() {
    clearTimeout(joinTimer); clearInterval(helloTimer); clearInterval(healTimer); clearTimeout(nameTimer);
    joinTimer = helloTimer = healTimer = null;
    UI.Timer.stop();
    if (tx) tx.leave();
    tx = null; st = null; roster = []; code = null; lastKey = ""; lastFx = "";
    UI.$("#netBanner").hidden = true;
  }

  function showEntry(err = "") {
    UI.$("#onlineEntry").hidden = false;
    UI.$("#onlineLobby").hidden = true;
    UI.$("#onlineTitle").textContent = "اللعب من الجوالات";
    UI.$("#onlineError").textContent = err;
    const n = UI.$("#onlineNotice");
    if (!Transport.configured()) {
      n.hidden = false;
      n.innerHTML = `وضع التجربة: ما تم ربط Supabase بعد، فاللعب الجماعي يشتغل حالياً بين تبويبات نفس المتصفح فقط. لتفعيله بين الجوالات حط بيانات مشروعك في <code>js/config.js</code>.`;
    } else n.hidden = true;
    const saved = Store.read("wb.onlineName", "");
    if (saved && !UI.$("#onName").value) UI.$("#onName").value = saved;
    UI.show("online");
  }

  function setBusy(b) {
    UI.$$('[data-action="online-create"], [data-action="online-join"]').forEach((el) => (el.disabled = b));
  }

  function readName() {
    const name = UI.$("#onName").value.trim();
    if (!name) { UI.$("#onlineError").textContent = "اكتب اسمك أول."; UI.$("#onName").focus(); return null; }
    Store.write("wb.onlineName", name);
    return name;
  }

  async function startJoin(c, name, team, host) {
    code = c;
    me = { id: myId, name, team: team ?? null, host };
    setBusy(true);
    try {
      await connect();
    } catch (e) {
      resetLocal(); setBusy(false);
      showEntry(e.message || "تعذّر الاتصال.");
      return;
    }
    setBusy(false);
    saveRoom();
    if (host) {
      st = Store.read(hostKey(), null) || newLobby();
      st.hostId = me.id;
      if (st.teams) reconcile();
      commit();
    } else {
      UI.$("#onlineError").textContent = "جاري الدخول للغرفة…";
      const hello = () => tx && tx.send({ type: "hello", from: me.id });
      hello();
      helloTimer = setInterval(hello, 1500);
      joinTimer = setTimeout(() => {
        if (st) return;
        resetLocal();
        sSet(ROOM_KEY, null);
        showEntry("ما لقينا غرفة بهالرمز، أو المضيف مو متصل. تأكد من الرمز وجرب مرة ثانية.");
      }, 7000);
    }
  }

  function roomClosed() {
    resetLocal();
    sSet(ROOM_KEY, null);
    UI.toast("المضيف أنهى الغرفة");
    UI.show("home");
    WB.App && WB.App.refreshHome();
  }

  /* ================= الأوامر ================= */
  const ctrl = {
    kind: "online",

    openEntry() {
      if (connected() && st) { render(); return; }
      showEntry();
    },

    async create() {
      const name = readName();
      if (!name) return;
      UI.$("#onlineError").textContent = "";
      await startJoin(genCode(), name, 0, true);
    },

    async join() {
      const name = readName();
      if (!name) return;
      const c = UI.$("#onCode").value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
      if (c.length !== 5) { UI.$("#onlineError").textContent = "رمز الغرفة ٥ خانات."; return; }
      await startJoin(c, name, null, false);
    },

    canRejoin: () => !!sGet(ROOM_KEY),
    async rejoin() {
      const r = sGet(ROOM_KEY);
      if (!r) return false;
      showEntry();
      await startJoin(r.code, r.name, r.team, r.host);
      return true;
    },

    joinTeam(i) {
      if (!tx || !st || st.phase !== "lobby") return;
      me.team = i;
      saveRoom();
      tx.track(me);
      Sound.play("tap");
    },

    setTeamName(i, value) {
      if (!isHost() || !st || st.phase !== "lobby") return;
      st.teamNames[i] = value;
      clearTimeout(nameTimer);
      nameTimer = setTimeout(commit, 250);
    },

    start() {
      if (!isHost() || !st || st.phase !== "lobby") return;
      const teams = [0, 1].map((i) => ({
        name: (st.teamNames[i] || "").trim() || `فريق ${i + 1}`,
        players: roster.filter((r) => r.team === i).map((r) => ({ id: r.id, name: r.name }))
      }));
      const err = UI.$("#lobbyError");
      if (teams.some((t) => t.players.length < 2)) { err.textContent = "كل فريق يحتاج لاعبين اثنين على الأقل."; Sound.vibrate(80); return; }
      if (teams[0].name === teams[1].name) { err.textContent = "خلّ أسماء الفرق مختلفة."; return; }
      if (!st.settings.categories.length) { err.textContent = "اختر فئة وحدة على الأقل."; return; }
      err.textContent = "";
      const { hostId, rev, settings } = st;
      st = Engine.create(teams, settings);
      Object.assign(st, { hostId, rev, gameId: Engine.uid() });
      Engine.beginTurn(st);
      commit();
    },

    ready() { if (st && st.phase === "turn" && st.explainerId === me.id) { myWord(); act({ act: "ready" }); } },
    startTimer() { if (st && st.phase === "reveal") act({ act: "start" }); },
    verdict(got) {
      if (!st || st.phase !== "play" || st.explainerId !== me.id) return;
      UI.$$(".verdict .btn").forEach((b) => (b.disabled = true));
      act({ act: "verdict", got, word: myWord() });
    },
    next() { act({ act: "next" }); },
    rematch() { act({ act: "rematch" }); },
    skip() { act({ act: "skip" }); },

    applySetting(key) {
      if (!isHost() || !st || !["roundTime", "target", "categories"].includes(key)) return;
      st.settings[key] = key === "categories" ? Store.settings.categories.slice() : Store.settings[key];
      if (key === "target") Engine.checkWin(st);
      commit();
    },

    canEditSettings: () => !connected() || isHost(),
    settingsValues: () => (st ? st.settings : null),
    inGame: () => connected() && !!st,
    connected,
    code: () => code,
    render() { lastKey = ""; render(); },

    quit() {
      if (isHost() && tx) {
        tx.send({ type: "closed", hostId: me.id });
        try { localStorage.removeItem(hostKey()); } catch { /* تجاهل */ }
      }
      resetLocal();
      sSet(ROOM_KEY, null);
      sSet(WORD_KEY, null);
    }
  };

  return ctrl;
})();
