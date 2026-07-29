// ════════════════════════════════════════════════════════════════════════════
// tests/fixtures/project_authz_world.js — «عالَم» قابل للتشغيل: صفوف حقيقية
// (profiles · project_members · projects · deliverables …) + الدوالّ المشحونة
// **مُترجَمة من نصّها في docs/*.sql** لا مُعاد كتابتها.
//
// كلّ مُسنَد في السلسلة يُنفَّذ من مصدره:
//   is_admin · is_owner · is_staff · staff_role · project_role · my_client_id
//   can_access_project · staff_reads_all_projects · can_manage_projects
//   can_final_deliver · can_edit_project · is_kian_member · pc_can_read_project
//   project_units_can_write · emp_has_permission            ← ملفّات قائمة
//   can_move_deliverable · can_send_to_client_review · can_finalize_deliverable
//   can_move_project_stage · can_request_project_transition
//   can_approve_project_transition · large_project_deliverables_bulk_update
//                                                            ← ملفّ الإصلاح
//   ptr_* · project_transition_request_create/decide         ← حزمة الانتقال
//
// «الدور» ليس ثابتًا في الجافاسكربت بل صفّ في profiles وصفّ في project_members،
// فالقرار يُشتقّ بتنفيذ SQL الحقيقيّ. تغيير حرف واحد في أيّ حارس يغيّر النتيجة.
//
// ما لم يُترجَم (وسببه): project_core_set_stage يُنفَّذ حارسه الحقيقيّ المستخرَج
// من الملفّ، ثمّ تُحدَّث المرحلة آليًّا — بقيّة جسمها (insert … on conflict …
// returning) خارج نطاق المحرّك ولا تحمل قرار صلاحية.
// ════════════════════════════════════════════════════════════════════════════
"use strict";

const {
  readSql, compile, compileVerbose, extractFunction, evalCondition,
  guardConditionBefore, SqlError,
} = require("./plpgsql");
const { makeEngine, parseUniqueIndexes } = require("./minidb");

// ─── الملفّات ───────────────────────────────────────────────────────────────
const SQL = {
  EDIT: readSql("docs/project_editor_permissions_RUNME.sql"),
  TR: readSql("docs/project_transition_approval_RUNME.sql"),
  BIG: readSql("docs/project_platform_large_projects_RUNME.sql"),
  P0: readSql("docs/phase0_migration.sql"),
  STAFF: readSql("docs/staff_roles_task_assignment_RUNME.sql"),
  HARD: readSql("docs/project_platform_authz_hardening_RUNME.sql"),
  CORE: readSql("docs/project_core_FINAL_RUNME.sql"),
  PERM: readSql("docs/permission_catalog_RUNME.sql"),
};

// ─── الجهات الفاعلة — صفوف profiles/project_members لا رايات JS ─────────────
// ملاحظة: كلّ قيمة هنا مفردة قاعدة بيانات قائمة (CHECK على profiles.staff_role
// في docs/staff_roles_task_assignment_RUNME.sql:37، وعلى project_members.role
// في docs/phase0_migration.sql:143). لا مفردات مخترعة.
const ACTORS = {
  owner: { uid: "u-owner", account_type: "admin", staff_role: "super_admin", role: "kian_admin" },
  project_manager: { uid: "u-pm", account_type: "staff", staff_role: "manager", role: "kian_manager" },
  editor: { uid: "u-editor", account_type: "staff", staff_role: "editor", role: "kian_editor" },
  employee: { uid: "u-emp", account_type: "staff", staff_role: "sales", role: "kian_photographer" },
  outsider: { uid: "u-out", account_type: "staff", staff_role: "sales", role: null },
  client: { uid: "u-client", account_type: "client", staff_role: null, role: "client_owner" },
};
const ACTOR_NAMES = Object.keys(ACTORS);

