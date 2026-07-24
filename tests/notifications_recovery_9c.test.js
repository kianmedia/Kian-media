// ════════════════════════════════════════════════════════════════════════════
// tests/notifications_recovery_9c.test.js — BATCH 9 · Part 3
// تحليل ساكن (بلا قاعدة بيانات، بلا بريد فعليّ) يؤكّد أنّ استعادة الإشعارات:
//   • تركيبيّة فوق النظام القائم (لا جدول إشعارات ثالث، لا نظام موازٍ).
//   • تعالج نقاط الانقطاع المُثبَتة (queued-nowhere/channel-state/scans/triggers).
//   • بوعي الأدوار (لا تسريب للعميل؛ مستلِمون داخليّون فقط في ماسحات الحوكمة/SLA).
//   • لا تُفشل العملية الأساسية (Triggers محاطة بحارس)، ولا تُرسل بريدًا أثناء الاختبار.
// ════════════════════════════════════════════════════════════════════════════
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const R = (p) => fs.readFileSync(path.join(root, p), "utf8");

const SQL = R("docs/notifications_recovery_batch9c_RUNME.sql");
const ROUTE = R("app/api/cron/notify-email/route.ts");
const WRAP = R("lib/portal/projectCore.ts");
const UI = R("components/portal/projectcore/NotifyMonitor.tsx");

// يجرّد تعليقات SQL السطرية (-- إلى نهاية السطر) كي لا تُطابق كلماتٌ عربية داخل
// التعليقات رموزًا محظورة عند فحص المتن الفعليّ.
const codeOf = (sql) => sql.split("\n").map((l) => {
  const i = l.indexOf("--");
  return i >= 0 ? l.slice(0, i) : l;
}).join("\n");

