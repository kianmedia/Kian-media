// ════════════════════════════════════════════════════════════════════════════
// tests/wave5_delivery_rights_deemed.test.js
//
// Wave 5 — التسليم والحقوق والموافقة الحكمية.
// V2-5.1 · V2-5.2 · V2-5.3 · V2-5.4 · V2-5.6 · وتدقيقا القراءة.
//
// ⛔ لا SQL يُشغَّل · لا قاعدة · لا شبكة · لا إرسال · لا نقل بيانات.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const read = (r) => fs.readFileSync(path.join(ROOT, r), "utf8");
const has = (r) => fs.existsSync(path.join(ROOT, r));

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
const noComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");

const DR = () => read("docs/wave5_delivery_rights_RUNME.sql");
const DA = () => read("docs/wave5_deemed_approval_RUNME.sql");
const FIN_AUDIT = () => read("docs/sql/wave5_financial_phase_ab_AUDIT_READONLY.sql");
const VER_AUDIT = () => read("docs/sql/wave5_deliverable_versions_AUDIT_READONLY.sql");

const catches = (label, src, mutate, check) => {
  const m = mutate(src);
  assert.notEqual(m, src, `الطفرة لم تغيّر شيئًا: ${label}`);
  let threw = false;
  try { check(m); } catch { threw = true; }
  assert.ok(threw, `🔴 الطفرة لم تُرصد: ${label}`);
};

// ═══ الحزم ══════════════════════════════════════════════════════════════════

test("(P-1) ★★ الحزمتان كاملتان، والتدقيقان موجودان ★★", () => {
  for (const p of ["delivery_rights", "deemed_approval"]) {
    for (const n of ["PREFLIGHT", "RUNME", "POSTCHECK", "ROLLBACK"]) {
      assert.ok(has(`docs/wave5_${p}_${n}.sql`), `wave5_${p}_${n} مفقود`);
    }
  }
  assert.ok(has("docs/sql/wave5_financial_phase_ab_AUDIT_READONLY.sql"), "تدقيق المالية مفقود");
  assert.ok(has("docs/sql/wave5_deliverable_versions_AUDIT_READONLY.sql"), "تدقيق الإصدارات مفقود");
});

// ═══ §3 · تدقيق المالية قراءة فقط ═══════════════════════════════════════════

test("(F-1) ★★★ تدقيق المالية لا يكتب حرفًا ★★★", () => {
  const c = codeOnly(FIN_AUDIT());
  for (const re of [/\binsert\s+into\b/i, /\bupdate\s+\w/i, /\bdelete\s+from\b/i,
                    /\balter\s+/i, /\bcreate\s+/i, /\bdrop\s+/i, /\btruncate\b/i,
                    /\bgrant\s+/i, /\brevoke\s+/i]) {
    assert.doesNotMatch(c, re, "🔴 تدقيق يُفترض أنّه آمن على Production يكتب");
  }
  assert.match(c, /^\s*select/im, "لا استعلامات أصلًا");
});

test("(F-2) ★★★ يفحص التعريفات لا الأسماء — واسمٌ وحده لا يعطي APPLIED ★★★", () => {
  const s = FIN_AUDIT();
  // 🔴 دالّة موجودة بالاسم قد تكون نسخة سبقت الإحكام.
  assert.match(s, /p\.prosecdef/, "🔴 لا يفحص security definer");
  assert.match(s, /p\.proconfig/, "🔴 لا يفحص تثبيت search_path");
  assert.match(s, /p\.prosrc/, "🔴 لا يقرأ جسم الدالّة — فالاسم وحده يكفي للنجاح");
  // التصنيفات الخمسة كلّها موجودة، وUNKNOWN ليس نجاحًا.
  for (const st of ["APPLIED", "PARTIAL", "ABSENT", "DRIFTED", "UNKNOWN"]) {
    assert.ok(s.includes(st), `تصنيف مفقود: ${st}`);
  }
  assert.match(s, /APPLIED requires positive evidence/, "🔴 لا يُعلن أنّ الغياب ليس نجاحًا");
});

