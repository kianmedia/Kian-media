// ════════════════════════════════════════════════════════════════════════════
// tests/quoting_versioning.test.js — إصدارات دفتر الأسعار ودورة حياة العرض.
//
// ★ لماذا الإصدارات ليست ترفًا ★
//   العرض يتجمّد على نسخة دفتر أسعار بعينها. بلا ذلك يصير تدقيق ربحية صفقةٍ
//   ماضية مستحيلًا لا صعبًا: تقرأ تكلفة اليوم مقابل سعر الأمس فتخرج بهامش
//   لم يحدث قطّ. ولذلك النسخة المنشورة **مجمَّدة على طرفَيها** — البيع
//   والتكلفة معًا — وإلّا كان التجميد بالاسم فقط.
//
// ودورة الحياة تُختبر هنا لأنّ انتقالًا واحدًا مفقودًا يترك عرضًا عالقًا:
// معتمَدًا لا يُرسَل، أو منتهيًا يُعدَّل، أو مقبولًا بعد انتهاء صلاحيته.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  SQL, funcBody, funcDef, tableDef, STATES,
} = require("./quoting_helpers.js");

// ─── (١) الإصدارات ──────────────────────────────────────────────────────────

test("★ نسخة منشورة لا تُعدَّل ★", () => {
  const t = funcBody("sq_pbv_immutable");
  assert.match(t, /if old\.status = 'published' then/, "لا حراسة على النسخة المنشورة");
  assert.match(t, /raise exception/, "التعديل لا يُمنع فعليًّا");
  // الانتقال الوحيد المسموح
  assert.match(t, /if new\.status = 'superseded' then return new; end if;/,
    "لا يمكن استبدال نسخة منشورة — الدفتر يتجمّد إلى الأبد");
  assert.match(SQL, /create trigger sq_pbv_immutable_trg\s+before update on public\.sq_price_book_versions/,
    "المُشغّل غير مربوط");
});

test("★ التجميد يشمل طرفَي النسخة: البيع والتكلفة ★", () => {
  const g = funcBody("sq_pb_entry_frozen");
  assert.match(g, /select status into v_status from public\.sq_price_book_versions/,
    "الحارس لا يقرأ حالة النسخة الأمّ");
  assert.match(g, /if v_status = 'published' then/, "الحارس لا يمنع على المنشورة");
  // ومربوط بالجدولين
  assert.match(SQL,
    /create trigger sq_pbe_frozen_trg\s+before insert or update or delete on public\.sq_price_book_entries/,
    "بنود البيع غير مجمّدة");
  assert.match(SQL,
    /create trigger sq_cost_rates_frozen_trg\s+before insert or update or delete on public\.sq_cost_rates/,
    "★ أسعار التكلفة غير مجمّدة — التجميد بالاسم فقط، وتدقيق الماضي ينهار");
});

test("النسخة الجديدة تُبذَر من المنشورة السابقة — بطرفيها", () => {
  const seed = funcBody("sq_pbv_seed");
  assert.match(seed, /status = 'published' and id <> new\.id/, "البذر لا يقرأ النسخة المنشورة");
  assert.match(seed, /insert into public\.sq_price_book_entries/, "لا نسخ لبنود البيع");
  assert.match(seed, /insert into public\.sq_cost_rates/,
    "لا نسخ لأسعار التكلفة — النسخة الجديدة ستكون غير قابلة للتسعير");
  assert.match(seed, /if v_prev is null then return null; end if;/,
    "أوّل نسخة في دفتر جديد ستفشل");
});

test("لا نسختان مسودّتان في دفتر واحد", () => {
  const o = funcBody("sq_price_book_version_open");
  assert.match(o, /status = 'draft'\)\s*then\s*\n?\s*raise exception/,
    "يمكن فتح مسودّتين — أيّهما ستُنشر؟");
  assert.match(o, /coalesce\(max\(version_no\), 0\) \+ 1/, "رقم النسخة لا يتزايد");
});

test("النشر يستبدل المنشورة السابقة ولا يُنشر مرّتين", () => {
  const p = funcBody("sq_price_book_version_publish");
  assert.match(p, /if v_status <> 'draft' then/, "يمكن نشر نسخة منشورة مرّتين");
  assert.match(p, /set status = 'superseded'\s*\n?\s*where price_book_id = v_book and status = 'published'/,
    "النسخة السابقة تبقى منشورة — نسختان منشورتان في دفتر واحد");
  assert.match(p, /if v_entries = 0 then raise exception/,
    "★ تُنشر نسخة بلا بنود — كلّ عرض يُبنى عليها سيفشل عند أوّل بند");
});