// يستخرج متن دالة مُعرّفة بـ$$…$$ (النداءات الداخلية تستخدم $q$ فلا تتعارض).
// يقبل «function public.NAME(...)» أو الاسم المجرّد — يطابق تعريف CREATE بالاسم
// (لأنّ الإعلان يستخدم أسماء المعاملات لا أنواعها، بينما REVOKE يستخدم الأنواع).
function fnBody(sql, sig) {
  const name = sig.replace(/^function\s+public\./, "").replace(/\(.*$/, "");
  const i = sql.indexOf("function public." + name + "(");
  if (i < 0) return "";
  const open = sql.indexOf("$$", i);
  const close = sql.indexOf("$$", open + 2);
  return sql.slice(open + 2, close);
}

const CODE = codeOf(SQL);

// ─── 1. بنية RUNME الأساسية ───
test("RUNME: preflight + transactional + self-test + schema reload", () => {
  assert.match(SQL, /do \$pre\$/, "preflight block");
  assert.match(SQL, /9C PREFLIGHT:/, "preflight raises on missing base");
  assert.match(SQL, /\bbegin;/, "explicit begin");
  assert.match(SQL, /\bcommit;/, "explicit commit");
  assert.match(SQL, /9C FAIL/, "self-test raises 9C FAIL");
  assert.match(SQL, /notify pgrst, 'reload schema'/, "PostgREST schema reload");
});

// ─── 2. تركيبيّ: يعيد استخدام النظام القائم، لا جدول إشعارات ثالثًا ───
test("composition: reuses existing inbox/outbox/queue, no third notifications table", () => {
  for (const tbl of ["public.notifications", "public.notification_events", "public.email_deliveries", "public.reminder_tracking"]) {
    assert.ok(SQL.includes(tbl), `reuses ${tbl}`);
  }
  // لا ينشئ جدول إشعارات جديدًا — الوحيد المُنشأ تِلِمِتري (notification_cron_runs).
  const created = [...CODE.matchAll(/create table if not exists (public\.\w+)/g)].map((m) => m[1]);
  assert.deepStrictEqual(created, ["public.notification_cron_runs"], "only telemetry table is created");
  assert.ok(!/create table[^;]*public\.notifications\b/.test(CODE), "does not recreate a notifications table");
  // يبثّ عبر المحرّك القائم لا مسارًا موازيًا.
  assert.ok(SQL.includes("public.pc_event_emit("), "emits via existing pc_event_emit engine");
});

// ─── 3. §0 إنهاء انجراف قيد النوع — حارس صيغة متساهل لا enum ثابت ───
test("§0: notifications.type CHECK becomes a lenient format guard (ends the drift war)", () => {
  const guard = fnBodyDollar(SQL, "$type_guard$");
  assert.ok(guard.includes("drop constraint if exists notifications_type_check"), "drops the drifting enum check");
  assert.ok(guard.includes("~ '^[a-z][a-z0-9_]{2,60}$'"), "adds a format regex, not a fixed enum list");
  // توسيع لا تضييق: يحمي الصفوف الشاذّة (لا حذف بيانات ولا فشل هجرة).
  assert.ok(guard.includes("type !~") && guard.includes("raise notice"), "guarded against nonconforming rows (no data loss)");
});

// ─── 4. Observability: نبضة + مراقب v2 يغطّي الرحلة كاملة ───
test("observability: cron heartbeat table + recorder (service-only)", () => {
  assert.ok(SQL.includes("create table if not exists public.notification_cron_runs"), "heartbeat table");
  assert.match(SQL, /policy ncr_admin_read on public\.notification_cron_runs[\s\S]*can_manage_projects\(\)/, "admin-only RLS read");
  const rec = fnBody(SQL, "function public.pc_notify_cron_record(text,boolean,jsonb,text)");
  assert.ok(rec.includes("insert into public.notification_cron_runs"), "records a run");
  assert.ok(rec.includes("offset 300"), "prunes to last 300 runs");
  // خدمة فقط: محرومة من authenticated في كتلة الصلاحيات.
  assert.ok(SQL.includes("public.pc_notify_cron_record(text,boolean,jsonb,text)"), "listed for revoke");
});

test("observability: monitor v2 admin-gated + full-journey fields (not queue-only)", () => {
  const m = fnBody(SQL, "function public.pc_notify_monitor_v2(int)");
  assert.ok(m.includes("can_manage_projects()"), "admin-gated");
  for (const field of ["queued_nowhere", "dead_letter", "retrying", "disabled_pending", "channel_state",
    "by_severity", "by_event", "portal_inbox", "last_run"]) {
    assert.ok(m.includes(field), `monitor exposes ${field}`);
  }
  // queued-nowhere = أحداث Outbox بلا صفّ بريد (ما لا يراه v1).
  assert.ok(m.includes("not exists (select 1 from public.email_deliveries d where d.event_id = e.id)"),
    "queued_nowhere = outbox events with no email row");
  // حالة القناة تُشتقّ من نبضة/صفوف disabled — لا تقرأ env (SQL لا يملك env).
  assert.ok(m.includes("disabled_pending") && m.includes("email_enabled"), "channel_state derived from heartbeat + stuck rows");
});

// ─── 5. منتِجون مفقودون — ماسحات service-only تبثّ عبر المحرّك القائم ───
test("scans: governance + SLA exist, service-only, dedup via reminder_tracking", () => {
  for (const sig of ["function public.pc_governance_alerts_scan()", "function public.pc_program_sla_scan()"]) {
    const b = fnBody(SQL, sig);
    assert.ok(b.length > 0, `${sig} defined`);
    assert.ok(b.includes("pc_event_emit("), `${sig} emits via engine`);
    assert.ok(b.includes("reminder_tracking"), `${sig} dedups`);
    assert.ok(b.includes("not authorized") || b.includes("can_manage_projects"), `${sig} gated`);
  }
  // خدمة فقط: كلاهما محروم من authenticated (لا سطح إساءة استدعاء).
  const grants = fnBodyDollar(SQL, "$grants$");
  assert.ok(grants.includes("pc_governance_alerts_scan()"), "governance scan revoked from authenticated");
  assert.ok(grants.includes("pc_program_sla_scan()"), "sla scan revoked from authenticated");
});

test("scans: guarded so they no-op when a subsystem is absent", () => {
  const gov = fnBody(SQL, "function public.pc_governance_alerts_scan()");
  assert.ok(gov.includes("to_regclass('public.project_issues')"), "issues loop guarded (5A optional)");
  const sla = fnBody(SQL, "function public.pc_program_sla_scan()");
  assert.ok(sla.includes("to_regclass('public.project_program_commitments')"), "sla guarded on 8D table");
  assert.ok(sla.includes("sla_not_installed"), "sla returns skipped when 8D absent");
});

// ─── 6. بوعي الأدوار: ماسحات الحوكمة/SLA لا تسرّب للعميل ───
test("role-aware: governance/SLA recipients are internal only — never a client", () => {
  for (const sig of ["function public.pc_governance_alerts_scan()", "function public.pc_program_sla_scan()"]) {
    const b = codeOf(fnBody(SQL, sig));
    assert.ok(!b.includes("project_client_user_ids"), `${sig} never targets client allowlist`);
    assert.ok(b.includes("account_type = 'admin'"), `${sig} targets admins`);
    assert.ok(b.includes("'kian_manager'"), `${sig} targets kian_manager (staff)`);
  }
});

test("role-aware: a policy reference documents all four roles", () => {
  const p = fnBody(SQL, "function public.pc_notification_policy()");
  for (const role of ["owner_admin", "employee", "client", "renter"]) {
    assert.ok(p.includes(role), `policy names ${role}`);
  }
  assert.ok(p.includes("kian_%") && p.includes("project_client_user_ids"),
    "policy states the enforcing mechanisms");
});

// ─── 7. ردّ العميل → إشعار المكلَّف (لا بثّ admin أعمى)، بلا إفشال المراجعة ───
test("client-response: complementary triggers notify the deliverable assignee", () => {
  const rev = fnBody(SQL, "function public.pc_review_notify_assignee()");
  assert.ok(rev.includes("d.assignee_id"), "reads the deliverable assignee");
  assert.ok(rev.includes("array[v_assignee]"), "targets the assignee, not an admin broadcast");
  assert.ok(rev.includes("exception when others then return new"), "notification never fails the review");
  const dl = fnBody(SQL, "function public.pc_download_notify_assignee()");
  assert.ok(dl.includes("new.asset_kind") && dl.includes("'final'"), "download trigger scoped to final");
  assert.ok(dl.includes("exception when others then return new"), "notification never fails the download");
  // مُربوطة محميًّا بوجود الجدول (idempotent: drop trigger if exists قبل create).
  assert.ok(SQL.includes("to_regclass('public.deliverable_reviews')"), "review trigger guarded");
  assert.ok(SQL.includes("drop trigger if exists trg_review_notify_assignee"), "idempotent trigger");
});

// ─── 8. رحلة المستأجر — Trigger واحد يُغلق الفجوات الأربع، بلا مساس بأيّ RPC ───
test("renter-journey: one additive trigger closes contracted/active/overdue/closed gaps", () => {
  const rn = fnBody(SQL, "function public.rental_notify_renter_transition()");
  assert.ok(rn.includes("new.status is not distinct from old.status"), "fires only on real status change");
  // يجب أن يراقب الحالة الحيّة contract_pending_signature (لا 'contracted' القديمة الميتة فقط).
  for (const st of ["contract_pending_signature", "active", "overdue", "closed"]) {
    assert.ok(rn.includes(`'${st}'`), `handles live ${st} transition`);
  }
  assert.ok(rn.includes("'rental_contract_ready'") && rn.includes("contract_pending_signature"),
    "contract-ready branch keyed on the live status, not the dead legacy 'contracted'");
  assert.ok(rn.includes("custody_rental_customers") && rn.includes("c.user_id"), "resolves renter via customer.user_id");
  assert.ok(rn.includes("if v_user is null then return new"), "walk-in renter (no portal account) is safe");
  assert.ok(rn.includes("civ_notify("), "uses existing rental notify helper (portal-only for rental_)");
  assert.ok(rn.includes("exception when others then return new"), "never fails the rental transition");
  assert.ok(SQL.includes("after update of status on public.custody_rental_requests"), "scoped AFTER UPDATE OF status");
});

// ─── 9. توصيل الكرون: الماسحات الثلاث + النبضة، مع إبقاء بوابة البريد كما هي ───
test("cron wiring: resource + governance + sla scans invoked, heartbeat recorded", () => {
  assert.ok(ROUTE.includes('rpcAsService') && ROUTE.includes('"resource_alerts_scan"'), "invokes resource_alerts_scan");
  assert.ok(ROUTE.includes("alerts_emitted"), "reads resource scan's alerts_emitted key");
  assert.ok(ROUTE.includes('"pc_governance_alerts_scan"'), "invokes governance scan");
  assert.ok(ROUTE.includes('"pc_program_sla_scan"'), "invokes sla scan");
  assert.ok(ROUTE.includes('"pc_notify_cron_record"'), "records heartbeat");
  assert.ok(ROUTE.includes("p_stats: stats"), "heartbeat carries run stats");
});

test("cron wiring: email gate present — no secret/env forcing in 9C", () => {
  // Batch 9D refactor: the queue drain (sendProjectEmail) moved into the shared
  // lib/server/notifyWorker; the cron still reports the gate via projectEmailEnabled.
  // (9D deliberately flips that gate to opt-out — a code change, not an env change.)
  assert.ok(ROUTE.includes("projectEmailEnabled"), "cron reports the email-channel gate");
  assert.ok(ROUTE.includes("notifyWorker") || ROUTE.includes("processQueue"), "queue drained via the shared worker");
  // 9C never force-enables via env or writes secrets/env vars.
  assert.ok(!/PROJECT_EMAIL_ALERTS_ENABLED\s*=\s*["']true["']/.test(ROUTE), "does not force-enable email");
  assert.ok(!SQL.includes("PROJECT_EMAIL_ALERTS_ENABLED"), "9C SQL never touches env");
});

// ─── 10. الواجهة: مراقب v2 مع تراجُع، وشرائح الرحلة، مع إبقاء إعادة/إلغاء ───
test("UI: monitor consumes v2 with graceful v1 fallback + journey health", () => {
  assert.ok(UI.includes("pcNotifyMonitorV2"), "uses v2");
  assert.ok(UI.includes("pcNotifyMonitor(") && UI.includes("legacy"), "falls back to v1 when 9C unapplied");
  assert.ok(UI.includes("channel_state") || UI.includes("chBanner"), "renders channel-state banner");
  for (const chip of ["queued_nowhere", "dead_letter", "retrying"]) {
    assert.ok(UI.includes(chip), `renders ${chip} health chip`);
  }
  assert.ok(UI.includes("last_run") && UI.includes("resourceAlerts"), "renders cron heartbeat");
  assert.ok(UI.includes("pcEmailRetry") && UI.includes("pcEmailCancel"), "keeps retry/cancel actions");
});

test("UI wrapper: v2 type + fetcher exported, v1 monitor left intact (additive)", () => {
  assert.ok(WRAP.includes("interface NotifyMonitorV2"), "v2 type exported");
  assert.ok(WRAP.includes("pcNotifyMonitorV2"), "v2 fetcher exported");
  for (const f of ["queued_nowhere", "dead_letter", "channel_state", "last_run", "by_severity"]) {
    assert.ok(WRAP.includes(f), `v2 type carries ${f}`);
  }
  // v1 لم يُلمَس (توافقيّ): pc_notify_monitor يبقى.
  assert.ok(WRAP.includes('prpc<NotifyMonitorData>("pc_notify_monitor"'), "v1 fetcher untouched");
  assert.ok(SQL.includes("pc_notify_monitor_v2") && !SQL.includes("drop function") , "v2 is additive, no drops");
});

// ─── 11. سلامة التسليم: لا مسار بريد موازٍ يتخطّى القيد الفريد ───
test("delivery integrity: no parallel email path — all email flows through pc_event_emit/email_deliveries", () => {
  // الماسحات/الـTriggers لا تُدرج في email_deliveries مباشرة — تبثّ عبر المحرّك.
  for (const sig of ["function public.pc_governance_alerts_scan()", "function public.pc_program_sla_scan()",
    "function public.pc_review_notify_assignee()", "function public.pc_download_notify_assignee()"]) {
    const b = fnBody(SQL, sig);
    assert.ok(!b.includes("insert into public.email_deliveries"), `${sig} does not bypass the queue`);
  }
  // Idempotency: كل بثّ يمرّر مفتاحًا (dedup على مستوى الحدث).
  const rev = fnBody(SQL, "function public.pc_review_notify_assignee()");
  assert.ok(rev.includes("'client_review:' || new.id"), "review emit carries an idempotency key");
});

// ─── 12. لا يفتعل بريدًا أثناء الاختبار (ثابت بطبيعته) ───
test("test safety: purely static — only node builtins required, no server/network imports", () => {
  const self = R("tests/notifications_recovery_9c.test.js");
  const requires = [...self.matchAll(/require\(["']([^"']+)["']\)/g)].map((m) => m[1]);
  const allow = new Set(["node:test", "node:assert", "node:fs", "node:path"]);
  for (const r of requires) assert.ok(allow.has(r), `only static builtins required (got ${r})`);
  assert.ok(requires.length > 0, "the test does require node builtins");
});

// دالّة مساعدة: تستخرج متن كتلة do $tag$ … $tag$.
function fnBodyDollar(sql, tag) {
  const i = sql.indexOf(tag);
  if (i < 0) return "";
  const j = sql.indexOf(tag, i + tag.length);
  return sql.slice(i + tag.length, j);
}
