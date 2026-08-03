// ════════════════════════════════════════════════════════════════════════════
// tests/wave4_crm_business.test.js
//
// Wave 4 — دفعة ربط CRM والأعمال.
// V2-4.1-A/C · V2-4.2-A/B/C/D · V2-4.3-A/B · V2-4.4-A/C · V2-4.5-A
//
// عقد ساكن + فحوص طفرية. ⛔ لا SQL يُشغَّل · لا قاعدة · لا شبكة · لا إرسال.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const read = (r) => fs.readFileSync(path.join(ROOT, r), "utf8");
const has = (r) => fs.existsSync(path.join(ROOT, r));

/** يجرّد التعليقات والسلاسل. */
function codeOnly(sql) {
  let out = "", i = 0, q = false;
  while (i < sql.length) {
    const c = sql[i];
    if (q) { if (c === "'") { if (sql.startsWith("''", i)) { out += "  "; i += 2; continue; } q = false; } out += c === "\n" ? "\n" : " "; i++; continue; }
    if (c === "'") { q = true; out += " "; i++; continue; }
    if (sql.startsWith("--", i)) { while (i < sql.length && sql[i] !== "\n") { out += " "; i++; } continue; }
    out += c; i++;
  }
  return out;
}
/** يجرّد التعليقات ويُبقي السلاسل — للتحقّق من الرسائل والقيود النصّية. */
const noComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");

const P = (n) => `docs/wave4_crm_business_${n}.sql`;
const SQL = () => read(P("RUNME"));
const CODE = () => codeOnly(SQL());
const STR = () => noComments(SQL());

/** يكسر حارسًا ويشترط أن يفشل الفحص المقابل. */
const catches = (label, mutate, check) => {
  const m = mutate(SQL());
  assert.notEqual(m, SQL(), `الطفرة لم تغيّر شيئًا: ${label}`);
  let threw = false;
  try { check(m); } catch { threw = true; }
  assert.ok(threw, `🔴 الطفرة لم تُرصد: ${label}`);
};

// ═══ الحزمة ════════════════════════════════════════════════════════════════

test("(W-1) ★★ الحزمة كاملة الأربعة ★★", () => {
  for (const n of ["PREFLIGHT", "RUNME", "POSTCHECK", "ROLLBACK"]) {
    assert.ok(has(P(n)), `${n} مفقود`);
    assert.ok(read(P(n)).length > 400, `${n} أقصر من أن يكون حقيقيًّا`);
  }
});

// ═══ V2-4.1-A · المناقصة توسّع الفرصة ولا توازيها ═══════════════════════════

test("(T-1) ★★★ لا جدول tenders موازٍ — ولا CRM ثانٍ ★★★", () => {
  const c = CODE();
  for (const bad of ["tenders", "tender", "client_health", "follow_ups", "rate_card_items",
                     "opportunities", "companies", "leads", "contacts"]) {
    assert.doesNotMatch(c, new RegExp(`create\\s+table\\s+(if\\s+not\\s+exists\\s+)?(public\\.)?${bad}\\b`, "i"),
      `🔴 جدول موازٍ: ${bad}`);
  }
  // الامتداد علاقة ١:١ صارمة على الفرصة، لا جدول مستقلّ بمفتاحه.
  assert.match(c, /create table if not exists public\.crm_opportunity_tender/i, "الامتداد مفقود");
  assert.match(c, /opportunity_id\s+uuid primary key\s*\n?\s*references public\.crm_opportunities\(id\) on delete cascade/i,
    "🔴 ليست ١:١ على الفرصة — يمكن أن تتباعد عنها");
});

