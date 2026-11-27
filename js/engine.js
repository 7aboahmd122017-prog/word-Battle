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
      teams: teams.map((t) => ({ name: t.name, players: t.players.slice(), score: 0, bag: [], last: null })),
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

  /** اختيار عشوائي بدون تكرار حتى يأخذ كل أعضاء الفريق دورهم */
  function pickExplainer(team) {
    const ids = team.players.filter((p) => !p.off).map((p) => p.id);
    team.bag = team.bag.filter((id) => ids.includes(id));
    if (!team.bag.length) {
      team.bag = shuffle(ids);
      // لا نعيد نفس آخر شارح في بداية دورة جديدة
      if (team.bag.length > 1 && team.bag[0] === team.last) team.bag.push(team.bag.shift());
    }
    const id = team.bag.shift() || null;
    team.last = id;
    return id;
  }

  function beginTurn(s) {
    s.round += 1;
    s.explainerId = pickExplainer(s.teams[s.turnTeam]);
    s.phase = "turn";
    s.endsAt = null;
    s.timeUp = false;
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

  /** word: {id, text, catName} */
  function record(s, got, word) {
    const team = s.teams[s.turnTeam];
    if (got) team.score += 1;
    const ex = explainer(s);
    s.lastResult = {
      got,
      team: s.turnTeam,
      word: word ? word.text : "",
      catName: word ? word.catName : "",
      explainerName: ex ? ex.name : "",
      explainerId: s.explainerId
    };
    if (word && word.id && !s.usedWords.includes(word.id)) s.usedWords.push(word.id);
    s.endsAt = null;
    if (team.score >= s.settings.target) {
      s.winner = s.turnTeam;
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
    s.teams.forEach((t) => { t.score = 0; t.bag = []; t.last = null; });
    s.winner = null;
    s.lastResult = null;
    s.round = 0;
    s.turnTeam = Math.random() < 0.5 ? 0 : 1;
    beginTurn(s);
  }

  return { uid, shuffle, create, beginTurn, startTimer, explainer, record, next, checkWin, rematch };
})();