test("(F-3) ★★★ يفحص التركيب الجزئيّ والمصدر الموازي والاستنتاج ★★★", () => {
  const s = FIN_AUDIT();
  assert.match(s, /PHASE_COMPOSITION/, "لا فحص لتركيب A/B الجزئيّ");
  assert.match(s, /PARTIAL \(A without B\)/, "🔴 A بلا B لا يُصنَّف PARTIAL");
  assert.match(s, /PARALLEL_SOURCE/, "لا فحص لمصدر ماليّ موازٍ");
  assert.match(s, /PROFIT_INFERENCE/, "لا فحص لاستنتاج الربح");
  assert.match(s, /UNGATED/, "استنتاج بلا بوّابة لا يُعلَم");
  // الصلاحيات — أخطر ما يُفحص.
  assert.match(s, /LEAK/, "🔴 لا يميّز صلاحية anon على جدول ماليّ كتسريب");
  assert.match(s, /RLS/, "لا فحص RLS");
  assert.match(s, /INDEX/, "لا فحص فهارس");
});

test("(F-4) ★★★ حالة Phase B لا تُفبرك في أيّ وثيقة ★★★", () => {
  // 🔴 لم يُشغَّل التدقيق، فلا يجوز أن يدّعي أيّ ملفّ نتيجة.
  for (const f of ["docs/wave-reports/WAVE_5_ENTRY_CONDITIONS.md",
                   "docs/release/RELEASE_SQL_MANIFEST.md"]) {
    if (!has(f)) continue;
    const t = read(f);
    assert.doesNotMatch(t, /Phase B\s*(مطبَّقة|applied|APPLIED)\b/i,
      `🔴 ${f} يدّعي أنّ Phase B مطبَّقة بلا دليل`);
  }
  const e = read("docs/wave-reports/WAVE_5_ENTRY_CONDITIONS.md");
  assert.match(e, /UNVERIFIED|غير قابل للإثبات|MANUAL PRODUCTION VERIFICATION/,
    "الحالة غير معلَنة كـUNVERIFIED");
});

// ═══ §4 · توحيد الإصدارات ═══════════════════════════════════════════════════

test("(V-1) ★★★ الكتابة الجديدة ممنوعة في الجدول المُجمَّد — بحارس على الجدول ★★★", () => {
  const c = codeOnly(DR());
  assert.match(c, /create trigger trg_dv_block_legacy_writes/i, "🔴 لا حارس تجميد");
  assert.match(c, /before insert or update on public\.project_deliverable_versions/i,
    "الحارس ليس على الجدول القديم");
  // 🔴 على الجدول لا داخل RPC: الكتابة المباشرة تلتفّ على أيّ فحص في RPC.
  const fn = noComments(DR()).slice(noComments(DR()).indexOf("function public.dv_block_legacy_writes"));
  assert.match(fn, /if tg_op = 'INSERT' then[\s\S]{0,200}raise exception/,
    "🔴 الإدراج غير ممنوع");
  // ولا كاتب نهائيّ ثانٍ.
  assert.match(fn, /new\.is_final[\s\S]{0,80}old\.is_final[\s\S]{0,200}raise exception/,
    "🔴 يمكن إنشاء نسخة نهائية في النظام القديم");

  catches("حذف منع الإدراج", DR(),
    (m) => m.replace(/if tg_op = 'INSERT' then[\s\S]*?end if;\n/, ""),
    (m) => {
      const f = noComments(m).slice(noComments(m).indexOf("function public.dv_block_legacy_writes"));
      assert.match(f, /if tg_op = 'INSERT' then[\s\S]{0,200}raise exception/);
    });
});

test("(V-2) ★★★ نسخة نهائية واحدة فعّالة لكلّ مخرَج ★★★", () => {
  const c = codeOnly(DR());
  assert.match(c, /create unique index if not exists deliverable_versions_one_final/i,
    "🔴 لا فهرس فريد للنهائيّ");
  assert.match(c, /where is_final = true and is_deleted = false/i,
    "🔴 الفهرس لا يستثني المحذوف ناعمًا — فيمنع نهائيًّا جديدًا بعد إلغاء قديم");
  // وPREFLIGHT يحذّر من مخالفات قائمة قبل أن يفشل الفهرس.
  assert.match(read("docs/wave5_delivery_rights_PREFLIGHT.sql"), /PRE_EXISTING_CONFLICT/,
    "🔴 لا فحص مسبق للمخالفات — التطبيق سيفشل بلا تفسير");
});

