-- ════════════════════════════════════════════════════════════════════════════
-- global_notifications_projects_batch10_RUNME.sql   (BATCH 10 · PHASE 3 — PROJECTS)
-- كتالوج أحداث المشاريع + فحص دخانيّ للمُحلِّل المركزيّ لهذه الأحداث.
--
-- أحداث المشاريع تُنتَج أصلًا في الطابور email_deliveries عبر pc_event_emit (محفّز
-- project_core) والمسارات المُوحّدة (review/preview/download عبر emitEventEmail).
-- هذا الملفّ لا يُنشئ منتِجًا موازيًا — بل يُوثّق أسماء الأحداث القانونيّة + الجمهور،
-- ويُثبِت أنّ notification_resolve_recipients يعمل لكلّ حدث (يلتقط أيّ انحراف في التوقيع
-- أو المنطق فورًا). Additive · Idempotent · لا mutation · لا إرسال · Self-test داخل DO.
--
-- كتالوج الأحداث (event → entity_type → الجمهور عبر المُحلِّل):
--   project.delivery_recorded      project    إدارة + مدير المشروع + العميل (client-facing)
--   deliverable.preview_sent       deliverable إدارة + مدير المشروع + العميل (client-facing)
--   deliverable.final_ready        deliverable إدارة + مدير المشروع + العميل (client-facing)
--   deliverable.download_recorded  deliverable إدارة + مدير المشروع (غير مواجِه للعميل)
--   deliverable.client_reviewed    deliverable إدارة + مدير المشروع + المكلَّف (عبر payload.direct)
--   project.note_added             project    إدارة + مدير المشروع
--   project.member_assigned        project    إدارة + مدير المشروع + المكلَّف (payload.direct)
-- المستلِمون يُحلّون دائمًا عبر notification_resolve_recipients؛ الإدارة إلزاميّة لكلّ حدث.
-- تشغيل: psql "$DATABASE_URL" -f docs/global_notifications_projects_batch10_RUNME.sql
-- ════════════════════════════════════════════════════════════════════════════

do $pre$
begin
  if to_regprocedure('public.notification_resolve_recipients(text,text,uuid,uuid,uuid,jsonb)') is null then
    raise exception '10.PROJ PREFLIGHT: notification_resolve_recipients missing — run notifications_e2e_repair_batch9d_RUNME.sql';
  end if;
end $pre$;

-- ─── فحص دخانيّ: المُحلِّل يعمل ويُعيد عقد المستلِم لكلّ حدث مشروع (بلا بيانات بذور) ───
do $smoke$
declare
  r record; v_events text[] := array[
    'project.delivery_recorded','deliverable.preview_sent','deliverable.final_ready',
    'deliverable.download_recorded','deliverable.client_reviewed','project.note_added','project.member_assigned'];
  e text; v_pid uuid := gen_random_uuid(); v_eid uuid := gen_random_uuid(); v_cols int;
begin
  foreach e in array v_events loop
    -- (1) يعمل بلا خطأ (يلتقط انحراف التوقيع/المنطق).
    begin
      perform 1 from public.notification_resolve_recipients(e, split_part(e,'.',1), v_eid, v_pid, null, '{}'::jsonb) limit 1;
    exception when others then raise exception '10.PROJ FAIL: resolver errored for event % — %', e, sqlerrm;
    end;
  end loop;

  -- (2) عقد المستلِم: تسع أعمدة قانونيّة موجودة (يلتقط أيّ تغيير في returns table).
  select count(*) into v_cols from (
    select user_id, email, role, recipient_reason, portal_allowed, email_allowed, action_url, locale, dedupe_key
    from public.notification_resolve_recipients('project.note_added','project', v_eid, v_pid, null, '{}'::jsonb) limit 0) z;
  -- (v_cols=0 مقبول؛ الغرض إجبار تحقّق الأعمدة وقت التخطيط.)

  raise notice '10.PROJ SMOKE PASSED — resolver serves all project events with the recipient contract.';
end $smoke$;

notify pgrst, 'reload schema';
