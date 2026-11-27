/* إعدادات الربط مع Supabase للعب من الجوالات.
   1) أنشئ مشروع على https://supabase.com
   2) من Project Settings → API انسخ Project URL و anon public key وحطها هنا.
   لا تحتاج جداول أو SQL: اللعبة تستخدم Realtime (Broadcast + Presence) فقط.

   إذا تركتها فاضية، يشتغل "وضع التجربة" بين تبويبات نفس المتصفح فقط. */
window.WB = window.WB || {};
WB.CONFIG = {
  SUPABASE_URL: "",
  SUPABASE_ANON_KEY: ""
};
