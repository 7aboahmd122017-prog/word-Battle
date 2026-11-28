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
  let joinTimer = null, helloTimer = null, healTimer = null, nameTimer = null, tickTimer = null;
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

  const cleanWord = (w) => (w
    ? { id: String(w.id || ""), text: String(w.text || "").slice(0, 80), catName: String(w.catName || "").slice(0, 30) }
    : null);

  // الشارح المنقطع ننتظره مهلة الـ ٢٠ ثانية (GRACE_MS تحت). إذا ما رجع، الدور ينتقل
  // لغيره من نفس الفريق تلقائياً. ما فيه أحد عنده صلاحية يتخطى الشارح بيده.
  const OFFLINE_SKIP_MS = 0;
  let offlineSince = null;

  /** فحص دوري عند المضيف: انتهاء الوقت، والشارح المنقطع */
  function hostTick() {
    const s = st;
    if (!isHost() || !s || !s.teams) return;
    const now = Date.now();
    // الوقت خلص ومحد بلّغ (مثلاً جوال الشارح بالخلفية): نبدأ السرقة
    if (s.phase === "play" && s.endsAt && now > s.endsAt + 1500) { Engine.startSteal(s, now); commit(); return; }
    const ex = Engine.explainer(s);
    const live = ["turn", "reveal", "play", "steal"].includes(s.phase);
    // ما كان فيه أحد متصل من الفريق، ورجع واحد منهم: نختار شارح ونكمل
    if (s.phase === "turn" && !ex && s.teams[s.turnTeam].players.some((p) => !p.off)) { Engine.beginTurn(s); commit(); return; }
    if (live && ex && ex.off) {
      if (!offlineSince || offlineSince.id !== ex.id || offlineSince.round !== s.round) offlineSince = { id: ex.id, round: s.round, at: now };
      else if (now - offlineSince.at > OFFLINE_SKIP_MS) { offlineSince = null; Engine.beginTurn(s); commit(); }
    } else {
      offlineSince = null;
    }
  }

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
        // أثناء الشرح: جابوها = نقطة لفريق الشارح. ما جابوها = يبدأ وقت السرقة
        if (s.phase === "play" && isEx) {
          if (a.got) { Engine.record(s, s.turnTeam, cleanWord(a.word)); commit(); }
          else { Engine.startSteal(s); commit(); }
        }
        break;
      case "timeup":
        // جهاز الشارح يبلغ إن الوقت خلص (والمضيف يتأكد بنفسه بعد في hostTick)
        if (s.phase === "play" && isEx) { Engine.startSteal(s); commit(); }
        break;
      case "award":
        // وقت السرقة: الشارح يحدد سرقوها أو لا. فريق الشارح ما له نقطة بعد وقته
        if (s.phase === "steal" && isEx) {
          Engine.record(s, a.who === "other" ? 1 - s.turnTeam : null, cleanWord(a.word));
          commit();
        }
        break;
      case "next":
        if (s.phase === "result" && (from === me.id || (s.lastResult && s.lastResult.explainerId === from))) { Engine.next(s); commit(); }
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
      // away = انقطع وننتظره (مهلة ٢٠ ثانية)، off = طلع نهائياً
      if (!!p.off !== !r) { p.off = !r; changed = true; }
      const away = !!(r && r.away);
      if (!!p.away !== away) { p.away = away; changed = true; }
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
      UI.$("#onlineError").textContent = "";
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

  /* مهلة ٢٠ ثانية: إذا انطفى جوال لاعب أو قفل الشاشة، يبقى في الغرفة بعلامة «انقطع…»
     ولو رجع خلالها يكمل عادي. بعدها يطلع من القائمة، ولازم يرجع يفتح الموقع. */
  const GRACE_MS = 20000;
  const gone = new Map(); // id → {meta, at}
  let present = [];       // المتصلين فعلياً حسب السيرفر
  let graceTimer = null;
  let seenHost = false;   // شفنا المضيف متصل مرة على الأقل (عشان ما نعتبره طلع قبل ما يوصلنا)

  function onPresence(list) {
    const now = Date.now();
    const ids = new Set(list.map((r) => r.id));
    const before = new Set(present.map((r) => r.id));
    for (const r of present) if (!ids.has(r.id) && !gone.has(r.id)) gone.set(r.id, { meta: r, at: now });
    for (const id of ids) gone.delete(id);
    for (const [id, g] of gone) if (now - g.at >= GRACE_MS) gone.delete(id);
    present = list;
    roster = [...list, ...[...gone.values()].map((g) => ({ ...g.meta, away: true }))];

    // نرجع نحسب أول ما تخلص مهلة أقرب واحد انقطع
    clearTimeout(graceTimer);
    if (gone.size) {
      const next = Math.min(...[...gone.values()].map((g) => g.at + GRACE_MS)) - now;
      graceTimer = setTimeout(() => onPresence(present), Math.max(0, next) + 50);
    }

    if (before.size && list.some((r) => !before.has(r.id))) Sound.play("join");

    // المضيف طلع وخلصت مهلته (٢٠ ثانية) وما رجع: المباراة انتهت
    if (!isHost() && st && st.hostId) {
      if (roster.some((r) => r.id === st.hostId)) seenHost = true;
      else if (seenHost) { roomClosed(true); return; }
    }

    if (autoTeam()) return;
    if (isHost() && reconcile()) { commit(); return; }
    render();
  }

  /** اختيار الفريق الأقل عدداً للاعب الجديد — بعد ما نعرف مين موجود في الغرفة.
      إذا دخل كذا واحد بنفس اللحظة (مثلاً كلهم صوّروا الـ QR سوا) كل واحد يشوف نفس الأعداد
      ويختار نفس الفريق؛ عشان كذا اللاعب ينتظر لحظة عشوائية قصيرة ثم يحسب من جديد. */
  let teamPick = null;
  function assignTeam() {
    if (!tx || me.team === 0 || me.team === 1) return;
    const others = roster.filter((r) => r.id !== me.id);
    const sizes = st && st.teams
      ? teamSizes(true)
      : [0, 1].map((i) => others.filter((r) => r.team === i).length);
    me.team = smaller(sizes);
    saveRoom();
    tx.track(me);
  }
  function autoTeam() {
    if (me.team === 0 || me.team === 1) return false;
    if (isHost()) { assignTeam(); return true; }
    if (!st || !roster.some((r) => r.host)) return false;
    if (!teamPick) {
      teamPick = setTimeout(() => { teamPick = null; assignTeam(); }, 300 + Math.random() * 1700);
    }
    return false;
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
    sSet(WORD_KEY, { key, word: w, skipped: false });
    return w;
  }

  /** هل استخدم الشارح تخطيه في هالدور؟ (محفوظ على جهازه بس) */
  function skipUsed() {
    const saved = sGet(WORD_KEY);
    return !!(saved && saved.key === `${code}:${st.gameId}:${st.round}` && saved.skipped);
  }

  /** كم بلاغ باقي للشارح في هالدور (٣ بالكثير). محفوظ مع كلمته على جهازه */
  const MAX_REPORTS = 3;
  function reportsLeft() {
    const saved = sGet(WORD_KEY);
    const used = saved && saved.key === `${code}:${st.gameId}:${st.round}` ? saved.reports || 0 : 0;
    return MAX_REPORTS - used;
  }

  /* ================= العرض ================= */
  function netBanner() {
    const b = UI.$("#netBanner");
    if (!st || isHost() || !connected()) { b.hidden = true; return; }
    const host = roster.find((r) => r.id === st.hostId);
    b.hidden = !!host && !host.away;
    b.textContent = "المضيف انقطع اتصاله… ننتظره ٢٠ ثانية، وإذا ما رجع تنتهي المباراة.";
  }

  function fx() {
    // مؤثرات عند تغيّر المرحلة (مرة وحدة لكل مرحلة)
    const k = `${st.gameId}:${st.round}:${st.phase}`;
    if (k === lastFx) return;
    lastFx = k;
    const amEx = st.explainerId === me.id;
    if (st.phase === "turn" && amEx) { Sound.play("reveal"); Sound.vibrate([60, 50, 60]); }
    if (st.phase === "play") { Sound.play("start"); Sound.vibrate(60); }
    if (st.phase === "steal") { Sound.play("timeUp"); Sound.vibrate([220, 90, 220]); }
    if (st.phase === "result" && st.lastResult) {
      const r = st.lastResult;
      Sound.play(r.to === 0 || r.to === 1 || r.got ? "got" : "miss");
    }
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
      st.teams.map((t) => [t.name, t.score, t.players.map((p) => `${p.id}${p.off ? 0 : p.away ? 2 : 1}${p.name}`)])
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
          UI.setSkip(true, !skipUsed());
          UI.setReport(true, reportsLeft());
          UI.show("reveal");
        } else if (amEx) {
          UI.renderTurn({ state: st, role: "me" });
          UI.show("turn");
        } else {
          UI.renderTurn({
            state: st, role: "other", myTeam: me.team,
            offlineNote: !ex
              ? `ما فيه أحد متصل من فريق ${st.teams[st.turnTeam].name}. اللعبة تكمل أول ما يرجع واحد منهم.`
              : ex.away || ex.off ? "الشارح انقطع اتصاله… ننتظره ٢٠ ثانية، وإذا ما رجع الدور ينتقل لغيره." : ""
          });
          UI.show("turn");
        }
        break;
      case "play":
      case "steal":
        timeUpShown = false;
        UI.renderPlay({ state: st, word: amEx ? myWord() : null, myTeam: me.team });
        UI.setSkip(amEx && st.phase === "play", amEx && !skipUsed());
        UI.setReport(amEx && st.phase === "play", amEx ? reportsLeft() : 0);
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

  /** خلص الوقت على هالجهاز:
      وقت الشرح ← جهاز الشارح يبلّغ المضيف عشان يبدأ وقت السرقة
      وقت السرقة ← الشارح يحدد النقطة، والباقين ينتظرون */
  function onTimeUp() {
    if (!st || timeUpShown) return;
    timeUpShown = true;
    const amEx = st.explainerId === me.id;
    if (st.phase === "play") {
      if (amEx) act({ act: "timeup" });
    } else if (st.phase === "steal") {
      if (amEx) UI.stealOver();
      else UI.$("#watchSub").textContent = "خلص وقت السرقة! بانتظار الشارح يحدد النقطة لمين.";
      Sound.play("timeUp");
      Sound.vibrate([220, 90, 220]);
    }
  }

  function renderLobby() {
    UI.$("#onlineEntry").hidden = true;
    UI.$("#onlineLobby").hidden = false;
    UI.$("#onlineTitle").textContent = "غرفة الانتظار";
    UI.$("#roomCode").textContent = code;
    // نرسم QR الغرفة مرة وحدة لكل غرفة (مو مع كل تحديث للوبي)
    const qrEl = UI.$("#roomQR");
    if (qrEl.dataset.code !== code) {
      qrEl.dataset.code = code;
      WB.Share.renderQR(qrEl, WB.Share.roomUrl(code), `رمز QR لدخول الغرفة ${code}`);
    }

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
            <li class="player${p.away ? " offline" : ""}">
              <span class="name">${UI.esc(p.name)}</span>
              ${p.away ? `<span class="tag away">انقطع…</span>` : ""}
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
        <div class="panel-row"><label>نقاط الفوز</label><div class="stepper" data-stepper="target"></div></div>`;
      UI.renderSteppers(panel);
    } else {
      panel.innerHTML = `
        <div class="panel-row"><span>وقت الجولة</span><b>${s.roundTime} ثانية</b></div>
        <div class="panel-row"><span>نقاط الفوز</span><b>${s.target} نقاط</b></div>`;
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
    clearInterval(tickTimer);
    tickTimer = setInterval(hostTick, 1000);
  }

  function resetLocal() {
    clearTimeout(joinTimer); clearInterval(helloTimer); clearInterval(healTimer); clearInterval(tickTimer); clearTimeout(nameTimer); clearTimeout(teamPick);
    joinTimer = helloTimer = healTimer = tickTimer = teamPick = null;
    UI.Timer.stop();
    if (tx) tx.leave();
    tx = null; st = null; roster = []; code = null; lastKey = ""; lastFx = "";
    clearTimeout(graceTimer); gone.clear(); present = []; seenHost = false;
    UI.$("#netBanner").hidden = true;
  }

  // رمز الغرفة إذا اللاعب جا من QR أو رابط: نعرض له الدخول بس بدون «إنشاء غرفة»
  let quickCode = "";

  function showEntry(err = "") {
    UI.$("#onlineEntry").hidden = false;
    UI.$("#onlineLobby").hidden = true;
    UI.$("#onlineTitle").textContent = quickCode ? "ادخل الغرفة" : "اللعب من الجوالات";
    UI.$("#onlineError").textContent = err;
    UI.$("#quickJoin").hidden = !quickCode;
    UI.$("#quickJoinBtn").hidden = !quickCode;
    UI.$("#entrySplit").hidden = !!quickCode;
    if (quickCode) {
      UI.$("#quickCode").textContent = quickCode;
      UI.$("#onCode").value = quickCode;
    }
    const n = UI.$("#onlineNotice");
    if (!Transport.configured()) {
      n.hidden = false;
      n.textContent = "اللعب من أكثر من جوال لسا ما تفعّل. حالياً تقدر تجربه بين تبويبات نفس المتصفح بس، وللعب مع الشلة استخدم «جهاز واحد».";
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
        showEntry(Transport.configured()
          ? "ما لقينا غرفة بهالرمز، أو المضيف مو متصل. تأكد من الرمز وجرب مرة ثانية."
          : "ما نقدر ندخل غرفة من جهاز ثاني للحين: اللعب بين الجوالات يحتاج ربط Supabase أول. حالياً يشتغل بين تبويبات نفس المتصفح بس.");
      }, 7000);
    }
  }

  /** الغرفة انتهت: نرجّع اللاعب للبداية ونعلمه برسالة واضحة.
      left=true يعني المضيف طلع (انقطع وما رجع)، مو إنه أنهاها بنفسه */
  function roomClosed(left = false) {
    resetLocal();
    sSet(ROOM_KEY, null);
    sSet(WORD_KEY, null);
    if (WB.App) WB.App.endOnline();
    UI.show("home");
    Sound.play("miss");
    Sound.vibrate([120, 60, 120]);
    UI.notify(
      "انتهت المباراة",
      left
        ? "المضيف طلع من الغرفة وما رجع، فانتهت المباراة. تقدرون تبدون مباراة جديدة من «يلا نلعب»."
        : "المضيف أنهى المباراة. تقدرون تبدون مباراة جديدة من «يلا نلعب».",
      "تمام"
    );
  }

  // لما يرجع الجوال من القفل أو من تطبيق ثاني: نعلن وجودنا من جديد ونطلب آخر حالة،
  // عشان يرجع للغرفة على طول بدل ما ينتظر السيرفر يكتشف رجوعه
  document.addEventListener("visibilitychange", () => {
    if (document.hidden || !tx || !me) return;
    try { tx.track(me); } catch { /* تجاهل */ }
    if (isHost()) broadcast();
    else tx.send({ type: "hello", from: me.id });
  });

  /* ================= الأوامر ================= */
  const ctrl = {
    kind: "online",

    openEntry() {
      if (connected() && st) { render(); return; }
      quickCode = ""; // جا من شاشة الطريقة: يشوف الخيارين (إنشاء ودخول)
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
    rejoinCode: () => (sGet(ROOM_KEY) || {}).code || "",

    /** فتح شاشة الدخول والرمز معبّى (من رابط أو QR) */
    /** جا من QR أو رابط غرفة: اسمه وزر الدخول بس */
    openWithCode(c) {
      quickCode = c;
      showEntry();
      const name = UI.$("#onName");
      if (!name.value.trim()) name.focus();
    },
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

    /** تخطي الكلمة على جهاز الشارح بس: الكلمة الجديدة ما تنرسل لأحد */
    skipWord() {
      if (!st || st.explainerId !== me.id || !["reveal", "play"].includes(st.phase) || skipUsed()) return;
      const current = myWord();
      const next = Words.pick(st.settings.categories, [...(st.usedWords || []), current.id]);
      Words.markUsed(next.id);
      const prev = sGet(WORD_KEY) || {};
      sSet(WORD_KEY, { key: `${code}:${st.gameId}:${st.round}`, word: next, skipped: true, reports: prev.reports || 0 });
      Sound.play("reveal");
      Sound.vibrate(30);
      UI.setSkip(true, false);
      UI.swapWord(next, st.phase);
    },

    /** بلاغ عن الكلمة على جهاز الشارح بس: يوصل للأدمن، والكلمة تتبدّل.
        الكلمة الجديدة ما تنرسل لأحد، وما يستهلك التخطي */
    async reportWord({ reason, details }) {
      if (!st || st.explainerId !== me.id || !["reveal", "play"].includes(st.phase) || reportsLeft() <= 0) return;
      const key = `${code}:${st.gameId}:${st.round}`;
      const prev = sGet(WORD_KEY) || {};
      const bad = myWord();
      const next = Words.pick(st.settings.categories, [...(st.usedWords || []), bad.id]);
      Words.markUsed(next.id);
      sSet(WORD_KEY, { key, word: next, skipped: !!prev.skipped, reports: (prev.reports || 0) + 1 });
      UI.setReport(true, reportsLeft());
      UI.swapWord(next, st.phase);
      const r = await WB.Reports.send({ word: bad, reason, details, reporter: me.name, roomCode: code });
      UI.toast(r.sent || r.duplicate ? "وصل البلاغ، شكراً! وتبدّلت الكلمة" : "ما قدرنا نرسل البلاغ، بس ما راح تطلع لك هالكلمة مرة ثانية");
    },
    startTimer() { if (st && st.phase === "reveal") act({ act: "start" }); },
    verdict(got) {
      if (!st || st.phase !== "play" || st.explainerId !== me.id) return;
      UI.$$(".verdict .btn").forEach((b) => (b.disabled = true));
      act({ act: "verdict", got, word: myWord() });
    },
    /** وقت السرقة: الشارح يحدد سرقوها ("other") أو لا ("none") */
    award(who) {
      if (!st || st.phase !== "steal" || st.explainerId !== me.id) return;
      act({ act: "award", who, word: myWord() });
    },
    next() { act({ act: "next" }); },
    rematch() { act({ act: "rematch" }); },

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
    /** للتشخيص من الكونسول: مين متصل حسب المضيف، وحالة لاعبي المباراة */
    debug: () => ({
      me, roster: roster.map((r) => ({ id: r.id, name: r.name, team: r.team, host: r.host })),
      phase: st && st.phase, explainerId: st && st.explainerId,
      players: st && st.teams ? st.teams.map((t) => t.players.map((p) => ({ name: p.name, off: !!p.off }))) : null,
      offlineSince
    }),
    render() { lastKey = ""; render(); },

    quit() {
      sSet(ROOM_KEY, null);
      sSet(WORD_KEY, null);
      const wasHost = isHost();
      const id = me && me.id;
      if (wasHost) { try { localStorage.removeItem(hostKey()); } catch { /* تجاهل */ } }
      // نصفّر حالتنا على طول (عشان لو سوّى غرفة جديدة مباشرة ما تتأثر)،
      // ونقفل الاتصال القديم بعد ما نتأكد إن رسالة «انتهت» وصلت للاعبين
      const old = tx;
      tx = null;
      resetLocal();
      if (!old) return;
      (async () => {
        if (wasHost) {
          try { await old.send({ type: "closed", hostId: id }); } catch { /* تجاهل */ }
          await new Promise((r) => setTimeout(r, 300));
          try { await old.send({ type: "closed", hostId: id }); } catch { /* تجاهل */ }
        }
        try { await old.leave(); } catch { /* تجاهل */ }
      })();
    }
  };

  return ctrl;
})();
