// ════════════════════════════════════════════════════════════════════════════
// tests/editor_least_privilege.test.js
//
// الثغرة التي تحرسها: مَن staff_role='editor' ومُسنَد kian_editor على المشروع
// كان يمرّ من project_units_can_write عبر is_kian_member (التي تقبل أيّ kian_*)
// إلى large_project_deliverables_bulk_update، وقائمة مفاتيحها المسموحة تضمّ
// stage_id و status و client_visible ⇒ نقل بين المراحل، وقفز إلى approved/
// final_delivered، وكشف مخرج مخفيّ للعميل. كلّه **خادميّ** لا واجهة.
//
// هذه الاختبارات تُنفّذ نصّ الدوالّ الحقيقيّ من ملفّات RUNME عبر مفسّر plpgsql
// في tests/fixtures/ — لا تُعيد صياغة التوقّعات في JavaScript.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const { makeWorld, ACTOR_NAMES } = require("./fixtures/project_authz_world");

const K = (w) => w.ids;

/**
 * يُعيد سبب المنع، أو null إن نُفِّذ فعلًا.
 *
 * ⚠️ الحزمة **لا ترفع استثناءً** عند المنع — بل تعزل كل صفّ وتُعيد
 * {applied, denied, results:[{ok:false, error:'forbidden_…'}]}. وهذا أفضل:
 * دفعة من مئة صفّ لا تسقط كلّها بسبب صفّ واحد، والرفض يُعلَن لا يُبتلع.
 * لذلك الخاصيّة الأمنيّة التي نفحصها هي **«لم يُطبَّق»** لا «رُفع استثناء».
 */
function bulkErr(w, args) {
  const r = w.bulkVerbose({ p_reason: "t", p_dry_run: false, ...args });
  if (r.error) return String(r.error.message || r.error);
  const ret = r.ret || {};
  if ((ret.denied || 0) > 0 || (ret.results || []).some((x) => x && x.ok === false)) {
    const first = (ret.results || []).find((x) => x && x.ok === false);
    return String((first && first.error) || "denied");
  }
  if ((ret.applied || 0) === 0 && (ret.requested || 0) > 0) return "not_applied";
  return null;
}

// ─── (أ) الأعمدة الحسّاسة الثلاثة: المنع خادميّ ─────────────────────────────

test("1 · المونتير لا يغيّر stage_id مباشرة عبر الحزمة", () => {
  const w = makeWorld(); const { D1, P2 } = K(w);
  const before = w.snapshot();
  w.as("editor");
  const err = bulkErr(w, { p_ids: [D1], p_patch: { stage_id: P2 }, p_reason: "x" });
  assert.ok(err, "كان يجب أن يُرفض نقل المرحلة");
  assert.equal(w.snapshot(), before, "رُفض الطلب لكن الحالة تغيّرت");
});

test("2 · المونتير لا يكشف مخرجًا للعميل (client_visible)", () => {
  const w = makeWorld(); const { D1 } = K(w);
  const before = w.snapshot();
  w.as("editor");
  const err = bulkErr(w, { p_ids: [D1], p_patch: { client_visible: true }, p_reason: "x" });
  assert.ok(err, "كان يجب أن يُرفض كشف المخرج");
  assert.equal(w.snapshot(), before);
});

for (const bad of ["client_review", "approved", "final_delivered"]) {
  test(`3 · المونتير لا يقفز بالحالة إلى ${bad}`, () => {
    const w = makeWorld(); const { D1 } = K(w);
    const before = w.snapshot();
    w.as("editor");
    const err = bulkErr(w, { p_ids: [D1], p_patch: { status: bad }, p_reason: "x" });
    assert.ok(err, `كان يجب أن تُرفض الحالة ${bad}`);
    assert.equal(w.snapshot(), before);
  });
}

// ─── (ب) المُسنِدات المحدّدة تُميّز الأدوار فعلًا ────────────────────────────

const PREDICATES = [
  "can_move_deliverable",
  "can_send_to_client_review",
  "can_finalize_deliverable",
  "can_move_project_stage",
  "can_approve_project_transition",
];

test("4 · المُسنِدات الحسّاسة كلّها false للمونتير و true للمالك", () => {
  const w = makeWorld(); const { P1 } = K(w);
  for (const p of PREDICATES) {
    w.as("editor");
    assert.equal(w.fn[p](P1), false, `${p} يجب أن تمنع المونتير`);
    w.as("owner");
    assert.equal(w.fn[p](P1), true, `${p} يجب أن تسمح للمالك`);
  }
});

test("5 · لا مُسنِد يعيد NULL لأيّ فاعل — الفشل مغلق لا مفتوح", () => {
  const w = makeWorld(); const { P1, P9 } = K(w);
  const all = [...PREDICATES, "can_request_project_transition"];
  for (const name of ACTOR_NAMES) {
    for (const p of all) {
      for (const proj of [P1, P9, null]) {
        w.as(name);
        const v = w.fn[p](proj);
        assert.equal(typeof v, "boolean", `${p}(${proj}) أعادت ${v} لـ${name} — NULL يعني فشلًا مفتوحًا`);
      }
    }
  }
  w.anon();
  for (const p of all) assert.equal(typeof w.fn[p](P1), "boolean", `${p} بلا جلسة`);
});

