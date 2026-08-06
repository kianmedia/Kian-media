// ════════════════════════════════════════════════════════════════════════════
// tests/custody_incidents_mutation.test.js
//
// 🔴 اختبار طفرات: كل حارس يُشوَّه في **نسخة** من الحزمة داخل مجلَّد مؤقّت،
//    ويُشترط أن يرصده المُدقِّق. حارسٌ لا تُثبته طفرةٌ **ليس حارسًا** — قد يكون
//    نصًّا يمرّ عليه كل شيء (وقد حدث ذلك مرّتين في هذا المستودع: تحقّق اشتقّ
//    توقّعه من الملفّ المفحوص، وgrep على الملفّ كلّه بدل القائمة المقصودة).
//
// ⚠️ ولا يُلمَس `docs/` إطلاقًا: النسخ في `fs.mkdtempSync`.
// ⛔ لا قاعدة ولا شبكة ولا SQL يُنفَّذ.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const H = require("./custody_incidents_helpers.js");

const DOCS = path.resolve(__dirname, "..", "docs");

/** ينسخ الحزمة إلى مجلَّد مؤقّت، يطبّق التشويه، يُدقّق، ثمّ ينظّف. */
function mutate(apply) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "civ-inc-mut-"));
  try {
    for (const f of H.PKG_FILES) fs.copyFileSync(path.join(DOCS, f), path.join(dir, f));
    const io = {
      read: (f) => fs.readFileSync(path.join(dir, f), "utf8"),
      write: (f, s) => fs.writeFileSync(path.join(dir, f), s),
      edit: (f, from, to) => {
        const s = fs.readFileSync(path.join(dir, f), "utf8");
        const out = s.replace(from, to);
        assert.notEqual(out, s, `التشويه لم يُطبَّق على ${f} — النمط لم يُطابِق`);
        fs.writeFileSync(path.join(dir, f), out);
      },
    };
    apply(io);
    return H.auditPackage(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** يشترط رصد الطفرة، وبمعرّف العطب المقصود. */
function caught(bad, id, label) {
  assert.ok(bad.length > 0, `🔴 طفرة غير مرصودة: ${label}`);
  assert.ok(bad.some((b) => b.id === id),
    `الطفرة رُصدت لكن بمعرّف آخر (${bad.map((b) => b.id).join(",")}) — المتوقَّع ${id} · ${label}`);
}

// ─── ٠ · خطّ الأساس: بلا تشويه ⇒ لا عطب ───────────────────────────────────
test("خطّ الأساس نظيف (وإلّا فكل طفرة تحته بلا معنى)", () => {
  assert.deepEqual(mutate(() => {}), []);
});

// ─── ١ · أكثر من BEGIN/COMMIT داخل RUNME ──────────────────────────────────
test("طفرة: معاملتان بدل واحدة", () => {
  const bad = mutate((io) => io.edit(H.RUNME,
    "-- ─── §2 · الحوادث والبلاغات", "commit;\nbegin;\n-- ─── §2 · الحوادث والبلاغات"));
  caught(bad, "tx_commit", "COMMIT وسيط يترك الأعمدة والمُشغِّل مطبَّقة بلا RLS");
});

test("طفرة: notify pgrst قبل COMMIT", () => {
  const bad = mutate((io) => {
    let s = io.read(H.RUNME).replace(/notify pgrst, 'reload schema';/, "");
    s = s.replace("commit;", "notify pgrst, 'reload schema';\ncommit;");
    io.write(H.RUNME, s);
  });
  caught(bad, "notify_before_commit", "إشعار المخطّط قبل تثبيت المعاملة");
});

test("طفرة: savepoint يكسر الذرّية", () => {
  const bad = mutate((io) => io.edit(H.RUNME, "-- ─── §1 · Hold على الأصل", "savepoint sp1;\n-- ─── §1"));
  caught(bad, "tx_savepoint", "نقطة حفظ تسمح بتراجع جزئيّ");
});

// ─── ٢ · غياب الحسم في PREFLIGHT/POSTCHECK ────────────────────────────────
test("طفرة: PREFLIGHT يطبع ولا يوقف", () => {
  const bad = mutate((io) => io.write(H.PRE, io.read(H.PRE).replace(/raise\s+exception/gi, "raise notice")));
  caught(bad, "pre_no_hardstop", "🔴 مطبوع مع حالة خروج 0 ⇒ يمضي التشغيل الآليّ");
});

test("طفرة: POSTCHECK يطبع ولا يوقف", () => {
  const bad = mutate((io) => io.write(H.POST, io.read(H.POST).replace(/raise\s+exception/gi, "raise notice")));
  caught(bad, "post_no_hardstop", "تحقّق بلا حالة خروج غير صفرية");
});

// ─── ٣ · to_regproc بتوقيع ⇒ NULL دائمًا ──────────────────────────────────
test("طفرة: to_regprocedure ⇒ to_regproc في PREFLIGHT", () => {
  const bad = mutate((io) => io.write(H.PRE, io.read(H.PRE).replace(/to_regprocedure/g, "to_regproc")));
  caught(bad, "to_regproc_var", "بوّابة موجودة تُبلَّغ «مفقودة» — أو حارس لا يُقيَّم أبدًا");
});

test("طفرة: to_regproc بتوقيع حرفيّ في RUNME", () => {
  const bad = mutate((io) => io.edit(H.RUNME,
    "if to_regprocedure(v_sig) is null", "if to_regproc('public.civ_can_manage()') is null"));
  caught(bad, "to_regproc_sig", "حارس §0 يصير صحيحًا دائمًا");
});

// ─── ٤ · إسقاط اعتماد مطلوب من PREFLIGHT ──────────────────────────────────
test("طفرة: بوّابة مطلوبة تُحذف من PREFLIGHT", () => {
  const bad = mutate((io) => io.write(H.PRE,
    io.read(H.PRE).replace(/'public\.civ_gen_no\(text\)'/g, "'public.civ_can_manage()'")));
  caught(bad, "pre_missing_gate", "اعتماد يشترطه RUNME لا يفحصه PREFLIGHT");
});

test("طفرة: جدول اعتماد يُحذف من PREFLIGHT", () => {
  const bad = mutate((io) => io.write(H.PRE,
    io.read(H.PRE).replace(/'custody_enterprise_settings'/g, "'custody_inventory_assets'")));
  caught(bad, "pre_missing_table", "جدول يقرؤه محرّك التنبيهات ولا يُفحص");
});

// 🔴 عدم الدور: التوقّع من **RUNME**. فإضافة اعتماد إلى RUNME يجب أن تُحمِّر
//    PREFLIGHT غير المعدَّل — لو كان التوقّع مشتقًّا من PREFLIGHT نفسه لمرّت.
test("طفرة (عدم الدور): اعتماد جديد في RUNME ⇒ PREFLIGHT يصير ناقصًا", () => {
  const bad = mutate((io) => io.edit(H.RUNME,
    "'public.custody_audit(text,text,uuid,jsonb)'",
    "'public.custody_audit(text,text,uuid,jsonb)','public.civ_brand_new_gate(uuid)'"));
  caught(bad, "pre_missing_gate", "التوقّعات مشتقّة من الملفّ المفحوص نفسه — اختبار بلا قيمة");
});

// ─── ٥ · التشغيل فوق حالة جزئية مجهولة ────────────────────────────────────
test("طفرة: PREFLIGHT بلا فحص حالة الأعمدة القائمة", () => {
  const bad = mutate((io) => io.write(H.PRE, io.read(H.PRE).replace(/EXISTING_COLUMN_STATE/g, "COLUMN_INFO")));
  caught(bad, "pre_no_column_state", "on_hold قائم بنوع مختلف يمرّ بلا توقّف");
});

test("طفرة: PREFLIGHT بلا فحص المُشغِّل القائم", () => {
  const bad = mutate((io) => io.write(H.PRE, io.read(H.PRE).replace(/EXISTING_TRIGGER_STATE/g, "TRIGGER_INFO")));
  caught(bad, "pre_no_trigger_state", "مُشغِّل بنفس الاسم على جدول آخر يُستبدل بصمت");
});

// ─── ٦ · anon/PUBLIC ──────────────────────────────────────────────────────
test("طفرة: EXECUTE لـanon", () => {
  const bad = mutate((io) => io.edit(H.RUNME,
    "grant execute on function public.custody_inv_employee_report_incident(jsonb) to authenticated;",
    "grant execute on function public.custody_inv_employee_report_incident(jsonb) to authenticated, anon;"));
  caught(bad, "grant_anon", "مجهول يبلّغ حوادث");
});

test("طفرة: SELECT للجداول لـpublic", () => {
  const bad = mutate((io) => io.edit(H.RUNME,
    "grant select on public.custody_incidents, public.custody_incident_actions, public.custody_alert_deliveries to authenticated;",
    "grant select on public.custody_incidents, public.custody_incident_actions, public.custody_alert_deliveries to public;"));
  caught(bad, "grant_anon", "سجلّ الحوادث مقروء للجميع");
});

// ─── ٧ · custody_run_alerts لغير service_role ─────────────────────────────
test("طفرة: محرّك التنبيهات ممنوح لـauthenticated", () => {
  const bad = mutate((io) => io.edit(H.RUNME,
    "grant  execute on function public.custody_run_alerts() to service_role;",
    "grant  execute on function public.custody_run_alerts() to service_role, authenticated;"));
  caught(bad, "run_alerts_grant", "أيّ موظّف يُطلق موجة تنبيهات");
});

test("طفرة: REVOKE ناقص عن authenticated", () => {
  const bad = mutate((io) => io.edit(H.RUNME,
    "revoke execute on function public.civ_alert_once(text,text,text,uuid) from public, anon, authenticated;",
    "revoke execute on function public.civ_alert_once(text,text,text,uuid) from public, anon;"));
  caught(bad, "revoke_partial", "دالّة إزالة التكرار تبقى قابلة للاستدعاء");
});

// ─── ٨ · RLS ──────────────────────────────────────────────────────────────
test("طفرة: RLS مُعطَّل على جدول", () => {
  const bad = mutate((io) => io.edit(H.RUNME,
    "alter table public.custody_alert_deliveries   enable row level security;", ""));
  caught(bad, "rls_off", "سجلّ التسليم بلا حماية صفوف");
});

test("طفرة: سياسة مفتوحة using (true)", () => {
  const bad = mutate((io) => io.edit(H.RUNME,
    "create policy civ_incident_actions_read on public.custody_incident_actions for select to authenticated using (public.civ_can_manage());",
    "create policy civ_incident_actions_read on public.custody_incident_actions for select to authenticated using (true);"));
  caught(bad, "policy_open", "كل مُصادَق يقرأ إجراءات الحوادث");
});

// ─── ٩ · مُشغِّل الحجز ─────────────────────────────────────────────────────
test("طفرة: المُشغِّل محذوف", () => {
  const bad = mutate((io) => io.write(H.RUNME,
    io.read(H.RUNME).replace(/create trigger trg_civ_item_hold[\s\S]*?;\n/, "")));
  caught(bad, "trigger_missing", "أصل محتجز يُصرف عاديًّا");
});

test("طفرة: المُشغِّل على الإدراج وحده (النسخة القديمة)", () => {
  const bad = mutate((io) => io.edit(H.RUNME,
    "before insert or update of asset_id on public.custody_inventory_assignment_items",
    "before insert on public.custody_inventory_assignment_items"));
  caught(bad, "trigger_insert_only", "تغيير asset_id في صفّ قائم يتجاوز الحجز");
});

test("طفرة: المُشغِّل على جدول آخر", () => {
  const bad = mutate((io) => io.edit(H.RUNME,
    "before insert or update of asset_id on public.custody_inventory_assignment_items",
    "before insert or update of asset_id on public.custody_incidents"));
  caught(bad, "trigger_wrong_table", "الحارس على الجدول الخطأ ⇒ لا يحرس شيئًا");
});

// ─── ١٠ · ربط الحادثة بأصل لا يخصّ الموظّف ────────────────────────────────
test("طفرة: أصل + عهدة بلا تحقّق من الانتماء (العيب الأصليّ)", () => {
  const bad = mutate((io) => io.edit(H.RUNME,
    "if not v_asset_is_his then raise exception 'asset_not_in_assignment'; end if;",
    "-- (لا تحقّق)"));
  caught(bad, "link_asset_in_assignment", "حادثة تربط عهدة الموظّف بأصل موظّف آخر");
});

test("طفرة: أصل وحده بلا تحقّق من المالك", () => {
  const bad = mutate((io) => io.edit(H.RUNME,
    "if not v_asset_is_his then raise exception 'asset_not_yours'; end if;", "-- (لا تحقّق)"));
  caught(bad, "link_asset_owner", "بلاغ على أصل عشوائيّ ⇒ حجزه وتعطيل صرفه");
});

test("طفرة: العهدة نفسها بلا تحقّق من الموظّف", () => {
  const bad = mutate((io) => io.write(H.RUNME,
    io.read(H.RUNME).replace(/not_your_assignment/g, "other_error_x")));
  caught(bad, "link_assignment", "بلاغ على عهدة موظّف آخر");
});

// ─── ١١ · رفع الحجز ───────────────────────────────────────────────────────
test("طفرة: رفع الحجز بلا صلاحية", () => {
  const bad = mutate((io) => io.edit(H.RUNME,
    "if not public.civ_can_manage() then raise exception 'not authorized'; end if;\n  if p_status not in",
    "if p_status not in"));
  caught(bad, "release_no_permission", "أيّ مُصادَق يُحرّر أصلًا محتجزًا بعد حادث");
});

test("طفرة: رفع الحجز بلا طلب صريح", () => {
  const bad = mutate((io) => io.edit(H.RUNME,
    "if coalesce(p_release_hold, false) and v_asset is not null then",
    "if v_asset is not null then"));
  caught(bad, "release_not_explicit", "كل إجراء إداريّ يرفع الحجز ضمنًا");
});

test("طفرة: تحرير الحجز يترك hold_reason معلّقًا", () => {
  const bad = mutate((io) => io.edit(H.RUNME,
    "set on_hold = false, hold_reason = null where id = v_asset;",
    "set on_hold = false where id = v_asset;"));
  caught(bad, "hold_reason_stale", "on_hold=false مع سبب حجز باقٍ — حالة متناقضة");
});

test("طفرة: حذف فعليّ بدل is_deleted", () => {
  const bad = mutate((io) => io.edit(H.RUNME,
    "insert into public.custody_incident_actions(incident_id, action_type, note, created_by)",
    "delete from public.custody_incidents where id = p_incident;\n  insert into public.custody_incident_actions(incident_id, action_type, note, created_by)"));
  caught(bad, "hard_delete", "الحوادث تُمحى بدل أن تُؤرشف");
});

// ─── ١٢ · بذور وتنبيهات وcron أثناء التطبيق ───────────────────────────────
test("طفرة: بذرة بيانات داخل RUNME", () => {
  const bad = mutate((io) => io.edit(H.RUNME, "commit;",
    "insert into public.custody_incidents(incident_number, incident_type) values ('INC-DEMO','other');\ncommit;"));
  caught(bad, "seed_data", "بيانات وهمية في قاعدة حيّة");
});

test("طفرة: تشغيل محرّك التنبيهات داخل RUNME", () => {
  const bad = mutate((io) => io.edit(H.RUNME, "commit;", "select public.custody_run_alerts();\ncommit;"));
  caught(bad, "alerts_at_apply", "موجة تنبيهات فعلية لحظة التطبيق");
});

test("طفرة: cron داخل RUNME", () => {
  const bad = mutate((io) => io.edit(H.RUNME, "commit;",
    "select cron.schedule('civ_alerts','0 * * * *','select public.custody_run_alerts()');\ncommit;"));
  caught(bad, "cron", "جدولة تلقائية لم يطلبها أحد");
});

// ─── ١٣ · SECURITY DEFINER ────────────────────────────────────────────────
test("طفرة: SECURITY DEFINER بلا search_path مثبَّت", () => {
  const bad = mutate((io) => io.edit(H.RUNME,
    "create or replace function public.custody_run_alerts() returns jsonb\nlanguage plpgsql security definer set search_path = public as $$",
    "create or replace function public.custody_run_alerts() returns jsonb\nlanguage plpgsql security definer as $$"));
  caught(bad, "search_path", "مسار بحث قابل للاختطاف داخل دالّة مرتفعة الصلاحية");
});

test("طفرة: pg_temp في search_path", () => {
  const bad = mutate((io) => io.edit(H.RUNME,
    "create or replace function public.civ_alert_once(p_key text, p_type text, p_etype text, p_eid uuid) returns boolean\nlanguage plpgsql security definer set search_path = public as $$",
    "create or replace function public.civ_alert_once(p_key text, p_type text, p_etype text, p_eid uuid) returns boolean\nlanguage plpgsql security definer set search_path = public, pg_temp as $$"));
  caught(bad, "pg_temp", "جداول مؤقّتة تسبق العامّة في الحلّ");
});

// ─── ١٤ · POSTCHECK يُثبت فعلًا ───────────────────────────────────────────
test("طفرة: POSTCHECK لا يقيس الصلاحيات الفعلية", () => {
  const bad = mutate((io) => io.write(H.POST,
    io.read(H.POST).replace(/has_function_privilege/g, "pg_proc_acl_note")));
  caught(bad, "post_no_privs", "role_routine_grants وحدها لا تُظهر الصلاحية الفعلية");
});

test("طفرة: POSTCHECK لا يُثبت UPDATE على المُشغِّل", () => {
  const bad = mutate((io) => io.write(H.POST, io.read(H.POST).replace(/tgtype\s*&\s*16/g, "tgtype & 4")));
  caught(bad, "post_no_tgtype", "مُشغِّل مُقلَّص إلى INSERT يمرّ من التحقّق");
});

test("طفرة: POSTCHECK يُهمل دالّة", () => {
  const bad = mutate((io) => io.write(H.POST,
    io.read(H.POST).replace(/civ_item_hold_check/g, "civ_other_fn")));
  caught(bad, "post_missing_fn", "دالّة من الحزمة بلا تحقّق");
});

// ─── ١٥ · ROLLBACK ────────────────────────────────────────────────────────
test("طفرة: ROLLBACK بلا حارس «غير فارغة»", () => {
  const bad = mutate((io) => io.write(H.ROLL, io.read(H.ROLL).replace(/raise\s+exception/gi, "raise notice")));
  caught(bad, "roll_no_guard", "بلاغات حوادث حقيقية تُمحى بلا قرار بشريّ");
});

test("طفرة: ROLLBACK يُسقط on_hold تلقائيًّا", () => {
  const bad = mutate((io) => io.edit(H.ROLL, "commit;",
    "alter table public.custody_inventory_assets drop column on_hold;\ncommit;"));
  caught(bad, "roll_drops_hold", "عمود قد تستعمله حزم أخرى يُسقَط بلا فحص");
});

test("طفرة: ROLLBACK يُسقط جدول حزمة أخرى", () => {
  const bad = mutate((io) => io.edit(H.ROLL, "drop table if exists public.custody_incidents;",
    "drop table if exists public.custody_incidents;\ndrop table if exists public.custody_inventory_assets;"));
  caught(bad, "roll_foreign_table", "تراجعٌ يتجاوز نطاقه إلى جداول العهدة الأساسية");
});
