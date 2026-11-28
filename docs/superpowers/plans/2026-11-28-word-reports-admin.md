# Word Reports + Admin Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the explainer report a broken word (type + optional details) and let the owner review reports on a login-protected admin page.

**Architecture:** A `word_reports` table in the existing Supabase project, locked with Row Level Security (public insert-only; read/update only for the admin email). A small `js/reports.js` module sends reports and keeps a per-device hidden-words list that the word picker respects. `admin.html` + `js/admin.js` sign in with Supabase Auth and list reports grouped by word.

**Tech Stack:** Plain HTML/CSS/JS (no build), supabase-js 2.100.0 vendored at `js/vendor/supabase.min.js`, config in `js/config.js`, Supabase Postgres + RLS + Auth. Tests: Node `vm` scripts (no deps) for pure logic, `curl` against the REST API for security, the preview browser for UI.

**Spec:** `docs/superpowers/specs/2026-11-28-word-reports-admin-design.md`

## Global Constraints

- Report types (exact ids → labels): `spelling` غلط إملائي، `unclear` غير واضحة أو ما أحد يعرفها، `duplicate` مكررة، `inappropriate` غير مناسبة، `other` غير ذلك.
- `details` optional, ≤ 200 chars; `word` ≤ 80; `reporter` ≤ 40; `room_code` ≤ 8; `device_id` ≤ 40.
- Max **3 reports per explainer per turn**; reporting swaps the word and does **not** consume the turn's skip.
- A reported word is hidden on the reporting device even if sending fails; a device never reports the same word twice.
- Online: report + swap happen on the explainer's device only; the new word is never broadcast.
- Admin read/update allowed only for the admin email the owner types into the SQL; that email is never committed.
- `admin.html` has `<meta name="robots" content="noindex">` and no link from the game.
- All user-facing copy in Saudi Arabic, matching the game's tone.

## Review Focus

1. Anonymous `select`/`update`/`delete` on `word_reports` must return nothing / be rejected — checked in Task 5.
2. Sending a report while offline (Supabase unreachable) must still hide and swap the word and show the offline message — checked in Task 3.
3. Reporting the same word twice from one device must not send a second row — checked in Task 2.
4. A 4th report in the same turn must be impossible (button hidden) and the counter must reset next turn, also after page refresh — checked in Task 3.
5. Admin page with a wrong password or a non-admin account must show an error and no data — checked in Task 5.

---

### Task 1: Database table and security rules (SQL)

**Files:**
- Create: `supabase/word_reports.sql`

**Interfaces:**
- Produces: table `public.word_reports(id bigint identity, word_id text, word text, category text, level text, reason text, details text, reporter text, room_code text, device_id text, created_at timestamptz default now(), resolved boolean default false)`; RLS policies `reports_insert_public` (to anon, authenticated; with check on lengths, reason in the 5 ids, `resolved = false`), `reports_admin_select` / `reports_admin_update` / `reports_admin_delete` (to authenticated; `auth.jwt() ->> 'email' = 'ADMIN_EMAIL_HERE'`).

- [ ] **Step 1:** Write the SQL with `ADMIN_EMAIL_HERE` placeholders and Arabic comments explaining each block. `grant insert on word_reports to anon, authenticated; grant select, update, delete to authenticated; grant usage on sequence`. No `select` grant to anon.
- [ ] **Step 2:** Owner pastes it into Supabase SQL Editor (after replacing the placeholder), creates the admin user, turns off public sign-ups.
- [ ] **Step 3 (verify):** `curl -X POST .../rest/v1/word_reports` with the publishable key and a valid body → HTTP 201. `curl .../rest/v1/word_reports?select=*` with the publishable key → `[]`.
- [ ] **Step 4:** Commit `supabase/word_reports.sql`.

### Task 2: Reports module + picker respects hidden words

**Files:**
- Create: `js/reports.js` (loaded in `index.html` before `js/words.js` is used at runtime; script order after `js/config.js`)
- Modify: `js/words.js` (`pick` excludes hidden ids)
- Test: `tests/reports.test.js` (Node `vm`, no deps)

**Interfaces:**
- Produces: `WB.Reports.REASONS` (array of `{id,label}` from Global Constraints); `WB.Reports.isHidden(wordId: string): boolean`; `WB.Reports.hiddenIds(): string[]`; `WB.Reports.send({word:{id,text,catName,levelName}, reason:string, details:string, reporter:string, roomCode?:string}): Promise<{sent:boolean, duplicate:boolean}>` — hides the word first, returns `duplicate:true` without sending if already hidden; `WB.Reports.deviceId(): string` (random, kept in localStorage `wb.deviceId`).