const P1 = "11111111-1111-1111-1111-111111111111"; // المشروع الرئيسيّ
const P2 = "22222222-2222-2222-2222-222222222222"; // مرحلة/فرع تابع لنفس العميل
const P9 = "99999999-9999-9999-9999-999999999999"; // مشروع عميل آخر
const D1 = "dddddddd-0000-0000-0000-000000000001";
const D2 = "dddddddd-0000-0000-0000-000000000002";
const C1 = "cccccccc-0000-0000-0000-000000000001";
const C2 = "cccccccc-0000-0000-0000-000000000002";

function seed(opts) {
  const clock = 1000000;
  return {
    clock,
    profiles: ACTOR_NAMES.map((n) => ({
      id: ACTORS[n].uid, account_type: ACTORS[n].account_type, account_status: "active",
      staff_role: ACTORS[n].staff_role, full_name: n,
    })),
    clients: [
      { id: C1, user_id: "u-client", is_deleted: false },
      { id: C2, user_id: "u-client-other", is_deleted: false },
    ],
    projects: [
      { id: P1, project_name: "مشروع كبير", client_id: C1, is_deleted: false, parent_project_id: null, status: "in_production" },
      { id: P2, project_name: "المرحلة الثانية", client_id: C1, is_deleted: false, parent_project_id: P1, status: "in_production" },
      { id: P9, project_name: "مشروع عميل آخر", client_id: C2, is_deleted: false, parent_project_id: null, status: "in_production" },
    ],
    project_core: [
      { project_id: P1, core_stage: "in_production", progress_pct: 10, updated_at: clock, updated_by: null },
      { project_id: P2, core_stage: "in_production", progress_pct: 0, updated_at: clock, updated_by: null },
    ],
    project_members: ACTOR_NAMES.filter((n) => ACTORS[n].role)
      .map((n) => ({ project_id: P1, user_id: ACTORS[n].uid, role: ACTORS[n].role, is_deleted: false })),
    deliverables: [
      {
        id: D1, project_id: P1, title: "إعلان الافتتاح", type: "video", version: 1,
        status: "draft", client_visible: false, stage_id: P1, is_deleted: false,
        assignee_id: "u-editor", priority: "normal", due_date: null, planned_start_date: null,
        schedule_status: "awaiting_schedule", requires_shooting: false, requires_editing: true,
        requires_design: false, requires_printing: false, preview_url: null, vimeo_review_url: null,
      },
      {
        id: D2, project_id: P1, title: "فيديو ثانٍ", type: "video", version: 1,
        status: "internal_review", client_visible: false, stage_id: P1, is_deleted: false,
        assignee_id: "u-editor", priority: "normal", due_date: null, planned_start_date: null,
        schedule_status: "scheduled", requires_shooting: false, requires_editing: true,
        requires_design: false, requires_printing: false, preview_url: null, vimeo_review_url: null,
      },
    ],
    project_transition_requests: [],
    activity_log: [],
    // كتالوج الصلاحيات (§S4/S5 في التدقيق) — لاختبار المِهَن والاستثناءات.
    permissions: [
      { id: "perm-move", key: "deliverables.move_stage", sensitivity: "sensitive", enabled: true },
      { id: "perm-visible", key: "deliverables.set_client_visible", sensitivity: "sensitive", enabled: true },
      { id: "perm-final", key: "deliverables.finalize", sensitivity: "sensitive", enabled: true },
      { id: "perm-pstage", key: "projects.move_stage", sensitivity: "sensitive", enabled: true },
      { id: "perm-treq", key: "transitions.request", sensitivity: "normal", enabled: true },
      { id: "perm-tapp", key: "transitions.approve", sensitivity: "sensitive", enabled: true },
    ],
    professions: [],
    profession_permissions: [],
    employee_professions: [],
    employee_permission_overrides: [],
    ...(opts.tables || {}),
  };
}

/**
 * يبني عالَمًا جاهزًا.
 *   const w = makeWorld();  w.as("editor");  w.fn.can_move_deliverable(P1)
 */