test("(T-2) ★★★ لا تكرار لبيانات الجهة أو العميل أو القيمة ★★★", () => {
  const raw = noComments(SQL());
  const ddl = raw.slice(raw.indexOf("create table if not exists public.crm_opportunity_tender"));
  const body = ddl.slice(0, ddl.indexOf("\n);"));
  // 🔴 هذه الحقول تعيش على crm_opportunities. تكرارها يُنتج مصدرين يتباعدان.
  for (const dup of ["company_name", "company_id", "client_name", "contact_id", "contact_name",
                     "lead_id", "estimated_value", "currency", "owner_user_id", "stage_id", "pipeline_id"]) {
    assert.ok(!body.includes(dup), `🔴 حقل مكرَّر من الفرصة: ${dup}`);
  }
  // وما يوجد فعلًا هو ما لا ينتمي لفرصة عادية.
  for (const own of ["tender_reference", "submission_due", "bid_bond_required", "submission_status"]) {
    assert.ok(body.includes(own), `حقل مناقصة مفقود: ${own}`);
  }
  catches("تكرار اسم الجهة في الامتداد",
    (m) => m.replace("  tender_reference text,", "  company_name     text,\n  tender_reference text,"),
    (m) => {
      const r = noComments(m);
      const d = r.slice(r.indexOf("create table if not exists public.crm_opportunity_tender"));
      assert.ok(!d.slice(0, d.indexOf("\n);")).includes("company_name"));
    });
});

test("(T-3) ★★ صلاحية المناقصة تتبع الفرصة — لا بوّابة ثانية ★★", () => {
  const c = CODE();
  assert.match(c, /using \(public\.crm_can_read_opportunity\(opportunity_id\)\)/,
    "🔴 سياسة قراءة مستقلّة عن الفرصة");
  const fn = STR().slice(STR().indexOf("function public.crm_tender_upsert"));
  assert.match(fn, /crm_can_edit_opportunity\(p_opportunity\)/, "🔴 الكتابة بلا بوّابة الفرصة");
  // «مُقدَّم» يوجب تاريخ تقديم.
  assert.match(c, /crm_tender_submitted_pair/, "لا قيد يمنع حالة تقديم بلا تاريخ");
});

// ═══ V2-4.4-A · صحّة العميل مشتقّة ═══════════════════════════════════════════

test("(H-1) ★★★ صحّة العميل عرض مشتقّ — ولا جدول ولا عمود مخزَّن ★★★", () => {
  const c = CODE();
  assert.match(c, /create or replace view public\.crm_client_health_v/i, "ليست عرضًا");
  // 🔴 درجة مخزَّنة تتعفّن لحظة تسجيل نشاط جديد.
  assert.doesNotMatch(c, /create\s+table\s+(if\s+not\s+exists\s+)?(public\.)?crm_client_health/i,
    "🔴 صحّة العميل مخزَّنة في جدول");
  assert.doesNotMatch(c, /materialized\s+view/i, "🔴 عرض مادّيّ = نسخة تتقادم بلا تحديث");
  // كلّ مؤشّر يُحسب من مصدره القائم.
  const v = c.slice(c.indexOf("create or replace view public.crm_client_health_v"));
  const body = v.slice(0, v.indexOf(";"));
  assert.match(body, /from public\.crm_activities/, "آخر نشاط ليس من crm_activities");
  assert.match(body, /from public\.crm_opportunities/, "الفرص ليست من crm_opportunities");
  assert.match(body, /current_date - max\(a\.occurred_at\)::date/, "الصمت ليس مشتقًّا");

  catches("تحويل الصحّة إلى جدول",
    (m) => m.replace("create or replace view public.crm_client_health_v as",
                     "create table if not exists public.crm_client_health_v as"),
    (m) => assert.match(codeOnly(m), /create or replace view public\.crm_client_health_v/i));
});

test("(H-2) ★★★ لا مؤشّر ماليّ مستنتَج من بيانات ناقصة ★★★", () => {
  const c = CODE();
  const v = c.slice(c.indexOf("create or replace view public.crm_client_health_v"));
  const body = v.slice(0, v.indexOf(";"));
  // 🔴 ربح أو هامش أو قيمة عمر العميل من داخل عرض صحّة = رقم يُبنى عليه تسعير.
  for (const fin of ["profit", "margin", "revenue", "ltv", "lifetime_value", "cost"]) {
    assert.ok(!body.includes(fin), `🔴 مؤشّر ماليّ مستنتَج: ${fin}`);
  }
});

// ═══ V2-4.1-C · حماية الهامش ════════════════════════════════════════════════