test("6 · المونتير لا يعتمد طلبات الانتقال ولا العميل ولا موظّف آخر", () => {
  const w = makeWorld(); const { P1 } = K(w);
  for (const who of ["editor", "employee", "outsider", "client"]) {
    w.as(who);
    assert.equal(w.fn.can_approve_project_transition(P1), false, `${who} يجب ألّا يعتمد`);
  }
  w.as("owner");
  assert.equal(w.fn.can_approve_project_transition(P1), true);
});

// ─── (ج) لا التفاف: الحزمة والمشروع غير المُسنَد ────────────────────────────

test("7 · المونتير لا يلمس مشروعًا غير مُسنَد عليه", () => {
  const w = makeWorld(); const { D2, P9 } = K(w);
  const before = w.snapshot();
  w.as("editor");
  for (const patch of [{ status: "approved" }, { client_visible: true }, { stage_id: P9 }]) {
    assert.ok(bulkErr(w, { p_ids: [D2], p_patch: patch, p_reason: "x" }),
      `مخرج خارج مشاريعه: ${JSON.stringify(patch)}`);
  }
  assert.equal(w.snapshot(), before);
});

test("8 · دفعة مختلطة لا تمرّر الممنوع مع المسموح", () => {
  const w = makeWorld(); const { D1 } = K(w);
  const before = w.snapshot();
  w.as("editor");
  bulkErr(w, { p_ids: [D1], p_patch: { priority: "high", client_visible: true }, p_reason: "x" });
  const d = w.deliverable(D1);
  assert.notEqual(d.client_visible, true, "تسرّب client_visible داخل دفعة مختلطة");
  assert.equal(w.snapshot(), before, "الدفعة المختلطة يجب أن تُرفض كاملة");
});

// ─── (د) المالك لا تنكسر صلاحياته — أخطر انحدار محتمل ───────────────────────

test("9 · المالك ما زال يملك كلّ مفاتيح الحزمة", () => {
  const w = makeWorld(); const { D1, P2 } = K(w);
  w.as("owner");
  for (const patch of [{ status: "approved" }, { client_visible: true }, { stage_id: P2 }, { priority: "high" }]) {
    const err = bulkErr(w, { p_ids: [D1], p_patch: patch, p_reason: "قرار المالك" });
    assert.equal(err, null, `المالك مُنع من ${JSON.stringify(patch)} — انحدار`);
  }
});

test("10 · مدير المشروع لا يحصل على اعتماد تلقائيّ", () => {
  const w = makeWorld(); const { P1 } = K(w);
  w.as("project_manager");
  assert.equal(w.fn.can_approve_project_transition(P1), false,
    "الاعتماد للمالك وحده في الإصدار الأول");
});

// ─── (هـ) ما يبقى مسموحًا للمونتير — لا نكسر عمله ───────────────────────────

test("11 · المونتير يستطيع الطلب على مشروعه فقط", () => {
  const w = makeWorld(); const { P1, P9 } = K(w);
  w.as("editor");
  assert.equal(w.fn.can_request_project_transition(P1), true, "مشروعه المُسنَد");
  assert.equal(w.fn.can_request_project_transition(P9), false, "مشروع ليس عليه");
});

test("12 · المونتير يستطيع تعديل الحقول التشغيلية غير الحسّاسة", () => {
  const w = makeWorld(); const { D1 } = K(w);
  w.as("editor");
  const err = bulkErr(w, { p_ids: [D1], p_patch: { priority: "high" }, p_reason: "عمله" });
  assert.equal(err, null, "مُنع المونتير من عمله الطبيعيّ — تشديد زائد");
});

// ─── (و) القائمة البيضاء نفسها ──────────────────────────────────────────────

test("13 · مفاتيح الحزمة الحسّاسة محروسة بمُسنِد لا بالقائمة وحدها", () => {
  const { SQL } = require("./fixtures/project_authz_world");
  const body = SQL.EDIT;
  for (const key of ["stage_id", "client_visible", "status"]) {
    assert.ok(body.includes(key), `${key} يجب أن يبقى مذكورًا (المالك يحتاجه)`);
  }
  for (const p of ["can_move_deliverable", "can_send_to_client_review", "can_finalize_deliverable"]) {
    assert.ok(body.includes(p), `الحزمة يجب أن تستدعي ${p}`);
  }
  assert.ok(!/is_kian_member\s*\(\s*v_proj\s*\)\s*then\s+return\s+true/.test(body),
    "عاد المرور العريض عبر is_kian_member");
});

test("14 · لا منح anon في حزمة الصلاحيات", () => {
  const { SQL } = require("./fixtures/project_authz_world");
  assert.ok(!/grant[^;]*\bto\b[^;]*\banon\b/i.test(SQL.EDIT), "منح لـanon");
  assert.ok(!/grant[^;]*\bto\b[^;]*\banon\b/i.test(SQL.TR), "منح لـanon");
});