test("(V-3) ★★★ العلامة المائية والحذف الناعم وحماية النزاع ★★★", () => {
  const fn = noComments(DR()).slice(noComments(DR()).indexOf("function public.dv_integrity_guard"));
  // لا تجاوز للعلامة المائية على معاينة غير نهائية.
  assert.match(fn, /watermark_required[\s\S]{0,120}raise exception/, "🔴 يمكن تعطيل العلامة المائية");
  // ⛔ لا حذف نهائيّ.
  assert.match(fn, /if tg_op = 'DELETE' then[\s\S]{0,200}raise exception/, "🔴 الحذف النهائيّ ممكن");
  assert.match(fn, /soft-deleted, never removed/i, "لا رسالة تشرح البديل");
  // 🔴 إصدار محلّ نزاع لا يُخفى.
  assert.match(fn, /revision_requested[\s\S]{0,160}raise exception/,
    "🔴 يمكن إخفاء إصدار طُلب تعديله — فيُمحى أثر الاعتراض");

  catches("السماح بالحذف النهائيّ", DR(),
    (m) => m.replace(/if tg_op = 'DELETE' then[\s\S]*?end if;\n/, ""),
    (m) => {
      const f = noComments(m).slice(noComments(m).indexOf("function public.dv_integrity_guard"));
      assert.match(f, /if tg_op = 'DELETE' then[\s\S]{0,200}raise exception/);
    });
});

test("(V-4) ★★★ تدقيق الإصدارات قراءة فقط، ويكشف التعارض النهائيّ ★★★", () => {
  const c = codeOnly(VER_AUDIT());
  for (const re of [/\binsert\s+into\b/i, /\bupdate\s+\w/i, /\bdelete\s+from\b/i,
                    /\balter\s+/i, /\bcreate\s+/i, /\bdrop\s+/i]) {
    assert.doesNotMatch(c, re, "🔴 تدقيق ينقل بيانات أو يكتب");
  }
  const s = VER_AUDIT();
  // كلّ ما طلبه أمر التشغيل.
  for (const k of ["ROW_COUNT", "OVERLAP", "LEGACY_ONLY", "CANONICAL_ONLY",
                   "CONFLICTING_FINAL", "MISSING_WATERMARK_STATE", "MISSING_DECISION_STATE",
                   "IRRECOVERABLE_GAP", "MIGRATION_ELIGIBILITY"]) {
    assert.ok(s.includes(k), `فحص مفقود: ${k}`);
  }
  // 🔴 والأهليّة لا تأمر بترحيل.
  assert.match(s, /MANUAL ONLY/, "لا تصنيف يدويّ للصفوف الخطرة");
  // ⚠️ الجملة مقسومة على سطرَي سلسلة في SQL، فيُطابَق جزء لا يعبر الفاصل.
  assert.match(s, /Nothing here authorises a/i, "🔴 التدقيق يُقرأ كإذن ترحيل");
});

test("(V-5) ★★ الجدول القديم لا يُحذف ولا يُرحَّل في أيّ حزمة ★★", () => {
  for (const f of ["docs/wave5_delivery_rights_RUNME.sql", "docs/wave5_deemed_approval_RUNME.sql"]) {
    const c = codeOnly(read(f));
    assert.doesNotMatch(c, /drop\s+table[^;]*project_deliverable_versions/i, "🔴 حذف الجدول القديم");
    assert.doesNotMatch(c, /delete\s+from\s+public\.project_deliverable_versions/i, "🔴 حذف صفوف قديمة");
    assert.doesNotMatch(c, /insert\s+into\s+public\.deliverable_versions[\s\S]{0,200}from\s+public\.project_deliverable_versions/i,
      "🔴 ترحيل بيانات داخل RUNME");
  }
});

// ═══ V2-5.2 · الحقوق ════════════════════════════════════════════════════════