test("(R-1) ★★★ الهامش محجوب بلا صلاحية مالية — والافتراض الحجب ★★★", () => {
  const fn = STR().slice(STR().indexOf("function public.crm_win_rate_report"));
  assert.match(fn, /can_see_financials\(\)/, "🔴 لا بوّابة مالية على الهامش");
  // 🔴 غياب البوّابة ⇒ false (حجب)، لا true (كشف).
  // مثبَّت على إسناد v_fin نفسه: أيّ coalesce آخر في الدالّة كان سيجعل الفحص
  // يمرّ حتى بعد قلب الافتراض.
  const vFin = fn.slice(fn.indexOf("v_fin := coalesce("), fn.indexOf("v_fin := coalesce(") + 220);
  assert.match(vFin, /is not null\),\s*false\);/,
    "🔴 غياب البوّابة لا يُترجم إلى حجب");
  assert.match(fn, /'margin_visible', v_fin/, "الحالة غير معلَنة للواجهة");
  // والواجهة تقول «محجوب» لا تعرض صفرًا.
  const ui = read("components/portal/crm/CrmWave4Panel.tsx");
  assert.match(ui, /محجوب/, "🔴 الواجهة لا تُعلن الحجب");
  assert.match(ui, /d\.margin_visible/, "الواجهة لا تقرأ حالة الحجب");

  catches("قلب الافتراض إلى كشف",
    (m) => m.replace("    false);", "    true);"),
    (m) => {
      const f = noComments(m).slice(noComments(m).indexOf("function public.crm_win_rate_report"));
      const v = f.slice(f.indexOf("v_fin := coalesce("), f.indexOf("v_fin := coalesce(") + 220);
      assert.match(v, /is not null\),\s*false\);/);
    });
});

test("(R-2) ★★ نسبة الفوز على المحسوم فقط ★★", () => {
  const fn = STR().slice(STR().indexOf("function public.crm_win_rate_report"));
  // 🔴 المقام = won+lost. إدخال المفتوحة يجعل الرقم يتحسّن كلّما أُهملت الصفقات.
  assert.match(fn, /count\(\*\) filter \(where status in \('won','lost'\)\)/,
    "🔴 المقام يشمل الفرص المفتوحة");
  assert.match(fn, /then null/, "قسمة على صفر بلا حماية");
});

// ═══ V2-4.2-B · دعوة الشهادة برمز ═══════════════════════════════════════════

