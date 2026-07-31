// ════════════════════════════════════════════════════════════════════════════
// tests/finance_profit_inference_sweep.test.js
//
// السؤال: هل يستطيع **غير المالك** أن يجمع رقمين — أو يستعمل مِجَسًّا — فيشتقّ
// (إيراد − تكلفة) أو هامشًا أو أرضية سعر أو أجر مورّد/طاقم أو ربحًا تقديريًّا؟
//
// المنهج — ولماذا هو هكذا:
//   • **تعداد شامل**: تُستخرج كلّ دالّة تُمنح EXECUTE لـauthenticated من كلّ
//     ملفّ docs/*.sql، بما فيها المنح الديناميّة داخل حلقات foreach، وتُطرح منها
//     المُسحوبات الصريحة. الاعتماد على «قائمة أسماء مشبوهة» أنتج في هذا
//     المستودع نجاحًا كاذبًا من قبل: قائمةُ مسحٍ بدت قائمةَ سماحٍ وليست كذلك.
//   • **المصادر لا الأعمدة**: الفحص يبدأ من الجداول والمحرّكات التي تحمل طرفًا
//     من المعادلة (fin_costs · fin_revenue · sq_quote_internal · محرّكات الربح)
//     لا من قائمة أسماء أعمدة يمكن أن يُضاف إليها عمود جديد بصمت.
//   • **مِجَسّ لا رقم**: تُفحص أيضًا الدوالّ التي لا تُخرج الرقم لكنّها تُخرج
//     مقارنةً به (ضمن النطاق/فوق النطاق) — تلك تُشتقّ بالبحث الثنائيّ.
//
// ⚠️ ما لا يدّعيه: لا جلسة PostgREST حيّة هنا. لم تُختبر RLS فعليًّا. المُختبَر
//    هو المنح والبوّابات المكتوبة في حزم الـSQL.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const DOCS = path.resolve(__dirname, "..", "docs");
// ⚠️ تُستبعَد ملفّات التراجع والمقترحات: ROLLBACK يسحب كلّ شيء من authenticated،
//    فخلطه بحالة التطبيق يجعل كلّ دالّة تبدو مسحوبة — نجاحٌ كاذبٌ كامل.
//    (هذا بالضبط ما أعطى قراءةً أولى خاطئة في هذه الجلسة.)
const EXCLUDED = /_(ROLLBACK|PROPOSAL)\.sql$/i;
const FILES = fs.readdirSync(DOCS).filter((f) => f.endsWith(".sql") && !EXCLUDED.test(f));

// ─── تعداد المنح ────────────────────────────────────────────────────────────
const grantedTo = new Map();      // fn -> Set(file)
const revokedFromAuth = new Set();
const bodies = new Map();         // fn -> {file, raw}
const catchAll = [];