test("(R-1) ★★★ الإذن التسويقيّ يُمنح ولا يُفترض · والسرّية تتقدّم ★★★", () => {
  const c = codeOnly(DR());
  assert.match(c, /add column if not exists showreel_allowed boolean not null default false/i,
    "🔴 الإذن التسويقيّ مفترض لا ممنوح");
  assert.match(c, /add column if not exists confidential\s+boolean not null default false/i,
    "عمود السرّية مفقود");
  // التناقض ممنوع في القاعدة لا في الواجهة.
  assert.match(c, /check \(not \(confidential = true and showreel_allowed = true\)\)/i,
    "🔴 سرّيّ ومسموح تسويقيًّا معًا ممكن");
  // والعرض يفرض الثلاثة معًا.
  // ⚠️ على noComments لا codeOnly: شرط الحالة سلسلة نصّية ('final_delivered')
  //    وcodeOnly يمحو ما بين علامتي الاقتباس فلا يراه.
  const sv = noComments(DR());
  const v = sv.slice(sv.indexOf("create or replace view public.deliverable_showreel_v"));
  const body = v.slice(0, v.indexOf(";"));
  assert.match(body, /showreel_allowed = true/, "العرض لا يشترط الإذن");
  assert.match(body, /confidential = false/, "🔴 العرض قد يُظهر عملًا سرّيًّا");
  assert.match(body, /final_delivered/, "🔴 العرض قد يُظهر عملًا لم يُسلَّم");
  assert.match(body, /is_final = true and dv\.is_deleted = false/, "العرض لا يشترط نسخة نهائية حيّة");

  catches("إسقاط شرط السرّية من العرض", DR(),
    (m) => m.replace("  and d.confidential = false          -- ⛔ السرّية تتقدّم\n", ""),
    (m) => {
      const cc = noComments(m);
      const vv = cc.slice(cc.indexOf("create or replace view public.deliverable_showreel_v"));
      assert.match(vv.slice(0, vv.indexOf(";")), /confidential = false/);
    });
});

// ═══ V2-5.3 · روابط التسليم ═════════════════════════════════════════════════