test("★ العرض يتجمّد على نسخة، والنسخة يجب أن تكون منشورة ★", () => {
  assert.match(tableDef("sq_quotes"), /price_book_version_id uuid references public\.sq_price_book_versions/,
    "العرض لا يتجمّد على نسخة");
  const c = funcBody("sq_quote_create");
  assert.match(c, /v_st is distinct from 'published'/,
    "★ يُبنى عرض على مسودّة دفتر — أسعاره قد تتغيّر تحته");
  assert.match(c, /لا توجد نسخة دفتر أسعار منشورة/, "لا رسالة حين لا نسخة منشورة");
});

test("★ التسعير يقرأ تكلفة النسخة المثبَّتة لا أحدث نسخة ★", () => {
  const r = funcBody("sq_quote_recompute");
  assert.match(r, /cr\.version_id = v_pbv/,
    "★ التكلفة تُقرأ من نسخة أخرى — ربحية عرضٍ قديم تُحسب بأسعار اليوم");
  assert.match(r, /if v_pbv is null then/, "يُسعَّر عرض بلا نسخة مثبَّتة");
  // وسعر البيع كذلك من النسخة المثبَّتة
  const l = funcBody("sq_quote_line_set");
  assert.match(l, /e\.version_id = v_pbv/, "سعر البيع لا يأتي من النسخة المثبَّتة");
});

test("سعر بيع البند من الدفتر لا من لوحة المفاتيح", () => {
  const l = funcBody("sq_quote_line_set");
  assert.match(l, /if p_catalog is not null then/, "لا تمييز بين بند كتالوج وبند مخصّص");
  assert.match(l, /لا يوجد سعر بيع لهذه الخدمة في هذه الفئة ضمن النسخة المثبَّتة/,
    "بند بلا سعر منشور يمرّ بصمت");
  // البند المخصّص وحده يقبل سعرًا يدويًّا
  assert.match(l, /if p_unit_sell_rate is null then raise exception 'البند المخصّص يحتاج سعر وحدة'/,
    "البند المخصّص يمرّ بلا سعر");
});

// ─── (٢) دورة حياة العرض ────────────────────────────────────────────────────

test("★ كلّ حالة من التسع لها مدخل أو مخرج ★", () => {
  const reachable = {
    draft: /default 'draft'/,
    internal_review: /status = 'internal_review'/,
    pending_owner_approval: /status = 'pending_owner_approval'/,
    approved: /status = 'approved'/,
    sent_placeholder: /status = 'sent_placeholder'/,
    // تُبلَغان عبر `set status = p_decision` المحروس بقائمة مغلقة
    accepted: /p_decision not in \('accepted','rejected'\)/,
    rejected: /set status = p_decision, client_decision = p_decision/,
    expired: /set status = 'expired'/,
    superseded: /set status = 'superseded'/,
  };
  for (const s of STATES) {
    assert.match(SQL, reachable[s], `الحالة ${s} غير قابلة للوصول — حالة ميّتة في القيد`);
  }
});

test("التحرير ممنوع بعد الرفع للاعتماد", () => {
  for (const f of ["sq_quote_inputs_set", "sq_quote_line_set", "sq_quote_terms_set",
                   "sq_quote_price_set", "sq_quote_milestones_set"]) {
    assert.match(funcBody(f), /not in \('draft','internal_review'\)/,
      `${f} تسمح بالتعديل بعد الرفع — العرض يتغيّر تحت المالك وهو يقرّر`);
  }
  assert.match(funcBody("sq_quote_line_delete"), /not in \('draft','internal_review'\)/,
    "حذف البنود مسموح بعد الرفع");
});

test("★ الرفض يعيد إلى المراجعة الداخلية لا إلى المسودّة ★", () => {
  const d = funcBody("sq_approval_decide");
  assert.match(d, /status = 'internal_review'.*where id = v_quote/s,
    "الرفض لا يعيد العرض إلى حالة قابلة للتعديل — العمل المنجز يضيع");
  assert.match(d, /if v_status <> 'pending' then raise exception/, "طلب محسوم يُحسم مرّتين");
});

test("سحب الطلب يعيد العرض إلى المراجعة", () => {
  const w = funcBody("sq_approval_withdraw");
  assert.match(w, /status = 'internal_review'/, "السحب يترك العرض عالقًا في الانتظار");
  assert.match(w, /v_by <> auth\.uid\(\) and not coalesce\(public\.sq_can_approve\(\), false\)/,
    "★ أيّ موظّف يسحب طلب غيره");
});

