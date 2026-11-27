/* حفظ الإعدادات والإعداد المحلي في المتصفح */
window.WB = window.WB || {};

WB.Store = (() => {
  const SETTINGS_KEY = "wb.settings";
  const SETUP_KEY = "wb.setup";
  const GAME_KEY = "wb.localGame";

  const DEFAULT_SETTINGS = {
    sound: true,
    volume: 70,
    ticks: true,
    vibrate: true,
    roundTime: 60,
    target: 10,
    categories: WB.CATEGORIES.map((c) => c.id)
  };

  const DEFAULT_SETUP = {
    teams: [
      { name: "الصقور", players: ["", ""] },
      { name: "النشامى", players: ["", ""] }
    ]
  };

  const LIMITS = {
    roundTime: { min: 20, max: 180, step: 10 },
    target: { min: 3, max: 30, step: 1 }
  };

  function read(key, fallback) {
    try {
      const v = JSON.parse(localStorage.getItem(key));
      return v ?? fallback;
    } catch { return fallback; }
  }
  function write(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* تجاهل */ }
  }

  const settings = Object.assign({}, DEFAULT_SETTINGS, read(SETTINGS_KEY, {}));
  const validCats = new Set(WB.CATEGORIES.map((c) => c.id));
  settings.categories = (settings.categories || []).filter((c) => validCats.has(c));
  if (!settings.categories.length) settings.categories = DEFAULT_SETTINGS.categories.slice();

  const listeners = new Set();

  function setSetting(key, value) {
    if (LIMITS[key]) {
      const l = LIMITS[key];
      value = Math.min(l.max, Math.max(l.min, Number(value) || l.min));
    }
    settings[key] = value;
    write(SETTINGS_KEY, settings);
    listeners.forEach((fn) => fn(key, value));
  }

  return {
    settings,
    LIMITS,
    set: setSetting,
    onChange: (fn) => listeners.add(fn),
    getSetup: () => {
      const s = read(SETUP_KEY, null);
      return s && Array.isArray(s.teams) && s.teams.length === 2 ? s : JSON.parse(JSON.stringify(DEFAULT_SETUP));
    },
    saveSetup: (s) => write(SETUP_KEY, s),
    getGame: () => read(GAME_KEY, null),
    saveGame: (g) => write(GAME_KEY, g),
    clearGame: () => { try { localStorage.removeItem(GAME_KEY); } catch { /* تجاهل */ } },
    read,
    write
  };
})();
