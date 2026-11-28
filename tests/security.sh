#!/usr/bin/env bash
# فحص أمان جدول البلاغات: نتصرف كأننا شخص غريب معه مفتاح الموقع العام بس.
# التشغيل: bash tests/security.sh
# ملاحظة: الفحص يضيف بلاغ تجريبي واحد اسمه «فحص أمان تلقائي» (تقدر تعلّمه «تم» من صفحة الأدمن).
set -u
cd "$(dirname "$0")/.."

URL=$(grep -o 'https://[a-z0-9]*\.supabase\.co' js/config.js | head -1)
KEY=$(grep -o 'sb_publishable_[A-Za-z0-9_-]*' js/config.js | head -1)
API="$URL/rest/v1/word_reports"
H=(-H "apikey: $KEY" -H "Authorization: Bearer $KEY" -H "Content-Type: application/json")
pass=0; fail=0
check() { # check "الوصف" "المتوقع" "الفعلي"
  if [ "$2" = "$3" ]; then echo "✓ $1"; pass=$((pass+1)); else echo "✗ $1 (المتوقع: $2، الفعلي: $3)"; fail=$((fail+1)); fi
}
code() { curl -s -o /dev/null -w "%{http_code}" "$@"; }
body() { curl -s "$@"; }

ok='{"word_id":"security:test","word":"فحص أمان تلقائي","reason":"other","details":"بلاغ تجريبي من فحص الأمان","reporter":"فحص","device_id":"security"}'

check "إضافة بلاغ صحيح مسموحة"            "201" "$(code -X POST "$API" "${H[@]}" -H 'Prefer: return=minimal' -d "$ok")"
check "قراءة البلاغات ممنوعة (ترجع فاضي)"  "[]"  "$(body "$API?select=*" "${H[@]}")"
check "تعديل بلاغ ما يأثر على شي"          "[]"  "$(body -X PATCH "$API?word_id=eq.security:test" "${H[@]}" -H 'Prefer: return=representation' -d '{"resolved":true}')"
check "حذف بلاغ ما يأثر على شي"            "[]"  "$(body -X DELETE "$API?word_id=eq.security:test" "${H[@]}" -H 'Prefer: return=representation')"
check "نوع بلاغ غير معروف مرفوض"           "403" "$(code -X POST "$API" "${H[@]}" -d '{"word_id":"x","word":"x","reason":"hack"}')"
check "إضافة بلاغ «محلول» من برا مرفوضة"   "403" "$(code -X POST "$API" "${H[@]}" -d '{"word_id":"x","word":"x","reason":"other","resolved":true}')"
long=$(printf 'ا%.0s' $(seq 1 300))
check "وصف أطول من ٢٠٠ حرف مرفوض"          "403" "$(code -X POST "$API" "${H[@]}" -d "{\"word_id\":\"x\",\"word\":\"x\",\"reason\":\"other\",\"details\":\"$long\"}")"

echo
echo "نجح $pass، فشل $fail"
[ "$fail" -eq 0 ]