test("(I-1) ★★★ الرمز الخامّ لا يُخزَّن — بصمة فقط ★★★", () => {
  const c = CODE(), s = STR();
  assert.match(s, /token_hash\s+text not null unique check \(token_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/,
    "🔴 لا قيد شكل على البصمة");
  // ⚠️ على STR() لا CODE(): codeOnly يمحو السلاسل فلا يرى 'sha256' إطلاقًا.
  assert.match(s, /digest\(v_raw, 'sha256'\)/, "الرمز لا يُهشَّم");
  const ddl = s.slice(s.indexOf("create table if not exists public.crm_testimonial_invites"));
  const body = ddl.slice(0, ddl.indexOf("\n);"));
  assert.ok(!/\btoken\s+text\b|token_raw|raw_token|token_plain/.test(body), "🔴 عمود للرمز الخامّ");

  catches("تخزين الرمز الخامّ",
    (m) => m.replace("  token_hash    text not null unique", "  token_raw     text,\n  token_hash    text not null unique"),
    (m) => assert.doesNotMatch(m, /\btoken_raw\b/));
});

test("(I-2) ★★★ منتهٍ · قابل للإلغاء · نطاق ضيّق · أقلّ امتياز ★★★", () => {
  const c = CODE(), s = STR();
  assert.match(s, /expires_at\s+timestamptz not null/, "🔴 دعوة بلا انتهاء ممكنة");
  assert.match(s, /constraint crm_ti_window check \(expires_at > issued_at\)/, "نافذة معكوسة ممكنة");
  assert.match(s, /crm_ti_revoked_pair/, "إلغاء بلا سبب مكتوب");
  // دعوة نشطة واحدة لكلّ مشروع — تعدّدها يجعل الإلغاء بلا معنى.
  assert.match(c, /create unique index if not exists crm_ti_one_active_per_project/i,
    "🔴 أكثر من دعوة نشطة ممكنة");
  // الإصدار مشروط بالإغلاق **و** السداد معًا.
  const issue = s.slice(s.indexOf("function public.crm_testimonial_invite_issue"),
                        s.indexOf("$$;", s.indexOf("function public.crm_testimonial_invite_issue")));
  assert.match(issue, /if not v_closed then/, "🔴 الإصدار بلا شرط الإغلاق");
  // 🔴 ولا باب جانبيّ إلى المالية: الإغلاق يشمل الإخلاء المالي، وإعادة اشتقاقه
  //    هنا كانت ستُنشئ مصدر حقيقة ماليًّا ثانيًا (رصده كنس الحوكمة المالية).
  for (const t of ["fin_payment_milestones", "fin_collections", "fin_receivables"]) {
    assert.ok(!issue.includes(t), `🔴 قراءة مالية مباشرة في إصدار الدعوة: ${t}`);
  }
  assert.match(issue, /'trigger_conditions_not_met'/, "لا رفض صريح");
  // 🔒 ولا إرسال: القاعدة تُصدر والإنسان يرسل.
  assert.match(issue, /'auto_sent', false/, "🔴 لا إعلان بعدم الإرسال");
  for (const re of [/pg_net/i, /net\.http/i, /smtp/i, /send_email/i]) {
    assert.doesNotMatch(c, re, "🔴 إرسال من القاعدة");
  }
});

test("(I-3) ★★★ الرفض موحَّد — لا يكشف وجود مشروع أو عميل ★★★", () => {
  const s = STR();
  const chk = s.slice(s.indexOf("function public.crm_testimonial_invite_check"),
                      s.indexOf("$$;", s.indexOf("function public.crm_testimonial_invite_check")));
  // 🔴 الحارس قبل أيّ SELECT — نفس NULL-collapse الذي سبق أن كلّف هذا المشروع.
  const pre = chk.slice(0, chk.indexOf("select * into r"));
  assert.match(pre, /p_token_hash is null/, "🔴 لا رفض صريح لـNULL");
  assert.match(pre, /length\(p_token_hash\) <> 64/, "لا فحص طول");
  assert.match(pre, /\^\[0-9a-f\]\{64\}\$/, "لا فحص شكل");
  // ⛔ ردّ واحد لكلّ رفض، بلا سبب يميّز.
  const rejections = [...chk.matchAll(/jsonb_build_object\('ok', false[^)]*\)/g)].map((m) => m[0]);
  assert.ok(rejections.length >= 2, "لا مسارات رفض");
  for (const r of rejections) {
    assert.equal(r, "jsonb_build_object('ok', false)", `🔴 رفض يحمل سببًا يميّز: ${r}`);
  }
  // ⛔ ولا يُعاد project_id: الرمز يُثبت الحقّ ولا يكشف ما وراءه.
  assert.doesNotMatch(chk, /'project_id'/, "🔴 التحقّق يكشف المشروع");

  catches("تمييز سبب الرفض",
    (m) => m.replace("  if r.id is null or r.status <> 'active' or r.expires_at <= now() then\n    return jsonb_build_object('ok', false);",
                     "  if r.id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;\n  if r.status <> 'active' or r.expires_at <= now() then\n    return jsonb_build_object('ok', false);"),
    (m) => {
      const s2 = noComments(m);
      const c2 = s2.slice(s2.indexOf("function public.crm_testimonial_invite_check"),
                          s2.indexOf("$$;", s2.indexOf("function public.crm_testimonial_invite_check")));
      for (const r of [...c2.matchAll(/jsonb_build_object\('ok', false[^)]*\)/g)].map((x) => x[0])) {
        assert.equal(r, "jsonb_build_object('ok', false)");
      }
    });
});

// ═══ V2-4.4-C · الاقتراح لا يُرسِل ═══════════════════════════════════════════

