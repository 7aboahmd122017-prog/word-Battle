-- =========================================================
-- جدول بلاغات الكلمات — «وِش الكلمة؟»
-- الصقه في Supabase ← SQL Editor ← Run (مرة وحدة بس)
-- قبل التشغيل: غيّر ADMIN_EMAIL_HERE لإيميلك (في ٣ أماكن تحت)
-- =========================================================

-- ١) الجدول: كل بلاغ سطر
create table if not exists public.word_reports (
  id          bigint generated always as identity primary key,
  word_id     text not null,                 -- معرّف الكلمة في البنك
  word        text not null,                 -- الكلمة نفسها
  category    text,                          -- الفئة
  level       text,                          -- المستوى (سهل/متوسط/صعب)
  reason      text not null,                 -- نوع البلاغ
  details     text,                          -- وصف اللاعب (اختياري)
  reporter    text,                          -- اسم اللاعب في اللعبة
  room_code   text,                          -- رمز الغرفة (أونلاين)
  device_id   text,                          -- رقم جهاز عشوائي
  created_at  timestamptz not null default now(),
  resolved    boolean not null default false -- خلّصت منه ولا لا
);

-- ٢) نشغّل الحماية على مستوى الأسطر: بدونها أي أحد يقرا كل شي
alter table public.word_reports enable row level security;

-- ٣) الصلاحيات الأساسية:
--    الزوار (anon) يضيفون بس. حساب مسجّل (الأدمن) يقرا ويعدّل ويحذف
revoke all on public.word_reports from anon, authenticated;
grant insert on public.word_reports to anon, authenticated;
grant select, update, delete on public.word_reports to authenticated;

-- ٤) قاعدة الإضافة: أي لاعب يقدر يضيف بلاغ، بس بشروط
drop policy if exists reports_insert_public on public.word_reports;
create policy reports_insert_public on public.word_reports
  for insert to anon, authenticated
  with check (
    reason in ('spelling', 'unclear', 'duplicate', 'inappropriate', 'other')
    and resolved = false
    and char_length(word) between 1 and 80
    and char_length(word_id) between 1 and 80
    and (details   is null or char_length(details)   <= 200)
    and (reporter  is null or char_length(reporter)  <= 40)
    and (room_code is null or char_length(room_code) <= 8)
    and (device_id is null or char_length(device_id) <= 40)
    and (category  is null or char_length(category)  <= 40)
    and (level     is null or char_length(level)     <= 20)
  );

-- ٥) القراءة والتعديل والحذف: إيميل الأدمن بس
drop policy if exists reports_admin_select on public.word_reports;
create policy reports_admin_select on public.word_reports
  for select to authenticated
  using ((auth.jwt() ->> 'email') = 'ADMIN_EMAIL_HERE');

drop policy if exists reports_admin_update on public.word_reports;
create policy reports_admin_update on public.word_reports
  for update to authenticated
  using ((auth.jwt() ->> 'email') = 'ADMIN_EMAIL_HERE')
  with check ((auth.jwt() ->> 'email') = 'ADMIN_EMAIL_HERE');

drop policy if exists reports_admin_delete on public.word_reports;
create policy reports_admin_delete on public.word_reports
  for delete to authenticated
  using ((auth.jwt() ->> 'email') = 'ADMIN_EMAIL_HERE');
