// ════════════════════════════════════════════════════════════════════════════
// tests/wave8_offline_queue_contract.test.js — Wave 8 · V2-8.6-A
//
// ⛔ عقد فقط: لا محرّك ولا تخزين ولا مزامنة.
//    MOBILE OFFLINE MUTATIONS DEFERRED TO WAVE 9
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const ROOT = path.resolve(__dirname, "..");
const loadTs = (rel) => {
  const js = ts.transpileModule(fs.readFileSync(path.join(ROOT, rel), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const m = { exports: {} };
  // eslint-disable-next-line no-new-func
  new Function("exports", "module", "require", js)(m.exports, m, () => ({}));
  return m.exports;
};
const Q = loadTs("lib/mobile/offlineQueue.ts");

const base = (over = {}) => ({
  entity_type: "hr_attendance", operation: "check_in",
  idempotency_key: "k1", actor_id: "u1",
  payload: { occurred_at: "2026-08-04T06:00:00Z", lat: 26.4, lng: 50.1 },
  ...over,
});

// ─── ١ · قائمة السماح ──────────────────────────────────────────────────────
test("العمليات المسموحة تُقبل", () => {
  const r = Q.validateQueueItem(base());
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.spec.rpc, "hr_check_in");
});

test("🔴 كل عملية خارج القائمة مرفوضة", () => {
  for (const o of [
    { entity_type: "anything", operation: "create" },
    { entity_type: "hr_attendance", operation: "delete" },
    { entity_type: "project_note", operation: "destroy" },
  ]) {
    const r = Q.validateQueueItem(base(o));
    assert.equal(r.ok, false, `قُبلت ${JSON.stringify(o)}`);
    assert.equal(r.reason, "operation_not_allowed");
  }
});

// ─── ٢ · 🔴 لا عمليات مالية ولا موافقات ولا رفع ملفّات ─────────────────────
test("🔴 الكيانات المالية والإدارية والرفع محظورة كلّيًّا", () => {
  for (const e of ["fin_costs", "fin_invoices", "invoice_line", "payment_intent",
                   "quote_accept", "approval_step", "decision_log", "change_request",
                   "deliverable_final_delivered", "storage_object", "media_bytes_chunk"]) {
    const r = Q.validateQueueItem(base({ entity_type: e, operation: "create" }));
    assert.equal(r.ok, false, `دخل الطابور كيان محظور: ${e}`);
    assert.equal(r.reason, "entity_forbidden", `سبب خاطئ لـ${e}: ${r.reason}`);
  }
});

test("لا عملية مسموحة تمسّ نطاقًا محظورًا", () => {
  for (const spec of Q.ALLOWED_OPERATIONS) {
    for (const re of Q.FORBIDDEN_ENTITY_PATTERNS) {
      assert.ok(!re.test(spec.entityType),
        `العملية المسموحة ${spec.entityType} تطابق نمطًا محظورًا ${re}`);
    }
  }
});

// ─── ٣ · 🔴 قائمة الحقول — رفض لا تنظيف صامت ───────────────────────────────
test("حقل خارج قائمة العملية يُرفض", () => {
  const r = Q.validateQueueItem(base({
    payload: { occurred_at: "2026-08-04T06:00:00Z", amount: 5000 },
  }));
  assert.equal(r.ok, false);
  assert.equal(r.reason, "field_not_allowed");
  assert.equal(r.detail, "amount");
});

test("🔴 الحقول الحاملة للأسرار مرفوضة بالاسم", () => {
  for (const k of ["password", "access_token", "refresh_token", "service_role_key",
                   "apiKey", "authorization", "Bearer", "signed_url", "client_secret",
                   "iban", "account_number", "card_number", "cvv", "cookie"]) {
    const r = Q.validateQueueItem(base({ payload: { [k]: "x" } }));
    assert.equal(r.ok, false, `قُبل حقل سرّيّ: ${k}`);
    assert.equal(r.reason, "forbidden_field", `${k} رُفض لسبب آخر: ${r.reason}`);
  }
});

test("🔴 السرّ تحت مفتاح بريء يُكتشف من القيمة", () => {
  const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig";
  // ⚠️ `note` حقل نصّيّ **مسموح** في عملية قائمة — وهذا بالضبط ما يجعل فحص
  //    القيمة ضروريًّا: اسم المفتاح بريء تمامًا.
  const r1 = Q.validateQueueItem(base({
    entity_type: "hr_task", operation: "complete",
    payload: { task_id: "t1", note: jwt },
  }));
  assert.equal(r1.ok, false, "مرّ JWT داخل حقل نصّيّ مسموح");
  assert.equal(r1.detail, "jwt_in_value");

  const r2 = Q.validateQueueItem(base({
    entity_type: "hr_task", operation: "complete",
    payload: { task_id: "t1", note: "https://x.supabase.co/o/f.pdf?token=abc123" },
  }));
  assert.equal(r2.ok, false, "مرّ رابط موقَّع داخل حقل نصّيّ");
  assert.equal(r2.detail, "signed_url_in_value");
});

test("⛔ لا طابور HTTP عامّ: لا حقل جسم طلب حرّ", () => {
  for (const spec of Q.ALLOWED_OPERATIONS) {
    for (const f of spec.allowedFields) {
      assert.ok(!/^(body|headers|request|url|method|raw)$/i.test(f),
        `${spec.entityType}.${spec.operation} يسمح بحقل طلب حرّ: ${f}`);
    }
    assert.ok(spec.rpc && !/^https?:/i.test(spec.rpc),
      `${spec.entityType} يشير إلى عنوان لا إلى دالّة قائمة`);
  }
});

// ─── ٤ · مفتاح التكرار والفاعل ─────────────────────────────────────────────
test("بلا مفتاح تكرار أو فاعل: رفض", () => {
  assert.equal(Q.validateQueueItem(base({ idempotency_key: undefined })).reason,
    "missing_idempotency_key");
  assert.equal(Q.validateQueueItem(base({ actor_id: undefined })).reason, "missing_actor");
});

// ─── ٥ · انتهاء الصلاحية ───────────────────────────────────────────────────
test("لكل عملية عمر، والمنتهي يُكتشف", () => {
  const spec = Q.findSpec("hr_attendance", "check_in");
  const created = "2026-08-04T06:00:00.000Z";
  const exp = Q.computeExpiry(spec, created);
  assert.equal(exp, "2026-08-04T18:00:00.000Z", "عمر الحضور ≠ 12 ساعة");
  assert.equal(Q.isExpired({ expires_at: exp }, "2026-08-04T17:00:00Z"), false);
  assert.equal(Q.isExpired({ expires_at: exp }, "2026-08-05T00:00:00Z"), true);
  for (const s of Q.ALLOWED_OPERATIONS) {
    assert.ok(s.maxAgeMs > 0 && s.maxAgeMs <= 7 * 24 * 3600_000,
      `${s.entityType}.${s.operation} عمره غير معقول`);
  }
});

// ─── ٦ · 🔴 التعارض لا يُحسم تلقائيًّا ─────────────────────────────────────
test("🔴 لا last-write-wins ولا حذف تلقائيّ عند التعارض", () => {
  assert.equal(Q.canTransition("conflicted", "succeeded"), false,
    "التعارض يُحسم تلقائيًّا لصالح آخر كتابة");
  assert.equal(Q.canTransition("conflicted", "pending"), false, "التعارض يُعاد إرساله");
  assert.equal(Q.canTransition("conflicted", "expired"), false, "التعارض يُسقَط بصمت");
  assert.equal(Q.canTransition("conflicted", "cancelled"), true,
    "لا مخرج للتعارض إطلاقًا — يبقى عالقًا");
  assert.equal(Q.shouldRetry({ status: "conflicted", retry_count: 0, max_retries: 5 }), false);
});

test("الحالات النهائية لا تتحرّك", () => {
  for (const s of Q.TERMINAL_STATUSES) {
    for (const to of Q.QUEUE_STATUSES) {
      assert.equal(Q.canTransition(s, to), false, `${s} → ${to} مسموح وهو نهائيّ`);
    }
  }
});

test("حدّ إعادة المحاولة محترَم", () => {
  assert.equal(Q.shouldRetry({ status: "failed", retry_count: 2, max_retries: 3 }), true);
  assert.equal(Q.shouldRetry({ status: "failed", retry_count: 3, max_retries: 3 }), false);
  assert.equal(Q.shouldRetry({ status: "pending", retry_count: 0, max_retries: 3 }), false);
});

test("الحالات السبع كلّها معرَّفة", () => {
  assert.deepEqual([...Q.QUEUE_STATUSES].sort(),
    ["cancelled", "conflicted", "expired", "failed", "pending", "succeeded", "syncing"]);
});

// ─── ٧ · الخروج يُلغي ما لم يُزامَن ────────────────────────────────────────
test("🔴 الخروج يُلغي كل عنصر غير نهائيّ", () => {
  const items = Q.QUEUE_STATUSES.map((s, i) => ({
    id: `i${i}`, status: s, user_visible_status: "",
  }));
  const after = Q.cancelAllOnLogout(items);
  for (const it of after) {
    if (Q.TERMINAL_STATUSES.includes(items.find((x) => x.id === it.id).status)) continue;
    assert.equal(it.status, "cancelled", `${it.id} بقي ${it.status} بعد الخروج`);
    assert.ok(it.user_visible_status.length > 0, "أُلغي بلا شرح للمستخدم");
  }
  // والنهائيّ لا يُمسّ — «نجح» لا يصير «أُلغي».
  const ok = after.find((x) => x.id === `i${Q.QUEUE_STATUSES.indexOf("succeeded")}`);
  assert.equal(ok.status, "succeeded");
});

// ─── ٨ · التأجيل مُعلَن، والمحرّك غير موجود ────────────────────────────────
test("⛔ لا محرّك مزامنة: لا شبكة ولا تخزين محلّيّ في الوحدة", () => {
  const src = fs.readFileSync(path.join(ROOT, "lib/mobile/offlineQueue.ts"), "utf8");
  assert.ok(/MOBILE OFFLINE MUTATIONS DEFERRED TO WAVE 9/.test(src),
    "التأجيل غير مُعلَن في الوحدة");
  for (const re of [/\bfetch\s*\(/, /localStorage/, /IndexedDB|indexedDB/,
                    /AsyncStorage/, /setInterval\s*\(/, /navigator\.onLine/]) {
    assert.ok(!re.test(src), `الوحدة تُنفّذ مزامنة فعليّة: ${re}`);
  }
});

// 🔴 هذا الاختبار وُلد من خطأ حقيقيّ: الصياغة الأولى للعقد أشارت إلى أربع دوالّ
//    **غير موجودة** (hr_start_task · hr_complete_task · project_add_note ·
//    custody_record_check). الفحص الشكليّ على الاسم كان يمرّرها جميعًا، لأنّها
//    تتبع الاصطلاح تمامًا. فالمطابقة الآن **مقابل السطح المستخرَج من الشيفرة**.
test("🔴 كل عملية تشير إلى دالّة موجودة فعلًا — لا اسم مخترَع", () => {
  const libDir = path.join(ROOT, "lib/portal");
  const surface = new Set();
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!e.name.endsWith(".ts")) continue;
      const src = fs.readFileSync(p, "utf8");
      for (const m of src.matchAll(/prpc(?:<[^>]*>)?\(\s*["'`]([a-zA-Z0-9_]+)/g)) {
        surface.add(m[1]);
      }
    }
  };
  walk(libDir);
  assert.ok(surface.size > 100, `السطح المستخرَج صغير (${surface.size}) — الاستخراج نفسه معطوب`);

  for (const s of Q.ALLOWED_OPERATIONS) {
    assert.ok(surface.has(s.rpc),
      `${s.entityType}.${s.operation} يشير إلى دالّة غير موجودة: ${s.rpc}`);
  }
});