test("(S-1) ★★★ «صامت ١٨٠ يومًا» اقتراح للقراءة — لا طابور تنفيذ ★★★", () => {
  const s = STR();
  const fn = s.slice(s.indexOf("function public.crm_silent_clients"),
                     s.indexOf("$$;", s.indexOf("function public.crm_silent_clients")));
  assert.match(fn, /'suggested', v_rows/, "🔴 المخرجات ليست معلَنة كاقتراح");
  assert.match(fn, /'auto_sent', false/, "🔴 لا إعلان بعدم الإرسال التلقائيّ");
  // 🔴 دالّة اقتراح لا تكتب صفًّا ولا تُنشئ نشاطًا.
  for (const re of [/\binsert\s+into\b/i, /\bupdate\s+public\./i, /\bdelete\s+from\b/i]) {
    assert.doesNotMatch(fn, re, "🔴 دالّة اقتراح تكتب في القاعدة");
  }
  assert.match(fn, /stable/, "الدالّة ليست stable — أي أنّها قد تكتب");
  // والواجهة تقول ذلك للمستخدم صراحةً.
  const ui = read("components/portal/crm/CrmWave4Panel.tsx");
  assert.match(ui, /لا يُرسَل شيء تلقائيًّا/, "🔴 الواجهة لا تُعلن أنّ الاقتراح لا يُرسَل");
});

// ═══ V2-4.3-A/B · الملخّص الأسبوعي ══════════════════════════════════════════

test("(D-1) ★★★ منع التكرار بمفتاح أسبوع — لا ملخّصان في الأسبوع نفسه ★★★", () => {
  const s = STR();
  const fn = s.slice(s.indexOf("function public.crm_weekly_digest"),
                     s.indexOf("$$;", s.indexOf("function public.crm_weekly_digest")));
  // 🔑 المفتاح مشتقّ من رقم الأسبوع ISO — تشغيلان في الأسبوع نفسه ⇒ مفتاح واحد.
  assert.match(fn, /'digest_key', 'crm_weekly:' \|\| to_char\(v_start, 'IYYY-IW'\)/,
    "🔴 لا مفتاح منع تكرار مشتقّ من الأسبوع");
  // 🔴 منطقة زمنية صريحة: منطقة الخادم تجعل تشغيلين متجاورين أسبوعين مختلفين.
  assert.match(fn, /at time zone 'Asia\/Riyadh'/, "🔴 بداية الأسبوع تتبع منطقة الخادم");
  // ⛔ ولا إرسال ولا كتابة من الدالّة.
  for (const re of [/\binsert\s+into\b/i, /\bupdate\s+public\./i, /pg_net/i, /smtp/i]) {
    assert.doesNotMatch(fn, re, "🔴 الملخّص يكتب أو يرسل");
  }

  catches("إسقاط مفتاح منع التكرار",
    (m) => m.replace("'digest_key', 'crm_weekly:' || to_char(v_start, 'IYYY-IW'),", ""),
    (m) => assert.match(noComments(m), /'digest_key', 'crm_weekly:' \|\| to_char\(v_start, 'IYYY-IW'\)/));
});

test("(D-2) ★★★ لا مجدول رابع — مطويّ في notify-email القائم، وخلف العلم ★★★", () => {
  assert.ok(!has("app/api/cron/crm-digest/route.ts"), "🔴 مجدول رابع (G8)");
  assert.ok(!has("app/api/cron/weekly-summary/route.ts"), "🔴 مجدول رابع (G8)");
  const cron = read("app/api/cron/notify-email/route.ts");
  assert.match(cron, /crm_weekly_digest/, "لم يُطوَ في الكرون القائم");
  assert.match(cron, /rpcAsService/, "لا يُستدعى بمفتاح الخدمة كبقيّة المحرّكات");
  // 🔒 العلم مطفأ ⇒ لا عمل خلفيّ إطلاقًا.
  assert.match(cron, /if \(process\.env\.NEXT_PUBLIC_SHOW_CRM_WAVE4 === "true"\)/,
    "🔴 الملخّص يعمل في الخلفية خلف علم مطفأ");
  // ومعزول: فشله لا يُسقط بقيّة الكرون.
  assert.match(cron, /CRM_WEEKLY_DIGEST_ERROR/, "الفشل غير معزول ولا مسجَّل");
  // ⛔ ولا إرسال حقيقيّ يُضاف هنا.
  const block = cron.slice(cron.indexOf("crm_weekly_digest") - 900, cron.indexOf("crm_weekly_digest") + 700);
  assert.doesNotMatch(block, /sendProjectEmail|sendCustodyEmail|wa\.me|whatsapp/i,
    "🔴 إرسال حقيقيّ في مسار الملخّص");
});

