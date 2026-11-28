#!/usr/bin/env bash
# فحص أمان جدول البلاغات: نتصرف كأننا شخص غريب معه مفتاح الموقع العام بس.
# التشغيل: bash tests/security.sh
# ملاحظة: الفحص يضيف بلاغ تجريبي واحد كلمته "security-test" (تقدر تعلّمه «تم» من صفحة الأدمن).
# النصوص هنا إنجليزي عن قصد: سطر أوامر ويندوز يخرب النص العربي قبل ما يرسله.
set -u
cd "$(dirname "$0")/.."

URL=$(grep -o 'https://[a-z0-9]*\.supabase\.co' js/config.js | head -1)
KEY=$(grep -o 'sb_publishable_[A-Za-z0-9_-]*' js/config.js | head -1)
API="$URL/rest/v1/word_reports"
H=(-H "apikey: $KEY" -H "Authorization: Bearer $KEY" -H "Content-Type: application/json")
pass=0; fail=0
ok()  { echo "✓ $1"; pass=$((pass+1)); }
bad() { echo "✗ $1 ($2)"; fail=$((fail+1)); }
code() { curl -s -o /dev/null -w "%{http_code}" "$@"; }
# الرفض = 401 أو 403 (ما عنده صلاحية / خالف قاعدة الحماية)
denied() { [ "$2" = "401" ] || [ "$2" = "403" ] && ok "$1" || bad "$1" "الرد: $2، المتوقع رفض 401/403"; }

valid='{"word_id":"security:test","word":"security-test","reason":"other","details":"automatic security check","reporter":"security-check","device_id":"security"}'

c=$(code -X POST "$API" "${H[@]}" -H 'Prefer: return=minimal' -d "$valid")
[ "$c" = "201" ] && ok "إضافة بلاغ صحيح مسموحة" || bad "إضافة بلاغ صحيح مسموحة" "الرد: $c"

denied "قراءة البلاغات ممنوعة"                 "$(code "$API?select=*" "${H[@]}")"
denied "تعديل البلاغات ممنوع"                  "$(code -X PATCH "$API?word_id=eq.security:test" "${H[@]}" -d '{"resolved":true}')"
denied "حذف البلاغات ممنوع"                    "$(code -X DELETE "$API?word_id=eq.security:test" "${H[@]}")"
denied "نوع بلاغ غير معروف مرفوض"              "$(code -X POST "$API" "${H[@]}" -d '{"word_id":"x","word":"x","reason":"hack"}')"
denied "إضافة بلاغ «محلول» من برا مرفوضة"       "$(code -X POST "$API" "${H[@]}" -d '{"word_id":"x","word":"x","reason":"other","resolved":true}')"
long=$(printf 'a%.0s' $(seq 1 300))
denied "وصف أطول من ٢٠٠ حرف مرفوض"              "$(code -X POST "$API" "${H[@]}" -d "{\"word_id\":\"x\",\"word\":\"x\",\"reason\":\"other\",\"details\":\"$long\"}")"

echo
echo "نجح $pass، فشل $fail"
[ "$fail" -eq 0 ]
