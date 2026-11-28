/* اختبارات وحدة البلاغات — تشتغل بـ Node بدون أي مكتبات:
   node tests/reports.test.js */
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const root = path.join(__dirname, "..");
function load() {
  const store = {};
  const localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; }
  };
  const ctx = { localStorage, console, setTimeout, Promise, Math, Date, JSON };
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const f of ["js/config.js", "js/reports.js", "js/words.js"]) {
    vm.runInContext(fs.readFileSync(path.join(root, f), "utf8"), ctx, { filename: f });
  }
  return ctx.WB;
}

const word = { id: "food:easy:0", text: "كبسة", catName: "أكل ومشروبات", level: "easy", levelName: "سهل" };
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test("البلاغ يخفي الكلمة ويرسل سطر واحد", async () => {
  const WB = load();
  const rows = [];
  WB.Reports._setInsert(async (row) => { rows.push(row); });
  const r = await WB.Reports.send({ word, reason: "spelling", details: "تنكتب كذا", reporter: "علي" });
  assert.deepStrictEqual({ sent: r.sent, duplicate: r.duplicate }, { sent: true, duplicate: false });
  assert.strictEqual(WB.Reports.isHidden(word.id), true);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].word, "كبسة");
  assert.strictEqual(rows[0].reason, "spelling");
  assert.strictEqual(rows[0].reporter, "علي");
  assert.ok(rows[0].device_id && rows[0].device_id.length <= 40);
});

test("نفس الكلمة من نفس الجهاز ما تنرسل مرتين", async () => {
  const WB = load();
  let calls = 0;
  WB.Reports._setInsert(async () => { calls++; });
  await WB.Reports.send({ word, reason: "unclear", details: "", reporter: "علي" });
  const r = await WB.Reports.send({ word, reason: "unclear", details: "", reporter: "علي" });
  assert.strictEqual(r.duplicate, true);
  assert.strictEqual(calls, 1);
});

test("إذا فشل الإرسال الكلمة تختفي برضو", async () => {
  const WB = load();
  WB.Reports._setInsert(async () => { throw new Error("offline"); });
  const r = await WB.Reports.send({ word, reason: "other", details: "", reporter: "علي" });
  assert.strictEqual(r.sent, false);
  assert.strictEqual(WB.Reports.isHidden(word.id), true);
});

test("الوصف الطويل ينقص لـ ٢٠٠ حرف، والنوع الغلط يتحول other", async () => {
  const WB = load();
  const rows = [];
  WB.Reports._setInsert(async (row) => { rows.push(row); });
  await WB.Reports.send({ word, reason: "hack", details: "ا".repeat(500), reporter: "س".repeat(100) });
  assert.strictEqual(rows[0].details.length, 200);
  assert.strictEqual(rows[0].reason, "other");
  assert.ok(rows[0].reporter.length <= 40);
});

test("الكلمة المخفية ما تطلع من البنك أبداً", async () => {
  const WB = load();
  WB.Reports._setInsert(async () => {});
  const cat = WB.CATEGORIES.find((c) => c.id === "food");
  // نخفي كل كلمات «أكل/سهل» إلا وحدة
  const keep = "food:easy:5";
  for (let i = 0; i < cat.easy.length; i++) {
    const id = `food:easy:${i}`;
    if (id !== keep) await WB.Reports.send({ word: { id, text: cat.easy[i] }, reason: "other", details: "", reporter: "" });
  }
  for (let n = 0; n < 200; n++) {
    const w = WB.Words.pick(["food"]);
    assert.ok(!WB.Reports.isHidden(w.id), `طلعت كلمة مخفية: ${w.id}`);
  }
});

test("أنواع البلاغ الخمسة موجودة بالترتيب", () => {
  const WB = load();
  // نقارن كنص لأن المصفوفة جاية من بيئة vm ثانية
  assert.strictEqual(JSON.stringify(WB.Reports.REASONS.map((r) => r.id)), JSON.stringify(["spelling", "unclear", "duplicate", "inappropriate", "other"]));
});

(async () => {
  let failed = 0;
  for (const t of tests) {
    try { await t.fn(); console.log("✓", t.name); }
    catch (e) { failed++; console.log("✗", t.name, "\n   ", e.message); }
  }
  console.log(failed ? `\n${failed} فشل` : "\nكل الاختبارات نجحت");
  process.exit(failed ? 1 : 0);
})();