// ═══ V2-4.2-A/C/D · الشهادات ════════════════════════════════════════════════

test("(M-1) ★★★ لا شهادة تُنشر بلا اعتماد وموافقة استخدام ★★★", () => {
  const sql = read("docs/kian_testimonials_v1_RUNME.sql");
  const pub = sql.slice(sql.indexOf("function public.kian_public_testimonials"));
  const body = pub.slice(0, pub.indexOf("$$;"));
  // 🔴 الاعتماد شرط، وموافقة الاستخدام شرط — كلاهما في الاستعلام العامّ.
  assert.match(body, /status\s*=\s*'approved'/, "🔴 تُنشر شهادات غير معتمَدة");
  assert.match(body, /consent/, "🔴 تُنشر شهادة بلا موافقة استخدام");
});

test("(M-2) ★★★ العلم مطفأ ⇒ لا قسم ولا طلب شبكة ولا تبويب ★★★", () => {
  const r = read("components/Reviews.tsx");
  // 🔴 الحارس **قبل** الخطّافات: نسخة الفرع كانت تجلب في useEffect بلا شرط.
  assert.match(r, /export default function Reviews\(\) \{\s*\n\s*if \(!testimonialsEnabled\(\)\) return null;/,
    "🔴 الحارس ليس أوّل شيء — قد يصدر طلب شبكة خلف علم مطفأ");
  const iGuard = r.indexOf("if (!testimonialsEnabled()) return null;");
  const iFetch = r.indexOf("fetchPublicTestimonials(");
  assert.ok(iGuard > -1 && iFetch > iGuard, "🔴 الجلب قبل الحارس");
  assert.match(r, /process\.env\.NEXT_PUBLIC_SHOW_TESTIMONIALS === "true"/, "العلم ليس مقارنة صارمة");
  // والتبويب يُحذف من القائمة لا يُعرض ثمّ يُمنع.
  const nav = read("components/portal/nav.ts");
  assert.match(nav, /k !== "testimonials" \|\| process\.env\.NEXT_PUBLIC_SHOW_TESTIMONIALS === "true"/,
    "🔴 تبويب يقود إلى ميزة معطّلة");
});

test("(M-3) ★★★ الشهادات الملفَّقة حُذفت — والمسارات نُقلت لمجموعاتها ★★★", () => {
  // 🔴 الـBrief: حذف components/Testimonials.tsx إلزاميّ (كود ميت بثلاث شهادات ملفَّقة).
  assert.ok(!has("components/Testimonials.tsx"), "🔴 مكوّن الشهادات الملفَّقة ما زال موجودًا");
  // والمسارات القادمة من الفرع تعيش في مجموعات Wave 1 لا في جذر app/.
  assert.ok(has("app/(ar)/share-experience/page.tsx"), "مسار مشاركة التجربة مفقود");
  assert.ok(has("app/(portal)/client-portal/testimonials/page.tsx"), "مسار الاعتماد مفقود");
  assert.ok(!has("app/share-experience/page.tsx"), "🔴 مسار خارج مجموعة (ar)");
  assert.ok(!has("app/client-portal/testimonials/page.tsx"), "🔴 مسار خارج مجموعة (portal)");
});

// ═══ الأمن العامّ ═══════════════════════════════════════════════════════════

test("(G-1) ★★★ كلّ دالّة محصَّنة · anon يملك التحقّق وحده ★★★", () => {
  const c = CODE();
  const fns = [...c.matchAll(/create\s+or\s+replace\s+function\s+public\.([a-z0-9_]+)/gi)].map((m) => m[1]);
  assert.ok(fns.length >= 8, `عدد الدوالّ ${fns.length}`);
  for (const f of fns) assert.ok(f.startsWith("crm_"), `🔴 ${f} خارج بادئة CRM`);

  const defs = (c.match(/security\s+definer/gi) || []).length;
  const paths = (c.match(/set\s+search_path\s*=\s*public/gi) || []).length;
  assert.equal(defs, paths, `🔴 ${defs - paths} دالّة بلا search_path مثبَّت`);

  for (const f of fns) {
    assert.match(c, new RegExp(`revoke all on function public\\.${f}\\(`), `🔴 ${f} بلا REVOKE`);
  }
  // 🔴 anon يملك التحقّق من الرمز وحده.
  const anon = [...c.matchAll(/grant execute on function public\.([a-z0-9_]+)\([^)]*\)\s+to\s+([^;]+);/gi)]
    .filter((m) => /\banon\b/.test(m[2])).map((m) => m[1]);
  assert.deepEqual(anon, ["crm_testimonial_invite_check"],
    `🔴 anon يملك: ${anon.join(", ") || "لا شيء"}`);
  assert.doesNotMatch(c, /grant\s+all\b/i, "🔴 منح شامل");
  // RLS على الجدولين، ولا صلاحية جدول لـanon.
  assert.equal((c.match(/enable row level security/gi) || []).length, 2, "RLS ناقص");
  assert.match(c, /revoke all on public\.crm_opportunity_tender\s+from anon, public/, "🔴 جدول بلا REVOKE");
  assert.match(c, /revoke all on public\.crm_client_health_v from anon, public/, "🔴 العرض بلا REVOKE");
  assert.doesNotMatch(c, /create policy[^;]*for\s+(insert|update|delete)/i,
    "🔴 سياسة كتابة تتجاوز الدوالّ المحروسة");

  catches("منح الإصدار لـanon",
    (m) => m.replace("grant execute on function public.crm_testimonial_invite_issue(uuid,int) to authenticated;",
                     "grant execute on function public.crm_testimonial_invite_issue(uuid,int) to authenticated, anon;"),
    (m) => {
      const g = [...codeOnly(m).matchAll(/grant execute on function public\.([a-z0-9_]+)\([^)]*\)\s+to\s+([^;]+);/gi)]
        .filter((x) => /\banon\b/.test(x[2])).map((x) => x[1]);
      assert.deepEqual(g, ["crm_testimonial_invite_check"]);
    });
});