test("(L-1) ★★ الرباعية مكتملة: رمز مهشَّم · انتهاء · عدّاد · إلغاء ★★", () => {
  const s = noComments(DR());
  assert.match(s, /token_hash\s+text not null unique check \(token_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/,
    "🔴 لا بصمة بقيد شكل");
  assert.ok(!/\btoken\s+text\b|token_raw|raw_token/.test(
    s.slice(s.indexOf("create table if not exists public.delivery_share_links"),
            s.indexOf("create index if not exists dsl_project_idx"))),
    "🔴 عمود للرمز الخامّ");
  assert.match(s, /expires_at\s+timestamptz not null/, "🔴 رابط بلا انتهاء ممكن");
  assert.match(s, /opens_used\s+integer not null default 0/, "لا عدّاد");
  assert.match(s, /dsl_revoked_pair/, "إلغاء بلا سبب مكتوب");
  assert.match(codeOnly(DR()), /revoke all on public\.delivery_share_links from anon, public/,
    "🔴 الجدول بلا REVOKE");
  // ⛔ ولا نظام روابط ثانٍ.
  assert.doesNotMatch(codeOnly(DR()), /create table[^;]*\bshare_links\b(?!.*delivery)/i, "نظام روابط موازٍ");
});

// ═══ V2-5.6 · قدرات العميل ══════════════════════════════════════════════════

test("(C-1) ★★★ لا نموذج أدوار موازٍ · والقدرة تُفرض في القاعدة ★★★", () => {
  const c = codeOnly(DR());
  // ⛔ لا جدول أدوار جديد ولا قيمة دور جديدة.
  assert.doesNotMatch(c, /create\s+table[^;]*(client_roles|project_client_roles|delivery_roles)/i,
    "🔴 نموذج أدوار موازٍ");
  assert.doesNotMatch(c, /alter table public\.project_member_roles/i,
    "🔴 تعديل قيد الأدوار القائم — مفردات جديدة");
  // القدرتان تقرآن الأدوار القائمة.
  for (const f of ["pc_client_can_approve", "pc_client_can_view"]) {
    assert.match(c, new RegExp(`create or replace function public\\.${f}`), `${f} مفقودة`);
    assert.match(c, new RegExp(`revoke all on function public\\.${f}`), `${f} بلا REVOKE`);
  }
  // ⚠️ محدود بجسم الدالّة: شريحة مفتوحة إلى نهاية الملفّ تلتقط حارس الدالّة
  //    التالية (pc_client_can_view) فتمرّ رغم حذف الحارس من هذه.
  const bodyOf = (src, name) => {
    const t = noComments(src);
    const i = t.indexOf(`function public.${name}`);
    return t.slice(i, t.indexOf("$$;", i));
  };
  const fn = bodyOf(DR(), "pc_client_can_approve");
  assert.match(fn, /project_member_roles/, "🔴 لا تقرأ الأدوار القائمة");
  assert.match(fn, /project_role = 'approver'/, "🔴 لا تشترط دور المعتمِد");
  // 🔴 NULL لا يمرّ.
  assert.match(fn, /if v_user is null or p_project is null then return false; end if;/,
    "🔴 مستدعٍ بلا هويّة قد يمرّ (NULL-collapse)");

  catches("إسقاط حارس NULL", DR(),
    // يُحذف الحارس من دالّة الاعتماد وحدها (أوّل ورود).
    (m) => m.replace("  if v_user is null or p_project is null then return false; end if;\n", ""),
    (m) => assert.match(bodyOf(m, "pc_client_can_approve"),
                        /if v_user is null or p_project is null then return false; end if;/));
});

// ═══ V2-5.4 · الموافقة الحكمية ══════════════════════════════════════════════

test("(D-1) ★★★ الافتراض OFF · لكلّ مشروع · ولا تفعيل عامّ ★★★", () => {
  const c = codeOnly(DA());
  assert.match(c, /enabled\s+boolean not null default false/i, "🔴 الافتراض ليس OFF");
  assert.match(c, /project_id\s+uuid primary key references public\.projects/i,
    "🔴 ليست لكلّ مشروع");
  // ⛔ لا مفتاح عامّ.
  for (const g of ["global_enabled", "all_projects", "enabled_globally", "system_wide"]) {
    assert.ok(!c.includes(g), `🔴 تفعيل عامّ ممكن: ${g}`);
  }
  // ⛔ ولا سجلّ تدقيق ثانٍ — يُكتب في القائم.
  assert.doesNotMatch(c, /create\s+table[^;]*deemed[a-z_]*audit/i, "🔴 سجلّ تدقيق موازٍ");
  assert.match(c, /log_activity/, "🔴 لا يُكتب في سجلّ التدقيق القائم");
});

test("(D-2) ★★★ التفعيل يوجب بندًا موقَّعًا ومهلة وبداية سريان ★★★", () => {
  const s = noComments(DA());
  const con = s.slice(s.indexOf("constraint deemed_requires_contract"), s.indexOf("constraint deemed_requires_contract") + 420);
  for (const req of ["clause_text", "contract_reference", "signed_contract_evidence",
                     "notice_period_days", "effective_from"]) {
    assert.ok(con.includes(req), `🔴 التفعيل لا يوجب: ${req}`);
  }
  assert.match(con, /enabled = false or/, "🔴 القيد لا يستثني الحالة المعطَّلة");

  catches("تفعيل بلا عقد", DA(),
    (m) => m.replace(/constraint deemed_requires_contract check \([\s\S]*?\)\)\n\);/, ")\n);"),
    (m) => {
      const ss = noComments(m);
      assert.ok(ss.includes("constraint deemed_requires_contract"));
    });
});