function makeWorld(opts = {}) {
  const db = seed(opts);
  const state = { uid: null, seq: 0 };
  const log = { pc_log: [], notify: [], stage_calls: [] };

  const engine = makeEngine(db, {
    indexes: parseUniqueIndexes(SQL.TR),
    now: () => db.clock,
    seq: () => ++state.seq,
    expiresAt: () => db.clock + 30 * 24 * 3600,
  });

  const env = {
    fn: Object.create(null),
    vars: {},
    trace: [],
    select: engine.select, exec: engine.exec, query: engine.query,
    exists: engine.exists, selectScalar: engine.selectScalar,
  };
  engine.env = env;

  // ── الذرّات: الهويّة والوقت ────────────────────────────────────────────────
  env.fn["auth.uid"] = () => state.uid;
  env.fn.now = () => db.clock;
  env.fn.gen_random_uuid = () => `gen-${++state.seq}`;
  env.fn.to_regprocedure = (sig) => {
    const name = String(sig).replace(/^public\./, "").replace(/\(.*$/, "");
    return name in env.fn ? sig : null;
  };

  // ── مُسنَدات مُترجَمة من نصّها الحقيقيّ ────────────────────────────────────
  const reg = (name, sql, args, opt) => {
    const f = compile(sql, name, args, opt);
    env.fn[name] = (...vals) => {
      const bound = {};
      args.forEach((a, i) => { bound[a] = vals[i] === undefined ? null : vals[i]; });
      return f(env, bound);
    };
    return env.fn[name];
  };

  reg("is_admin", SQL.P0, []);
  reg("staff_role", SQL.STAFF, []);
  reg("is_staff", SQL.STAFF, []);
  reg("is_owner", SQL.STAFF, []);
  reg("my_client_id", SQL.P0, []);
  reg("project_role", SQL.P0, ["p_project"]);
  reg("can_access_project", SQL.P0, ["p_project"]);
  reg("is_client_side", SQL.P0, ["p_project"]);
  reg("can_manage_projects", SQL.HARD, []);
  reg("can_final_deliver", SQL.HARD, []);
  reg("staff_reads_all_projects", SQL.HARD, []);
  reg("can_edit_project", SQL.HARD, ["p_project"]);
  reg("is_kian_member", SQL.P0, ["p_project"]);
  reg("pc_can_read_project", SQL.CORE, ["p_project"]);
  reg("project_units_can_write", SQL.BIG, ["p_project"]);

  // مُحلِّل الصلاحيات الحقيقيّ (deny > allow > اتّحاد المِهَن).
  const empTwo = compile(SQL.PERM, "emp_has_permission", ["p_user", "p_key"], { index: 0 });
  env.fn.emp_has_permission = (a, b) =>
    (b === undefined ? empTwo(env, { p_user: state.uid, p_key: a })
      : empTwo(env, { p_user: a, p_key: b }));

  // ── مُسنَدات حزمة الإصلاح ─────────────────────────────────────────────────
  for (const n of ["can_move_deliverable", "can_send_to_client_review", "can_finalize_deliverable",
    "can_move_project_stage", "can_request_project_transition", "can_approve_project_transition"]) {
    reg(n, SQL.EDIT, ["p_project"]);
  }

  // ── تبعيات تشغيلية (لا تحمل قرار صلاحية) ─────────────────────────────────
  env.fn.pc_log = (proj, action, etype, eid, meta) => {
    log.pc_log.push({ project_id: proj, action, entity_type: etype, entity_id: eid, meta });
    return null;
  };
  env.fn.notify = (user, kind, type, etype, eid, ar, en) => {
    log.notify.push({ user_id: user, audience: kind, type, entity_type: etype, entity_id: eid, ar, en });
    return null;
  };
  env.fn.pc_notify_team = (...a) => { log.notify.push({ team: a[0], type: a[1] }); return null; };
  env.fn.pc_notify_user = (...a) => { log.notify.push({ user_id: a[0], type: a[1] }); return null; };
  env.fn.project_hierarchy_root = (p) => {
    let cur = db.projects.find((x) => x.id === p);
    if (!cur) return null;
    for (let i = 0; i < 20 && cur.parent_project_id; i++) {
      const nxt = db.projects.find((x) => x.id === cur.parent_project_id);
      if (!nxt) break;
      cur = nxt;
    }
    return cur.id;
  };
  env.fn.pc_project_is_closed = (p) => {
    const pc = db.project_core.find((x) => x.project_id === p);
    return pc ? pc.core_stage === "closed" : false;
  };
  env.fn.project_status_for_stage = (s) => s;
  env.fn.project_progress = () => ({ pct: 10 });

  // project_core_set_stage: الحارس من النصّ الحقيقيّ، ثمّ تحديث آليّ.
  const setStageBody = extractFunction(SQL.EDIT, "project_core_set_stage").body;
  const setStageGuard = guardConditionBefore(setStageBody, "raise exception 'not authorized'");
  env.fn.project_core_set_stage = (p, stage, note) => {
    if (evalCondition(setStageGuard, { fn: env.fn, vars: { p_project: p } }) === true) {
      throw new SqlError("not authorized");
    }
    const pc = db.project_core.find((x) => x.project_id === p);
    if (!pc) throw new SqlError("project_core missing");
    log.stage_calls.push({ project_id: p, to: stage, note, by: state.uid });
    pc.core_stage = stage;
    return pc;
  };

  // ── دوالّ حزمة الانتقال ──────────────────────────────────────────────────
  reg("ptr_current_value", SQL.TR, ["p_kind", "p_project", "p_deliverable"]);
  reg("ptr_target_check", SQL.TR, ["p_kind", "p_project", "p_deliverable", "p_to"]);
  reg("ptr_project_blocked", SQL.TR, ["p_project"]);
  reg("project_transition_can_decide", SQL.TR, ["p_project"]);

  const createRaw = compileVerbose(SQL.TR, "project_transition_request_create");
  const decideRaw = compileVerbose(SQL.TR, "project_transition_request_decide");
  const bulkRaw = compileVerbose(SQL.EDIT, "large_project_deliverables_bulk_update");

  const call = (f, args) => {
    const r = f(env, args);
    if (r.error) throw r.error;
    return r.ret;
  };

  return {
    db, log, env, ACTORS, ids: { P1, P2, P9, D1, D2, C1, C2 },
    /** يبدّل الجلسة إلى فاعل بعينه (auth.uid وحده يتغيّر — لا رايات جانبية). */
    as(name) {
      if (!(name in ACTORS)) throw new Error(`فاعل غير معرَّف: ${name}`);
      state.uid = ACTORS[name].uid;
      return this;
    },
    anon() { state.uid = null; return this; },
    uid: () => state.uid,
    fn: env.fn,
    deliverable: (id) => db.deliverables.find((d) => d.id === id),
    requests: () => db.project_transition_requests,
    /** لقطة قابلة للمقارنة لكلّ ما قد يتغيّر (لإثبات «لم يتغيّر شيء»). */
    snapshot() {
      return JSON.stringify({
        d: db.deliverables, pc: db.project_core, p: db.projects,
        r: db.project_transition_requests.map((r) => [r.id, r.status, r.decided_by, r.executed_at]),
      });
    },
    bulk(args) { return call(bulkRaw, args); },
    bulkVerbose(args) { return bulkRaw(env, args); },
    trCreate(args) { return call(createRaw, args); },
    trCreateVerbose(args) { return createRaw(env, args); },
    trDecide(args) { return call(decideRaw, args); },
    trDecideVerbose(args) { return decideRaw(env, args); },
  };
}

module.exports = { makeWorld, SQL, ACTORS, ACTOR_NAMES, ids: { P1, P2, P9, D1, D2, C1, C2 } };