test("(G-2) ★★ إضافيّ · idempotent · PREFLIGHT/POSTCHECK لا يكتبان ★★", () => {
  const c = CODE();
  for (const re of [/drop\s+table/i, /truncate/i, /delete\s+from/i, /drop\s+column/i]) {
    assert.doesNotMatch(c, re, "🔴 RUNME يحذف");
  }
  // ⛔ ولا كتابة في جدول مُجمَّد أو قائم خارج نطاق الموجة.
  for (const frozen of ["project_call_sheets", "project_locations", "crm_opportunities", "crm_companies"]) {
    assert.doesNotMatch(c, new RegExp(`\\balter table public\\.${frozen}\\b`, "i"),
      `🔴 تعديل على جدول قائم خارج النطاق: ${frozen}`);
  }
  assert.match(c, /^\s*begin;/im, "بلا معاملة");
  assert.match(c, /commit;/i, "بلا commit");
  for (const n of ["PREFLIGHT", "POSTCHECK"]) {
    const q = codeOnly(read(P(n)));
    for (const re of [/\bcreate\s+(table|function|index|view)/i, /\balter\s+table/i, /\binsert\s+into/i, /\bdelete\s+from/i, /\bdrop\s+/i]) {
      assert.doesNotMatch(q, re, `🔴 ${n} يكتب`);
    }
  }
});

test("(G-3) ★★ العلم مطفأ ⇒ لا تبويب ولا RPC ولا عمل خلفيّ ★★", () => {
  const center = read("components/portal/crm/CrmCenter.tsx");
  assert.match(center, /\.\.\.\(crmWave4Enabled\(\)/, "🔴 التبويب يظهر ثمّ يُخفى محتواه");
  assert.match(center, /active === "insights" && crmWave4Enabled\(\)/, "المحتوى بلا حارس ثانٍ");
  const lib = read("lib/portal/crm.ts");
  assert.match(lib, /NEXT_PUBLIC_SHOW_CRM_WAVE4 === "true"/, "العلم ليس مقارنة صارمة");
});