- [ ] **Step 1: Failing tests** in `tests/reports.test.js`: `send` with fake transport → `isHidden(id) === true`; second `send` same id → `{duplicate:true}` and fake insert called once; `send` when insert throws → `{sent:false}` and still hidden; `Words.pick` over a category whose only remaining unhidden id is X returns X for 50 draws when others are hidden; `details` longer than 200 is cut to 200.
- [ ] **Step 2:** Run `node tests/reports.test.js` → fails (module missing).
- [ ] **Step 3:** Implement `js/reports.js`; inserting uses `supabase.createClient(URL, KEY).from('word_reports').insert(row)` loaded lazily from `js/vendor/supabase.min.js` (reuse the loader pattern in `js/transport.js`), with a test hook `WB.Reports._setInsert(fn)`. In `js/words.js`, merge `WB.Reports.hiddenIds()` (if defined) into the exclude set.
- [ ] **Step 4:** `node tests/reports.test.js` → all pass. `node --check` on both files.
- [ ] **Step 5:** Commit.

### Task 3: Report button, dialog, and controllers (local + online)

**Files:**
- Modify: `index.html` (report button on reveal + play explainer areas; report dialog markup), `css/style.css`, `js/ui.js`, `js/local.js`, `js/online.js`, `js/app.js`, `js/engine.js` (`beginTurn` sets `s.reportsUsed = 0`)

**Interfaces:**
- Consumes: `WB.Reports.send`, `WB.Reports.REASONS`, `UI.swapWord(word, screen)` (existing).
- Produces: `UI.setReport(visible:boolean, left:number)` (label shows remaining, hidden when `left === 0`); `UI.openReport(): Promise<{reason, details}|null>`; controller method `reportWord({reason, details})` on `WB.Local` and `WB.Online`; app action `report-word`.

- [ ] **Step 1:** Dialog: 5 reason chips (single choice, required), textarea `maxlength=200` with counter, buttons «أرسل البلاغ» / «إلغاء». Button «🚩 فيها غلط؟» visible only to the explainer on reveal (after flip) and play; hidden during steal.
- [ ] **Step 2:** Local: `reportWord` → `Reports.send({..., reporter: explainer name})`, pick a new word with `Words.pick` (excludes hidden), `markUsed`, `s.reportsUsed++`, `save()`, `UI.swapWord`, `UI.setReport(true, 3 - s.reportsUsed)`. Online: same on the explainer's device; count stored with the word in sessionStorage key `wb.myWord` (`reports` field) so refresh keeps it; `reporter: me.name`, `roomCode: code`.
- [ ] **Step 3:** Toasts: sent → «وصل البلاغ، شكراً! تبدّلت الكلمة»؛ failed → «ما قدرنا نرسل البلاغ، بس ما راح تطلع لك هالكلمة مرة ثانية»؛ duplicate → just swap.
- [ ] **Step 4 (verify in preview):** local match → reveal → report 3 times → 3 different words, button gone, skip still available; next turn → button back with 3; refresh mid-turn after 2 reports → 1 left. With Supabase blocked (`WB.Reports._setInsert(() => Promise.reject())`) → offline toast, word swapped. Online 2 tabs → explainer reports, watcher sees no word.
- [ ] **Step 5:** Commit.

### Task 4: Admin page

**Files:**
- Create: `admin.html`, `js/admin.js`, `css/admin.css` (imports tokens from `css/style.css`)

**Interfaces:**
- Consumes: `WB.CONFIG`, `js/vendor/supabase.min.js`, `WB.Reports.REASONS` (labels).
- Produces: page sections `#login` (email, password, «دخول»), `#dash` (stats, tabs «جديدة/محلولة», search, `#cards`), sign-out.

- [ ] **Step 1:** Login with `auth.signInWithPassword`; on error show «الإيميل أو كلمة السر غلط». Session persists (supabase default); «خروج» calls `auth.signOut`.
- [ ] **Step 2:** Load `select * order by created_at desc` filtered by tab (`resolved`); group by `word_id`; sort groups by count desc then latest; stats = new reports count + distinct words. Card: word, category, level, count badge, list of reports (reason label, details, reporter, room, device short, relative time). Button «تم» → `update({resolved:true}).eq('word_id', id)`; in «محلولة» button «رجّعها». Search filters by word text client-side.
- [ ] **Step 3 (verify):** with no session → login form only; wrong password → error; admin login → cards for reports inserted in Task 1/3; «تم» moves card to «محلولة».
- [ ] **Step 4:** Commit.

### Task 5: Security check + docs

**Files:**
- Modify: `README.md` (section: البلاغات وصفحة الأدمن — setup steps), `js/vendor/README.md` unchanged
- Test: `tests/security.sh` (curl checks, no secrets)

- [ ] **Step 1:** `tests/security.sh`: with publishable key → select returns `[]`; `PATCH ... resolved=true` affects 0 rows; `DELETE` affects 0 rows; insert with `reason=hack` → 4xx; insert with `resolved=true` → 4xx; insert with 300-char details → 4xx.
- [ ] **Step 2:** Run it → all checks pass.
- [ ] **Step 3:** Run `/security-review`-style read of `js/reports.js`, `js/admin.js`, `admin.html`: no secret keys, report text rendered with `textContent`/escaping only.
- [ ] **Step 4:** Commit, then ask the owner before pushing.