function addGrant(name, file) {
  const n = name.trim().toLowerCase().replace(/^public\./, "").replace(/"/g, "");
  if (!n) return;
  if (!grantedTo.has(n)) grantedTo.set(n, new Set());
  grantedTo.get(n).add(file);
}

for (const f of FILES) {
  const src = fs.readFileSync(path.join(DOCS, f), "utf8");

  for (const m of src.matchAll(/grant\s+execute\s+on\s+all\s+functions[\s\S]{0,160}?to\s+([a-z_,\s"]+);/gi)) {
    if (/\b(authenticated|anon|public)\b/i.test(m[1])) catchAll.push(`${f}: ${m[0].slice(0, 120)}`);
  }
  for (const m of src.matchAll(/grant\s+execute\s+on\s+function\s+([a-z0-9_."]+)\s*\(([\s\S]*?)\)\s*to\s+([a-z_,\s"]+);/gi)) {
    if (/\bauthenticated\b/i.test(m[3])) addGrant(m[1], f);
  }
  for (const m of src.matchAll(/grant\s+execute\s+on\s+function\s+([a-z0-9_.]+)\s+to\s+([a-z_,\s]+);/gi)) {
    if (/\bauthenticated\b/i.test(m[2])) addGrant(m[1], f);
  }
  // منح/سحب ديناميّ: foreach v in array array[...] loop … end loop;
  for (const m of src.matchAll(/foreach\s+[a-z_][a-z0-9_]*\s+in\s+array\s+([\s\S]*?)\s+loop([\s\S]*?)end\s+loop\s*;/gi)) {
    // الصيغ المستعملة فعلًا في المستودع: %s و public.%s و %I — كلّها تُلتقط.
    const grants = /grant\s+execute\s+on\s+function\s+(public\.)?%[sI][\s\S]{0,40}?to\s+authenticated/i.test(m[2]);
    const revokes = /revoke\s+(all|execute)\s+on\s+function\s+(public\.)?%[sI][\s\S]{0,40}?from\s+authenticated/i.test(m[2]);
    for (const q of m[1].matchAll(/'([a-z0-9_.]+)\s*\(([^)]*)\)'/gi)) {
      const n = q[1].toLowerCase().replace(/^public\./, "");
      if (revokes) revokedFromAuth.add(n);
      else if (grants) addGrant(n, `${f} [loop]`);
    }
  }

  // أجسام الدوالّ — مسحٌ لا يعتمد [^)]*
  const head = /create\s+or\s+replace\s+function\s+public\.([a-z0-9_]+)\s*\(/gi;
  let h;
  while ((h = head.exec(src)) !== null) {
    const open = src.indexOf("$$", h.index);
    if (open < 0) continue;
    const close = src.indexOf("$$", open + 2);
    if (close < 0) continue;
    bodies.set(h[1].toLowerCase(), { file: f, raw: src.slice(open + 2, close) });
  }
}
for (const r of revokedFromAuth) grantedTo.delete(r);
const AUTHED = [...grantedTo.keys()].sort();

const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ").toLowerCase();
const body = (n) => (bodies.has(n) ? strip(bodies.get(n).raw) : null);
const has = (b, t) => new RegExp(`\\b${t}\\b`).test(b);

// ─── المصادر: كائنات تحمل طرفًا من معادلة (إيراد − تكلفة) ──────────────────
const FIN_TABLES = ["fin_costs", "fin_budgets", "fin_budget_lines", "fin_suppliers",
  "fin_purchase_orders", "fin_purchase_order_items", "fin_contracts", "fin_revenue",
  "fin_retainers", "fin_receivables", "fin_collections", "fin_payment_milestones",
  "fin_expense_requests", "fin_purchase_requests", "fin_cost_centers", "fin_approval_thresholds",
  "fin_expense_approvals", "fin_purchase_request_items", "fin_attachments", "fin_audit",
  "fin_zoho_outbox", "fin_expense_categories"];
const PROFIT_ENGINES = ["finops_profit_core", "finops_variance_core"];
const OWNER_DESCENDING = ["is_owner", "finops_can_view_finance_sensitive", "finops_can_manage_finance",
  "finops_can_manage_suppliers", "finops_can_view_profit", "finops_can_export_sensitive",
  "sq_can_view_cost", "crm_is_owner_role", "tvn_is_owner"];

// ════════════════════════════════════════════════════════════════════════════
test("تعداد كلّ ما يُمنح لـauthenticated (لا قائمة أسماء مشبوهة)", async (t) => {
  await t.test("★ لا-فراغ ★ التعداد ليس فارغًا ولا ضئيلًا", () => {
    assert.ok(AUTHED.length > 500, `التعداد وجد ${AUTHED.length} دالّة فقط — المستخرِج مكسور`);
    assert.ok(bodies.size > 1000, `أجسام مُحلَّلة: ${bodies.size} — المحلّل مكسور`);
  });
  await t.test("★ لا-فراغ ★ التعداد يرى فعلًا حزمة المالية", () => {
    for (const n of ["finops_dashboard", "finops_costs_list", "finops_export", "finops_collections_list"]) {
      assert.ok(AUTHED.includes(n), `${n} غائبة عن التعداد`);
    }
  });
  await t.test("لا منح شامل (grant execute on all functions) لأيّ دور متصفّح", () => {
    assert.deepEqual(catchAll, [], `منح شامل موجود:\n${catchAll.join("\n")}`);
  });
  await t.test("محرّكا الربح والانحراف مسحوبان من authenticated صراحةً", () => {
    for (const e of PROFIT_ENGINES) {
      assert.ok(revokedFromAuth.has(e), `${e} غير مسحوب`);
      assert.ok(!AUTHED.includes(e), `${e} ما زال ممنوحًا لـauthenticated — تسريب هامش مباشر`);
    }
    for (const e of ["finops_receivable_state", "finops_contract_state", "finops_threshold_for",
      "finops_money", "finops_log", "finops_next_code", "finops_project_label"]) {
      assert.ok(!AUTHED.includes(e), `${e} ممنوحة لـauthenticated — تجاوز للتدقيق أو للبوّابة`);
    }
  });
  await t.test("عزل التقارير التنفيذية: محرّك الأرقام مسحوب، والسطح مُقنَّع بالمالك", () => {
    // المحرّكات التي تقرأ المصادر وتبني الأرقام لا تُمنح لأحد.
    for (const e of ["mgmt_compute", "mgmt_alerts_from", "mgmt_read_jsonb", "mgmt_kpi",
      "mgmt_departments", "mgmt_norm_filters", "mgmt_source_installed"]) {
      assert.ok(!AUTHED.includes(e), `${e} ممنوحة لـauthenticated — قراءة المصادر خارج بوّابة اللوحة`);
    }
    // السطح المسموح موجود، وبوّابة الحسّاس فيه للمالك حرفيًّا.
    for (const e of ["mgmt_dashboard", "mgmt_sources", "mgmt_export"]) {
      assert.ok(AUTHED.includes(e), `${e} غير ممنوحة — السطح التنفيذيّ مفقود`);
    }
    const sens = body("mgmt_can_view_sensitive");
    assert.ok(sens && has(sens, "is_owner") && has(sens, "is_staff"),
      "بوّابة الحسّاس التنفيذيّ ليست للمالك");
    const dash = body("mgmt_dashboard");
    assert.ok(has(dash, "mgmt_can_view_sensitive"), "اللوحة التنفيذية لا تُقنّع الحسّاس");
    // الذاكرة المؤقّتة مفتاحها يحمل حالة الحسّاس، فلا تُسلَّم حمولة مالك لغيره.
    assert.ok(/sensitive_view/.test(dash), "ذاكرة اللوحة لا تفصل حمولة المالك عن غيره");
    // ولا تقرأ التقارير جدولًا ماليًّا مباشرةً — تركيبٌ عبر البوّابة لا التفاف.
    for (const e of ["mgmt_dashboard", "mgmt_sources", "mgmt_export"]) {
      const b = body(e);
      for (const tb of FIN_TABLES) assert.ok(!has(b, tb), `${e} تقرأ ${tb} مباشرةً`);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
test("كلّ دالّة ممنوحة تلمس جدولًا ماليًّا محكومة بالبوّابة الحسّاسة", async (t) => {
  const touching = AUTHED.filter((n) => {
    const b = body(n);
    return b && (FIN_TABLES.some((tb) => has(b, tb)) || PROFIT_ENGINES.some((e) => has(b, e)));
  });

  await t.test("★ لا-فراغ ★ المسح وجد دوالّ تلمس المالية", () => {
    assert.ok(touching.length >= 20, `لمست ${touching.length} فقط — المسح أجوف`);
  });

  // ★ الأبواب الجانبية إلى المالية — مجموعة مثبَّتة بأسبابها ★
  // كلّ دالّة هنا SECURITY DEFINER تتجاوز RLS المالية، فوجودها قرار لا صدفة.
  const SIDE_DOORS = {
    // مِجَسّ توفّر فقط: to_regclass(...) is not null. لا صفّ ولا عمود.
    lsr_access: { probe_only: true },
    // مرجع ذمّة للقراءة (رقم الفاتورة · الحالة · الاستحقاق · المستحقّ) بلا أيّ
    // طرف تكلفة. بوّابته lsr_is_sales_manager — أي **ليست** بوّابة المالية.
    // ⚠️ فتحة حوكمة معروفة خارج هذه الدفعة: باب ثانٍ إلى fin_receivables لا
    //    يملكه الموديول المالي. مثبَّت هنا كي لا يتوسّع بصمت.
    lsr_finance_reference: { probe_only: false },
  };
  await t.test("الأبواب الجانبية إلى المالية مجموعة مثبَّتة لا تنمو بصمت", () => {
    const foreign = touching.filter((n) => !n.startsWith("finops_")).sort();
    assert.deepEqual(foreign, Object.keys(SIDE_DOORS).sort(),
      `تغيّرت مجموعة الأبواب الجانبية إلى جداول fin_*: ${foreign.join(", ")}`);
  });
  await t.test("الباب الجانبيّ لا يقرأ طرف التكلفة ولا يبلغ محرّك ربح", () => {
    const COLLECTIONS_SIDE = ["fin_receivables", "fin_collections"];
    for (const n of Object.keys(SIDE_DOORS)) {
      const b = body(n);
      assert.ok(b, `${n} غير موجودة`);
      const seen = FIN_TABLES.filter((tb) => has(b, tb));
      for (const s of seen) {
        assert.ok(COLLECTIONS_SIDE.includes(s), `${n} تقرأ ${s} — طرف التكلفة عبر باب جانبيّ`);
      }
      for (const e of PROFIT_ENGINES) assert.ok(!has(b, e), `${n} تبلغ ${e}`);
      // ولا عمود تكلفة/هامش يخرج منها.
      for (const c of ["cost", "margin", "profit", "min_price", "supplier_rate"]) {
        assert.ok(!new RegExp(`'[a-z_]*${c}[a-z_]*'\\s*,`).test(b) || n === "lsr_access",
          `${n} تُخرج مفتاحًا يحمل ${c}`);
      }
    }
    // lsr_access مِجَسّ توفّر فقط: يذكر الجدول ولا يقرأ منه صفًّا.
    assert.ok(/to_regclass\('public\.fin_receivables'\)/.test(body("lsr_access")));
    assert.ok(!/from\s+public\.fin_/.test(body("lsr_access")), "lsr_access تقرأ صفًّا");
  });

  await t.test("كلّ واحدة تحمل بوّابةً تنحدر إلى المالك", () => {
    const open = [];
    for (const n of touching) {
      if (n in SIDE_DOORS) continue;               // مُثبَّتة أعلاه بأسبابها
      const b = body(n);
      // سطح التحصيل استثناء مُعلَن: بوّابته التحصيل، وجداوله المسموحة اثنان.
      if (n === "finops_collections_list" || n === "finops_collections_summary") continue;
      if (n === "finops_collection_record") continue;
      // طلبات الموظّف: صفّه هو، بمُسنَد الطلب.
      if (n === "finops_my_requests" || n === "finops_expense_request_submit"
        || n === "finops_purchase_request_submit" || n === "finops_request_lookups") continue;
      // بوّابة الاعتماد ترى مبلغ الطلب الذي تعتمده وحده.
      if (n === "finops_expense_decide" || n === "finops_purchase_decide"
        || n === "finops_expense_second_approve" || n === "finops_attachment_add") continue;
      if (n === "finops_access" || n === "finops_audit_list" || n === "finops_zoho_diagnostic"
        || n === "finops_zoho_outbox_enqueue" || n === "finops_zoho_outbox_replay") continue;
      if (!OWNER_DESCENDING.some((g) => has(b, g))) open.push(n);
    }
    assert.deepEqual(open, [], `دوالّ مالية بلا بوّابة مالك: ${open.join(", ")}`);
  });

  await t.test("★ لا-فراغ ★ الفحص يسقط لو أُضيف جدول تكلفة إلى سطح غير محميّ", () => {
    // مِرآة الفحص نفسه على جسم مُطفَّر: لو مرّ هذا لكان الفحص أعلاه بلا معنى.
    const mutated = "\n  select 1 from public.fin_costs;\n";
    const b = strip(mutated);
    assert.ok(FIN_TABLES.some((tb) => has(b, tb)), "كاشف الجداول لا يرى fin_costs");
    assert.ok(!OWNER_DESCENDING.some((g) => has(b, g)), "كاشف البوّابات يرى بوّابةً غير موجودة");
  });
});

// ════════════════════════════════════════════════════════════════════════════
test("عزل التحصيل: لا يجتمع لدور التحصيل طرفا الطرح", async (t) => {
  const listB = body("finops_collections_list");
  const sumB = body("finops_collections_summary");
  const stateB = body("finops_receivable_state");
  assert.ok(listB && sumB && stateB);

  const ALLOWED = ["fin_receivables", "fin_collections"];
  await t.test("الإغلاق الكامل لسطح التحصيل لا يلمس إلّا الجدولين المسموحين", () => {
    for (const b of [listB, sumB, stateB]) {
      const seen = FIN_TABLES.filter((tb) => has(b, tb));
      assert.ok(seen.length > 0 || b === sumB, "لم يُلمس جدول — الكاشف أجوف");
      for (const s of seen) assert.ok(ALLOWED.includes(s), `سطح التحصيل يقرأ ${s}`);
    }
  });
  await t.test("لا محرّك ربح ولا انحراف ولا حالة عقد على طريق التحصيل", () => {
    for (const b of [listB, sumB, stateB]) {
      for (const e of [...PROFIT_ENGINES, "finops_contract_state"]) {
        assert.ok(!has(b, e), `سطح التحصيل يبلغ ${e}`);
      }
    }
  });
  await t.test("★ لا-فراغ ★ لو قرأ سطح التحصيل fin_costs لسقط الفحص", () => {
    const mutated = strip(listB + "\n select amount_net from public.fin_costs;\n");
    const seen = FIN_TABLES.filter((tb) => has(mutated, tb));
    assert.ok(seen.includes("fin_costs"), "الكاشف لا يرى الطفرة");
    assert.ok(!seen.every((s) => ALLOWED.includes(s)), "الطفرة مرّت — الفحص أعلاه بلا معنى");
  });
  await t.test("مِفتاحا التحصيل لا يفتحان أيّ سطح تكلفة", () => {
    for (const n of AUTHED) {
      const b = body(n);
      if (!b) continue;
      if (!has(b, "finops_can_view_collections") && !has(b, "finops_can_record_collection")) continue;
      // finops_access مِجَسّ يعلن القدرات ولا يقرأ صفًّا.
      if (n === "finops_access") continue;
      // finops_attachment_add: فرع التحصيل فيه مقيَّد بنوع كيان 'collection'
      // وبصفّ سجّله المُنادي نفسه؛ ولا يعيد رقمًا. يُفحص شرطه هنا لا يُستثنى.
      if (n === "finops_attachment_add") {
        assert.ok(/v_type\s*=\s*'collection'/.test(b), "فرع التحصيل غير مقيَّد بنوع الكيان");
        assert.ok(/recorded_by\s*=\s*auth\.uid\(\)/.test(b), "فرع التحصيل غير مقيَّد بصفّ المُنادي");
        assert.ok(!PROFIT_ENGINES.some((e) => has(b, e)), "يبلغ محرّك ربح");
        continue;
      }
      const cost = FIN_TABLES.filter((tb) => has(b, tb)).filter((s) => !ALLOWED.includes(s));
      const engines = PROFIT_ENGINES.filter((e) => has(b, e));
      assert.deepEqual([...cost, ...engines], [],
        `${n} تعترف ببوّابة التحصيل وتلمس ${[...cost, ...engines].join(", ")}`);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
test("عزل التصدير", async (t) => {
  const exp = body("finops_export");
  await t.test("بوّابتان مستقلّتان داخل دالّة التصدير", () => {
    assert.ok(has(exp, "finops_can_export_sensitive"), "التصدير الشامل بلا بوّابته");
    assert.ok(has(exp, "finops_can_export_collections"), "تصدير التحصيل بلا مفتاحه");
  });
  await t.test("لا دالّة أخرى ممنوحة تُصدّر جدولًا ماليًّا", () => {
    const exporters = AUTHED.filter((n) => {
      const b = body(n);
      return b && n !== "finops_export" && /\bcsv\b|export/.test(n)
        && FIN_TABLES.some((tb) => has(b, tb));
    });
    assert.deepEqual(exporters, [], `مصدِّرون آخرون: ${exporters.join(", ")}`);
  });
  await t.test("التصدير مُدقَّق ويرفض مجموعة غير معروفة (لا SQL حرّ)", () => {
    assert.ok(has(exp, "finops_log"), "التصدير غير مُدقَّق");
    assert.ok(exp.includes("unknown_dataset"), "التصدير يقبل مجموعة غير معروفة");
  });
});

// ════════════════════════════════════════════════════════════════════════════
test("أسطح التكلفة خارج الموديول المالي — كلّ واحد ببوّابته المسمّاة", async (t) => {
  await t.test("التسعير الذكيّ: التكلفة والهامش والأرضية للمالك وحده", () => {
    const gate = body("sq_can_view_cost");
    assert.ok(gate && has(gate, "is_owner") && has(gate, "is_staff"),
      "sq_can_view_cost ليست للمالك");
    for (const n of ["sq_quote_internal_detail", "sq_quotes_list_internal",
      "sq_owner_dashboard", "sq_approvals_list_internal"]) {
      const b = body(n);
      assert.ok(b, `${n} غير موجودة`);
      assert.ok(has(b, "sq_can_view_cost"), `${n} تكشف التكلفة بلا بوّابة المالك`);
    }
  });
  await t.test("التسعير الذكيّ: طلب الاعتماد ليس دالّةً في الأرضية (لا مِجَسّ)", () => {
    // لو كان «هل يحتاج اعتماد المالك؟» = (السعر < min_price) لأمكن استخراج
    // الأرضية بالبحث الثنائيّ. المستودع يعدّ المِجَسّات (floor_probe_count).
    const runme = fs.readFileSync(path.join(DOCS, "smart_quoting_RUNME.sql"), "utf8");
    assert.ok(runme.includes("floor_probe_count"), "لا عدّاد لمحاولات جسّ الأرضية");
  });
  await t.test("إهلاك الأصول: بوّابة مالية مسمّاة — والفرع غير المالك ميّت اليوم", () => {
    const g = body("civ_can_finance");
    assert.ok(g && has(g, "is_owner"), "civ_can_finance ليست للمالك");
    // ⚠️ فرع staff_role='finance' ميّت لأنّ قيد CHECK على profiles.staff_role
    //    لا يسمح بالقيمة. لو أُضيفت القيمة يومًا لصار هذا توسيعًا صامتًا.
    assert.ok(has(g, "staff_role"),
      "تغيّر تعريف civ_can_finance — أعد تقييم الفرع الميّت المذكور هنا");
    for (const n of ["custody_finance_asset_usage", "custody_finance_compute_depreciation"]) {
      const b = body(n);
      if (!b) continue;
      assert.ok(has(b, "civ_can_finance"), `${n} تكشف القيمة الدفترية بلا بوّابة`);
    }
  });
  await t.test("ماليات المنصّة: البوّابة مسمّاة ومنفصلة عن المالية الحسّاسة", () => {
    const b = body("pc_project_financials");
    assert.ok(b, "pc_project_financials غير موجودة");
    assert.ok(has(b, "pc_can_read_project"), "بلا عزل مشروع");
    assert.ok(has(b, "can_manage_projects") || has(b, "can_see_financials"),
      "بلا بوّابة مالية المنصّة");
    // المنصّة مجمَّدة ونموذجها مقبول في V1؛ ما يهمّ هنا أنّها **لا** تستعير
    // بوّابة الموديول المالي ولا تُقرأ منه.
    assert.ok(!/\bfinops_/.test(b), "ماليات المنصّة تستعير بوّابة الموديول المالي");
    const lock = fs.readFileSync(path.join(DOCS, "project_core_financials_phaseB_lockdown_RUNME.sql"), "utf8");
    assert.ok(/revoke\s+select\s+on\s+public\.project_core\s+from\s+authenticated/i.test(lock),
      "لا إقفال لأعمدة المال على project_core — قراءة REST مباشرة ممكنة");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// ★ المِجَسّات: دالّة لا تُخرج الرقم لكنّها تُخرج مقارنةً به تُشتقّ بالبحث
//   الثنائيّ. هذا القسم يثبّت مجموعة المواضع المعروفة كي لا تنمو بصمت.
// ════════════════════════════════════════════════════════════════════════════
test("مِجَسّات الأسعار: المجموعة مثبَّتة ولا تنمو بصمت", async (t) => {
  // موضع مِجَسّ = دالّة ممنوحة لـauthenticated، تقارن مُدخَل المستخدم بعمود
  // أجر/تكلفة، وتُخرج نتيجة المقارنة، دون أن تشترط بوّابة رؤية الرقم.
  const RATE_COLS = ["day_rate", "hourly_rate", "half_day_rate", "cost_rate", "supplier_rate",
    "min_price", "internal_cost_estimate", "base_cost"];
  // ⚠️ الفارق الحاسم: إخفاء **الرقم** ليس إخفاء **المقارنة**. دالّة تُعيد
  //    day_rate = null لمن لا يملك المفتاح، ثم تُعيد «ضمن النطاق/فوقه» للجميع،
  //    ما زالت مِجَسًّا. لذلك لا يكفي ظهور اسم البوّابة في الجسم: يجب أن تكون
  //    **شرطًا مسبقًا** يرفع منعًا قبل أن تُحسب المقارنة.
  const RATE_GATES = ["can_view_vendor_rates", "sq_can_view_cost", "finops_can_view_finance_sensitive"];
  const preGated = (b) =>
    RATE_GATES.some((g) => new RegExp(`if\\s+not[\\s\\S]{0,300}?\\b${g}\\b[\\s\\S]{0,120}?raise`).test(b))
    || /if\s+not[\s\S]{0,300}?\bis_owner\b[\s\S]{0,120}?raise/.test(b);
  const found = [];
  for (const n of AUTHED) {
    const b = body(n);
    if (!b) continue;
    if (!RATE_COLS.some((c) => has(b, c))) continue;
    const compares = /<=\s*v_band|>\s*v_band|band_max|max_day_rate|below_floor|within_price_band/.test(b);
    if (!compares) continue;
    if (preGated(b)) continue;
    found.push(n);
  }

  await t.test("★ لا-فراغ ★ كاشف المِجَسّات يعمل (وجد الموضع المعروف)", () => {
    assert.ok(found.length > 0 || AUTHED.length === 0,
      "الكاشف لم يجد شيئًا — لو كان معطوبًا لبدا كلّ شيء سليمًا");
  });

  await t.test("KNOWN OPEN FINDING — مِجَسّ نطاق الأجر محصور في tvn_suggest", () => {
    // tvn_suggest يقبل max_day_rate ويعيد within_price_band / above_price_band
    // لكلّ مرشَّح. الرقم لا يخرج، لكنّ المقارنة تخرج — فالبحث الثنائيّ على
    // max_day_rate يستخرج أجر اليوم بالضبط لمن يملك talent.view أو
    // talent.assign_external وحدهما، أي بلا talent.view_rates.
    // ⚠️ خارج نطاق حزمة المالية ولم يُعالَج في هذه الدفعة. مثبَّت هنا كي لا
    //    ينتشر النمط إلى دالّة أخرى دون أن يلاحظه أحد.
    assert.deepEqual(found, ["tvn_suggest"],
      `تغيّرت مجموعة مِجَسّات الأسعار: ${found.join(", ")} — أصلحها أو حدّث هذا التثبيت`);
  });

  await t.test("لا مِجَسّ داخل الموديول المالي", () => {
    assert.deepEqual(found.filter((n) => n.startsWith("finops_")), []);
  });
});