test("(D-3) ★★★ لا اعتماد صامت · ولا أثر رجعيّ ★★★", () => {
  const s = noComments(DA());
  const fn = s.slice(s.indexOf("function public.deemed_approval_evaluate"),
                     s.indexOf("$$;", s.indexOf("function public.deemed_approval_evaluate")));
  // 🔴 تُقيّم ولا تعتمد: لا كتابة قرار في الإصدار.
  assert.doesNotMatch(fn, /update\s+public\.deliverable_versions/i,
    "🔴 التقييم يعتمد الإصدار — اعتماد صامت");
  assert.match(fn, /stable/, "الدالّة ليست stable — قد تكتب");
  assert.match(fn, /'requires_human_action', true/, "🔴 لا إعلان بأنّ الاعتماد فعل بشريّ");
  // 🔴 لا أثر رجعيّ.
  assert.match(fn, /uploaded_at < c\.effective_from/, "🔴 يُقيَّم تسليم سبق البند");
  assert.match(fn, /predates_clause_effective_date/, "لا رفض صريح للأثر الرجعيّ");
  // والسريان لا يسبق الآن عند الضبط.
  const set = s.slice(s.indexOf("function public.deemed_approval_set"));
  assert.match(set, /greatest\(now\(\)/, "🔴 يمكن ضبط سريان في الماضي");
});

test("(D-4) ★★★ فشل الإشعار يمنع بدء المهلة · والاعتراض يوقف الاعتماد ★★★", () => {
  const s = noComments(DA());
  const fn = s.slice(s.indexOf("function public.deemed_approval_evaluate"),
                     s.indexOf("$$;", s.indexOf("function public.deemed_approval_evaluate")));
  // 🔴 إشعار ناجح موثَّق شرط.
  assert.match(fn, /outcome = 'delivered' and delivered_at is not null/,
    "🔴 المهلة تبدأ بلا إشعار ناجح");
  assert.match(fn, /no_successful_delivery_notice/, "لا رفض صريح");
  assert.match(fn, /later_notification_failure/, "🔴 فشل لاحق لا يوقف المهلة");
  // 🔴 المهلة من لحظة وصول الإشعار لا من رفع الإصدار.
  assert.match(fn, /v_notice\.delivered_at \+ make_interval/,
    "🔴 المهلة تُحسب من رفع الإصدار — أي قبل أن يعلم العميل");
  assert.match(fn, /notice_period_not_elapsed/, "لا فحص انقضاء المهلة");
  // 🔴 المتنازَع عليه لا يُعتمد، ونشاط العميل يوقف.
  assert.match(fn, /revision_requested/, "🔴 المتنازَع عليه قد يُعتمد صمتًا");
  assert.match(fn, /client_activity_after_notice/, "🔴 نشاط العميل لا يوقف الاعتماد");
  // والإشعار الناجح يوجب دليلًا.
  assert.match(s, /deemed_notice_delivered_pair/, "🔴 إشعار «ناجح» بلا دليل ممكن");

  catches("حساب المهلة من رفع الإصدار", DA(),
    (m) => m.replace("v_due := v_notice.delivered_at + make_interval(days => c.notice_period_days);",
                     "v_due := v.uploaded_at + make_interval(days => c.notice_period_days);"),
    (m) => {
      const f = noComments(m);
      assert.match(f.slice(f.indexOf("function public.deemed_approval_evaluate")),
                   /v_notice\.delivered_at \+ make_interval/);
    });
  catches("السماح باعتماد المتنازَع عليه", DA(),
    (m) => m.replace(/if v\.decision = 'revision_requested' then[\s\S]*?end if;\n/, ""),
    (m) => {
      const f = noComments(m);
      assert.match(f.slice(f.indexOf("function public.deemed_approval_evaluate")), /revision_requested/);
    });
});

// ═══ الأمن العامّ ═══════════════════════════════════════════════════════════

test("(G-1) ★★★ كلّ دالّة محصَّنة · لا شيء لـanon · RLS deny-by-default ★★★", () => {
  for (const [name, src] of [["delivery_rights", DR()], ["deemed_approval", DA()]]) {
    const c = codeOnly(src);
    const defs = (c.match(/security\s+definer/gi) || []).length;
    const paths = (c.match(/set\s+search_path\s*=\s*public/gi) || []).length;
    assert.equal(defs, paths, `🔴 ${name}: ${defs - paths} دالّة بلا search_path مثبَّت`);
    assert.doesNotMatch(c, /grant\s+all\b/i, `🔴 ${name}: منح شامل`);
    // 🔴 مجموعة مثبَّتة لا نفي مطلق: `delivery_link_check` ممنوحة لـanon عمدًا
    //    (رابط تسليم يُفتح بلا جلسة، والرمز هو بيان الاعتماد). وأيّ اسم آخر
    //    يظهر هنا هو توسيع صامت لسطح عامّ.
    const ANON_ALLOWED = { delivery_rights: ["delivery_link_check"], deemed_approval: [] };
    const granted = [...c.matchAll(/grant execute on function public\.([a-z0-9_]+)\([^)]*\)\s+to\s+([^;]+);/gi)]
      .filter((g) => /\banon\b/.test(g[2])).map((g) => g[1]).sort();
    assert.deepEqual(granted, ANON_ALLOWED[name],
      `🔴 ${name}: anon يملك [${granted.join(", ")}] بدل [${ANON_ALLOWED[name].join(", ")}]`);
    assert.match(c, /enable row level security/i, `🔴 ${name}: بلا RLS`);
    assert.doesNotMatch(c, /create policy[^;]*for\s+(insert|update|delete)/i,
      `🔴 ${name}: سياسة كتابة تتجاوز الدوالّ`);
    // إضافيّ: لا حذف.
    for (const re of [/drop\s+table/i, /truncate/i]) {
      assert.doesNotMatch(c, re, `🔴 ${name}: يحذف`);
    }
    // ولا استبدال مُشغِّل صامت: كلّ trigger يُسقَط باسمه قبل إنشائه.
    for (const m of c.matchAll(/create trigger (\w+)/gi)) {
      assert.match(c, new RegExp(`drop trigger if exists ${m[1]}`, "i"),
        `🔴 ${name}: المُشغِّل ${m[1]} يُستبدَل صامتًا`);
    }
  }
});