test("★ الجاهزية للإرسال اليدوي تشترط الاعتماد ★", () => {
  const m = funcBody("sq_quote_mark_ready_for_manual_send");
  assert.match(m, /if v_status <> 'approved' then/,
    "★ عرض غير معتمد يُعلَّم جاهزًا — قد يُرسل بسعر لم يوافق عليه المالك");
});

test("قرار العميل يُسجَّل بعد الاعتماد فقط", () => {
  const r = funcBody("sq_quote_record_client_decision");
  assert.match(r, /not in \('approved','sent_placeholder'\)/,
    "قرار العميل يُسجَّل على مسودّة");
  assert.match(r, /p_decision not in \('accepted','rejected'\)/, "قرار غير معروف يُقبل");
});

test("★ النسخة الجديدة تستبدل القديمة وتنسخ محتواها ★", () => {
  const n = funcBody("sq_quote_new_version");
  assert.match(n, /version_no \+ 1/, "رقم النسخة لا يتزايد");
  assert.match(n, /supersedes_id/, "النسخة الجديدة لا تشير إلى سابقتها");
  assert.match(n, /set status = 'superseded'.*where id = p_quote/s, "القديمة تبقى فعّالة");
  assert.match(n, /insert into public\.sq_quote_lines/, "البنود لا تُنسخ");
  assert.match(n, /insert into public\.sq_quote_inputs/, "المدخلات لا تُنسخ");
  assert.match(n, /if v_old\.status = 'superseded' then raise exception/,
    "تُشتقّ نسخة من نسخة مُستبدَلة");
  // ★ ولا تُنسخ الأرقام الداخلية: النسخة الجديدة تُسعَّر من جديد
  assert.ok(!/insert into public\.sq_quote_internal/.test(n),
    "★ النسخة الجديدة ترث حساب ربحية قديمًا لا يخصّها");
});

test("انتهاء الصلاحية لا يلمس عرضًا حسمه العميل", () => {
  const e = funcBody("sq_expiry_scan");
  assert.match(e, /where status in \('approved','sent_placeholder'\)/,
    "★ الفحص يُنهي عروضًا مقبولة أو مرفوضة — يمحو قرار العميل");
  assert.match(e, /valid_until is not null and valid_until < current_date/,
    "الفحص لا يقارن بالتاريخ");
});

test("★ الدفعات يجب أن تساوي الإجمالي ★", () => {
  const m = funcBody("sq_quote_milestones_set");
  assert.match(m, /abs\(v_sum - v_gross\) > 0\.05/,
    "★ مجموع الدفعات قد لا يساوي العرض — فرقٌ يظهر عند التحصيل لا عند البيع");
  assert.match(m, /raise exception 'مجموع الدفعات/, "الفرق لا يُعلَن");
});

// ─── (٣) سلامة الحساب ───────────────────────────────────────────────────────

test("★ أدنى هامش لا يتجاوز المستهدف — وإلّا صارت الأرضية فوق المقترَح ★", () => {
  const r = funcBody("sq_quote_recompute");
  assert.match(r, /if v_min > v_target then/, "لا حراسة على ترتيب الهامشين");
  assert.match(r, /v_target >= 1 or v_target < 0/, "الهامش المستهدف بلا مجال");
  assert.match(r, /v_min\s+>= 1 or v_min\s+< 0/, "أدنى هامش بلا مجال");
});

test("قسمة الهامش لا تقع على صفر", () => {
  const r = funcBody("sq_quote_recompute");
  assert.match(r, /case when coalesce\(v_gross,0\) > 0 then round\(v_gp \/ v_gross, 4\) else null end/,
    "نسبة الهامش تُحسب بقسمة قد تكون على صفر — أو تُزيَّف صفرًا");
});

test("★ العرض بلا رقم بيع يُنتج هوامش NULL لا أصفارًا ★", () => {
  const r = funcBody("sq_quote_recompute");
  assert.match(r, /nullif\(v_list, 0\)/,
    "مجموع بنودٍ صفريّ يُعامَل سعرًا فعليًّا فيُنتج هامشًا سالبًا وهميًّا");
  assert.match(r, /case when v_gross is null then null else round\(v_gross - v_cost, 2\) end/,
    "الربح يُحسب على سعر غير موجود");
});

test("التسعير لا يعمل على عرض مُستبدَل أو منتهٍ", () => {
  assert.match(funcBody("sq_quote_recompute"), /v_status in \('superseded','expired'\)/,
    "يُعاد تسعير عرض خرج من الخدمة");
});
