/* يحدّث رقم النسخة على ملفات CSS و JS داخل الصفحات (مثل js/ui.js?v=...)
   عشان المتصفحات تجيب النسخة الجديدة على طول بدل النسخة المحفوظة عندها.
   شغّله قبل كل رفع:  node tools/bump-version.js */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const pages = ["index.html", "admin.html"];
const now = new Date();
const pad = (n) => String(n).padStart(2, "0");
const version = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}`;

for (const page of pages) {
  const file = path.join(root, page);
  const before = fs.readFileSync(file, "utf8");
  // يلقط src="js/..." و href="css/..." (مع أو بدون ?v= قديم)
  const after = before.replace(/((?:src|href)="(?:js|css)\/[^"?]+\.(?:js|css))(?:\?v=[^"]*)?"/g, `$1?v=${version}"`);
  fs.writeFileSync(file, after);
  const count = (after.match(/\?v=/g) || []).length;
  console.log(`${page}: ${count} ملف ← v=${version}`);
}