test("(L-2) ★★★ التحقّق العامّ: حارس قبل SELECT · ردّ موحَّد · وبوّابة السداد تُحترم ★★★", () => {
  const t = noComments(DR());
  const i = t.indexOf("function public.delivery_link_check");
  const fn = t.slice(i, t.indexOf("$$;", i));
  const pre = fn.slice(0, fn.indexOf("select * into r"));
  assert.match(pre, /p_token_hash is null/, "🔴 لا رفض صريح لـNULL");
  assert.match(pre, /length\(p_token_hash\) <> 64/, "لا فحص طول");
  assert.match(pre, /\^\[0-9a-f\]\{64\}\$/, "لا فحص شكل");
  assert.match(fn, /where token_hash = p_token_hash/, "المطابقة ليست تامّة");
  // ⛔ ردّ واحد لكلّ رفض — لا سبب يميّز وجود مشروع.
  for (const r of [...fn.matchAll(/jsonb_build_object\('ok', false[^)]*\)/g)].map((m) => m[0])) {
    assert.equal(r, "jsonb_build_object('ok', false)", `🔴 رفض يحمل سببًا: ${r}`);
  }
  // 🔴 والرابط لا يلتفّ على بوّابة السداد القائمة.
  assert.match(fn, /pc_release_window_ok/, "🔴 الرابط يتجاوز بوّابة السداد");
  // والعدّاد يُزاد فعلًا — سقف لا يُحسب ليس سقفًا.
  assert.match(fn, /opens_used = opens_used \+ 1/, "🔴 العدّاد لا يُزاد");

  catches("تجاوز بوّابة السداد", DR(),
    (m) => m.replace(/  if to_regproc\('public\.pc_release_window_ok\(uuid\)'\) is not null then[\s\S]*?  end if;\n/, ""),
    (m) => {
      const tt = noComments(m); const j = tt.indexOf("function public.delivery_link_check");
      assert.match(tt.slice(j, tt.indexOf("$$;", j)), /pc_release_window_ok/);
    });
});

test("(G-2) ★★ PREFLIGHT/POSTCHECK لا يكتبان · وRUNME معاملة واحدة ★★", () => {
  for (const p of ["delivery_rights", "deemed_approval"]) {
    for (const n of ["PREFLIGHT", "POSTCHECK"]) {
      const c = codeOnly(read(`docs/wave5_${p}_${n}.sql`));
      for (const re of [/\bcreate\s+(table|function|index|view|trigger)/i, /\balter\s+table/i,
                        /\binsert\s+into/i, /\bdelete\s+from/i, /\bdrop\s+/i]) {
        assert.doesNotMatch(c, re, `🔴 wave5_${p}_${n} يكتب`);
      }
    }
    assert.match(codeOnly(read(`docs/wave5_${p}_RUNME.sql`)), /^\s*begin;/im, `${p}: بلا معاملة`);
  }
});

test("(G-3) ★★★ لا بند ماليّ في أيّ حزمة من Wave 5 ★★★", () => {
  // 🔴 W5-2 غير محسوم ⇒ «بدونه لا يُلمس أيّ بند ماليّ».
  for (const [name, src] of [["delivery_rights", DR()], ["deemed_approval", DA()]]) {
    const c = codeOnly(src);
    for (const t of ["fin_payment_milestones", "fin_collections", "fin_receivables",
                     "fin_revenue", "fin_costs", "pc_project_financials"]) {
      assert.ok(!c.includes(t), `🔴 ${name} يلمس المالية: ${t} — وW5-2 غير محسوم`);
    }
    for (const w of ["margin", "profit", "invoice_total"]) {
      assert.ok(!c.includes(w), `🔴 ${name} يحسب ${w}`);
    }
  }
});
