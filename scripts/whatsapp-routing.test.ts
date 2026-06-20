// ════════════════════════════════════════════════════════════════════════
// Kian — WhatsApp routing + summary regression tests (NO framework needed).
//
// Run:
//   node_modules/.bin/tsc lib/whatsapp/classify.ts lib/whatsapp/route.ts \
//     lib/whatsapp/summary.ts scripts/whatsapp-routing.test.ts \
//     --outDir /tmp/kian-test --module commonjs --target es2019 --skipLibCheck \
//     --moduleResolution node
//   node /tmp/kian-test/scripts/whatsapp-routing.test.js
//
// (The `@/…` type-only imports emit TS2307 during the isolated compile but are
//  erased from the JS, so the test still runs. The project `tsc --noEmit` is clean.)
// ════════════════════════════════════════════════════════════════════════
import { classifyWhatsAppMessage } from "../lib/whatsapp/classify";
import { routeDepartments } from "../lib/whatsapp/route";
import { buildZohoDescription } from "../lib/whatsapp/summary";

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) { console.log(`PASS  ${name}`); }
  else { failures++; console.log(`FAIL  ${name}${detail ? "  →  " + detail : ""}`); }
}

// Helper: route a raw message exactly as the ingest route does (classify → route).
function deptOf(msg: string): { primary: string; departments: string[] } {
  const cat = classifyWhatsAppMessage(msg).category;
  const d = routeDepartments(cat, msg);
  return { primary: d.primary, departments: d.departments };
}

// ── Phase A routing regressions ─────────────────────────────────────────────
{
  const r = deptOf("عندي تصوير زواج");
  check("تصوير زواج → sales_marketing", r.departments.includes("sales_marketing") && r.primary === "sales_marketing", JSON.stringify(r));
}
{
  const r = deptOf("ممكن ترسلون الفاتورة؟");
  check("الفاتورة → finance", r.departments.includes("finance"), JSON.stringify(r));
}
{
  const r = deptOf("ابي أقدم وظيفة مصور");
  check("وظيفة مصور → hr", r.departments.includes("hr"), JSON.stringify(r));
}
{
  const r = deptOf("عندي مشكلة في التسليم");
  check("مشكلة في التسليم → support", r.departments.includes("support"), JSON.stringify(r));
}
{
  // Existing sales conversation that later says "الفاتورة": that message must route to finance.
  const r = deptOf("الفاتورة");
  check("لاحقًا: الفاتورة → finance (visible to finance)", r.departments.includes("finance"), JSON.stringify(r));
}
{
  const r = deptOf("ابي عرض سعر");
  check("عرض سعر → sales_marketing primary + finance routed", r.primary === "sales_marketing" && r.departments.includes("finance"), JSON.stringify(r));
}

// ── Structured Arabic summary (full conversation) ───────────────────────────
{
  const desc = buildZohoDescription({
    displayName: "خالد", phone: "0501234567", waId: "966501234567",
    salesStage: "quote_requested",
    conversationLink: "https://www.kianmedia.com/client-portal/admin/whatsapp?conversation=abc",
    messages: [
      { body: "عندي تصوير زواج", direction: "incoming", created_at: "2026-06-18T10:00:00Z" },
      { body: "ابي عرض سعر", direction: "incoming", created_at: "2026-06-18T10:01:00Z" },
      { body: "هل عندكم تصوير درون؟", direction: "incoming", created_at: "2026-06-18T10:02:00Z" },
      { body: "الموقع في الخبر", direction: "incoming", created_at: "2026-06-18T10:03:00Z" },
    ],
  });
  check("summary: الخدمة المطلوبة: تصوير زواج", desc.includes("الخدمة المطلوبة: تصوير زواج"));
  check("summary: نوع الطلب: عرض سعر", desc.includes("نوع الطلب: عرض سعر"));
  check("summary: المدينة/الموقع: الخبر", desc.includes("المدينة/الموقع: الخبر"));
  check("summary: الدرون: نعم", desc.includes("الدرون: نعم"));
  check("summary: آخر رسالة = الموقع في الخبر", desc.includes("آخر رسالة من العميل: الموقع في الخبر"));
}

console.log(failures === 0 ? "\nALL PASS ✓" : `\n${failures} FAILED ✗`);
process.exit(failures === 0 ? 0 : 1);
