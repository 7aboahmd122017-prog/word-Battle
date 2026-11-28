/* منطق المباراة — مشترك بين اللعب المحلي والمضيف في اللعب الجماعي.
   الحالة كائن JSON بسيط حتى يمكن حفظه ومزامنته. */
window.WB = window.WB || {};

WB.Engine = (() => {
  function uid() { return Math.random().toString(36).slice(2, 10); }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /** teams: [{name, players:[{id,name}]}] */
  function create(teams, settings) {
    return {
      teams: teams.map((t) => ({ name: t.name, players: t.players.slice(), score: 0, done: [], last: null })),
      settings: { roundTime: settings.roundTime, target: settings.target, categories: settings.categories.slice() },
      turnTeam: Math.random() < 0.5 ? 0 : 1,
      explainerId: null,
      round: 0,
      phase: "turn",
      endsAt: null,
      timeUp: false,
      lastResult: null,
      winner: null,
      usedWords: []
    };
  }

  /** اختيار عشوائي عادل: ما أحد يشرح مرتين قبل ما يشرح كل أعضاء فريقه.
      team.done = اللي شرحوا في الدورة الحالية. اللي ينضم وسط الدورة يدخلها على طول،
      واللي غير متصل يتخطّاه الدور لين يرجع. */
  function pickExplainer(team) {
    const active = team.players.filter((p) => !p.off).map((p) => p.id);
    if (!active.length) return null;
    team.done = (team.done || []).filter((id) => team.players.some((p) => p.id === id));
    let waiting = active.filter((id) => !team.done.includes(id));
    if (!waiting.length) {
      // خلصت الدورة: نبدأ وحدة جديدة، وما نعيد نفس آخر شارح أول واحد
      team.done = [];
      waiting = active.length > 1 ? active.filter((id) => id !== team.last) : active;
    }
    const id = shuffle(waiting)[0];
    team.done.push(id);
    team.last = id;
    return id;
  }

  function beginTurn(s) {
    s.round += 1;
    s.explainerId = pickExplainer(s.teams[s.turnTeam]);
    s.phase = "turn";
    s.endsAt = null;
    s.timeUp = false;
    s.skipUsed = false; // كل شارح معه تخطي واحد في دوره
    s.reportsUsed = 0;  // و٣ بلاغات عن كلمات فيها غلط
  }

  function startTimer(s, now = Date.now()) {
    s.phase = "play";
    s.timeUp = false;
    s.timerTotal = s.settings.roundTime * 1000;
    s.endsAt = now + s.timerTotal;
  }

  function explainer(s) {
    for (const t of s.teams) {
      const p = t.players.find((x) => x.id === s.explainerId);
      if (p) return p;
    }
    return null;
  }

  // بعد ما يخلص وقت الشرح (أو ما جابوها): الفريق الثاني عنده ٢٠ ثانية يسرق الكلمة
  const STEAL_MS = 20000;

  function startSteal(s, now = Date.now()) {
    s.phase = "steal";
    s.timeUp = false;
    s.timerTotal = STEAL_MS;
    s.endsAt = now + STEAL_MS;
  }

  /** الشارح يحدد النقطة لمين.
      to: رقم الفريق اللي ياخذ النقطة، أو null إذا ما أحد جابها.
      word: {id, text, catName} */
  function record(s, to, word) {
    const winnerTeam = to === 0 || to === 1 ? to : null;
    if (winnerTeam !== null) s.teams[winnerTeam].score += 1;
    const ex = explainer(s);
    s.lastResult = {
      to: winnerTeam,
      got: winnerTeam === s.turnTeam,
      stolen: winnerTeam !== null && winnerTeam !== s.turnTeam,
      team: s.turnTeam,
      word: word ? word.text : "",
      catName: word ? word.catName : "",
      explainerName: ex ? ex.name : "",
      explainerId: s.explainerId
    };
    if (word && word.id && !s.usedWords.includes(word.id)) s.usedWords.push(word.id);
    s.endsAt = null;
    if (winnerTeam !== null && s.teams[winnerTeam].score >= s.settings.target) {
      s.winner = winnerTeam;
      s.phase = "win";
    } else {
      s.phase = "result";
    }
  }

  function next(s) {
    s.turnTeam = 1 - s.turnTeam;
    beginTurn(s);
  }

  /** يعيد فحص الفوز إذا تغيّر هدف النقاط أثناء المباراة */
  function checkWin(s) {
    if (s.phase !== "result") return;
    const i = s.teams.findIndex((t) => t.score >= s.settings.target);
    if (i !== -1) { s.winner = i; s.phase = "win"; }
  }

  function rematch(s) {
    s.teams.forEach((t) => { t.score = 0; t.done = []; t.last = null; });
    s.winner = null;
    s.lastResult = null;
    s.round = 0;
    s.turnTeam = Math.random() < 0.5 ? 0 : 1;
    beginTurn(s);
  }

  return { uid, shuffle, create, beginTurn, startTimer, startSteal, explainer, record, next, checkWin, rematch, STEAL_MS };
})();
