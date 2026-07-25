-- ════════════════════════════════════════════════════════════════════════════
-- project_post_closure_protection_RUNME.sql        (PROJECT PLATFORM V1 CLOSURE)
--
-- المشكلة (مُثبَتة): بعد أن يُغلق المشروع (core_stage='closed') ويُطبع محضر التسليم
-- والقبول ويُوقَّع، يظلّ المشروع **قابلًا للكتابة بالكامل**: مهام، مخرجات، تكاليف،
-- مخاطر، أعضاء، اجتماعات، جلسات، سجلّات وقت. وبما أنّ project_closure_report و
-- project_acceptance_certificate يُحسبان لحظة القراءة، فإنّ إعادة طبع المحضر نفسه قد
-- تختلف عن الأصل الموقَّع **بلا أي أثر يشرح الفرق**. ولا إشارة للمستخدم أصلًا — الكتابة
-- تنجح صامتة.
--
-- العلاج: قفل على مستوى الجدول (لا على مستوى كل RPC) — محفّز واحد مشترك يمنع أي
-- INSERT/UPDATE/DELETE على بيانات مشروع مُغلق، ما لم يملك المنفّذ صلاحية إعادة الفتح.
-- هذا أقوى وأبسط من تعديل عشرات الدوالّ: يُغطّي كذلك الكتابة المباشرة عبر PostgREST.
--
-- ليس منعًا صلبًا: الإدارة (can_manage_projects) تستطيع التصحيح بعد الإغلاق —
-- **وكلّ كتابة مسموحة بعد الإغلاق تُسجَّل في pc_log** فيبقى الفرق عن المحضر مُفسَّرًا.
-- المسار السليم يبقى: طلب إعادة فتح (project_reopen_request_create) ثمّ الاعتماد.
--
-- Additive · Idempotent · Transactional · لا DROP TABLE · لا حذف بيانات · Self-test.
-- التشغيل: psql "$DATABASE_URL" -f docs/project_post_closure_protection_RUNME.sql
-- المتطلّبات: project_core موجود · pc_log موجود · can_manage_projects مُصلَّحة (hardening #1).
-- ════════════════════════════════════════════════════════════════════════════

do $pre$
begin
  if to_regclass('public.project_core') is null then raise exception 'PREFLIGHT: project_core missing'; end if;
  if to_regprocedure('public.pc_log(uuid,text,text,uuid,jsonb)') is null then raise exception 'PREFLIGHT: pc_log missing'; end if;
  if public.can_manage_projects() is null then
    raise exception 'PREFLIGHT: run project_platform_authz_hardening_RUNME.sql first (gates still collapse to NULL)';
  end if;
end $pre$;

begin;

-- ─── §1 هل المشروع مُغلق؟ (مستقرّة، سريعة، تُستخدم داخل المحفّزات) ───
create or replace function public.pc_project_is_closed(p_project uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select core_stage = 'closed' from public.project_core where project_id = p_project), false);
$$;

-- ─── §2 المحفّز المشترك: يمنع الكتابة على مشروع مُغلق، ويُسجّل الاستثناء المسموح ───
-- يعتمد على وجود عمود project_id في الجدول (كل الجداول المُطبَّق عليها تملكه).
create or replace function public.pc_block_writes_when_closed()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_project uuid; v_allowed boolean;
begin
  v_project := case when tg_op = 'DELETE' then (to_jsonb(old)->>'project_id')::uuid
                    else (to_jsonb(new)->>'project_id')::uuid end;
  if v_project is null then return case when tg_op = 'DELETE' then old else new end; end if;
  if not public.pc_project_is_closed(v_project) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  -- المشروع مُغلق. الاستثناء الوحيد: من يملك إدارة المشاريع (صلاحية التصحيح/إعادة الفتح).
  v_allowed := coalesce(public.can_manage_projects(), false);
  if not v_allowed then
    raise exception 'project_closed'
      using hint = 'اطلب إعادة فتح المشروع (project_reopen_request_create) ثمّ اعتمِدها قبل التعديل.';
  end if;

  -- كتابة مسموحة بعد الإغلاق ⇒ تُسجَّل دائمًا كي يبقى الفرق عن المحضر الموقَّع مُفسَّرًا.
  begin
    perform public.pc_log(v_project, 'post_closure_write', tg_table_name,
      case when tg_op = 'DELETE' then (to_jsonb(old)->>'id')::uuid else (to_jsonb(new)->>'id')::uuid end,
      jsonb_build_object('op', tg_op, 'table', tg_table_name));
  exception when others then null;   -- التسجيل لا يُفشل التصحيح
  end;

  return case when tg_op = 'DELETE' then old else new end;
end $$;

-- ─── §3 تركيب المحفّز على جداول بيانات المشروع (idempotent) ───
do $mk$
declare t text;
  v_tables text[] := array[
    'project_tasks', 'deliverables', 'deliverable_versions', 'project_costs',
    'project_expenses', 'project_risks', 'project_issues', 'project_decisions',
    'project_meetings', 'project_shoot_sessions', 'project_locations',
    'project_time_logs', 'project_members', 'project_change_requests',
    'project_schedule_items', 'preproduction_items'
  ];
begin
  foreach t in array v_tables loop
    if to_regclass('public.' || t) is null then continue; end if;
    -- الجدول يجب أن يملك project_id، وإلّا نتخطّاه بأمان.
    if not exists (select 1 from information_schema.columns
                   where table_schema = 'public' and table_name = t and column_name = 'project_id') then
      raise notice 'POST-CLOSURE: skipping % (no project_id column)', t; continue;
    end if;
    execute format('drop trigger if exists trg_pc_closed_guard on public.%I', t);
    execute format(
      'create trigger trg_pc_closed_guard before insert or update or delete on public.%I '
      'for each row execute function public.pc_block_writes_when_closed()', t);
  end loop;
end $mk$;

-- ─── §4 الصلاحيات ───
do $g$
begin
  execute 'revoke all on function public.pc_project_is_closed(uuid) from public';
  begin execute 'revoke all on function public.pc_project_is_closed(uuid) from anon'; exception when undefined_object then null; end;
  begin execute 'grant execute on function public.pc_project_is_closed(uuid) to authenticated'; exception when undefined_object then null; end;
  begin execute 'grant execute on function public.pc_project_is_closed(uuid) to service_role'; exception when undefined_object then null; end;
end $g$;

-- ════════════════════════════════════════════════════════════════════════════
-- SELF-TEST — يرفع «POST-CLOSURE FAIL …»
-- ════════════════════════════════════════════════════════════════════════════
do $selftest$
declare v_n int;
begin
  if to_regprocedure('public.pc_project_is_closed(uuid)') is null then raise exception 'POST-CLOSURE FAIL: helper missing'; end if;
  if public.pc_project_is_closed(gen_random_uuid()) is null then raise exception 'POST-CLOSURE FAIL: helper returns NULL'; end if;
  if public.pc_project_is_closed(gen_random_uuid()) is true then raise exception 'POST-CLOSURE FAIL: unknown project reported closed'; end if;

  select count(*) into v_n from pg_trigger where tgname = 'trg_pc_closed_guard' and not tgisinternal;
  if v_n = 0 then raise exception 'POST-CLOSURE FAIL: no guard triggers installed'; end if;
  raise notice 'POST-CLOSURE: guard installed on % table(s).', v_n;

  -- الجداول الجوهريّة يجب أن تكون محميّة فعلًا.
  if not exists (select 1 from pg_trigger tg join pg_class c on c.oid = tg.tgrelid
                 where tg.tgname = 'trg_pc_closed_guard' and c.relname = 'deliverables')
    then raise exception 'POST-CLOSURE FAIL: deliverables is not guarded'; end if;
  if not exists (select 1 from pg_trigger tg join pg_class c on c.oid = tg.tgrelid
                 where tg.tgname = 'trg_pc_closed_guard' and c.relname = 'project_tasks')
    then raise exception 'POST-CLOSURE FAIL: project_tasks is not guarded'; end if;

  if has_function_privilege('anon', 'public.pc_project_is_closed(uuid)', 'EXECUTE')
    then raise exception 'POST-CLOSURE FAIL: helper must not be anon-callable'; end if;

  raise notice 'POST-CLOSURE SELF-TEST PASSED — closed projects are write-protected; permitted corrections are logged.';
end $selftest$;

commit;

notify pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- VERIFICATION
--   1) الجداول المحميّة:
--      select c.relname from pg_trigger tg join pg_class c on c.oid = tg.tgrelid
--       where tg.tgname='trg_pc_closed_guard' order by 1;
--   2) على مشروع مُغلق، حاول من البوابة تعديل مهمة بحساب موظّف (غير إدارة):
--      المتوقّع: رسالة "project_closed" مع تلميح طلب إعادة الفتح.
--   3) تصحيح إداريّ بعد الإغلاق يُسجَّل:
--      select action, entity_type, created_at from public.project_activity
--       where action='post_closure_write' order by created_at desc limit 10;
--   4) بعد اعتماد إعادة الفتح تعود الكتابة طبيعيّة (core_stage لم يعد 'closed').
--
-- ROLLBACK / RECOVERY
--   • إضافيّ بحت: لا حذف بيانات ولا DROP TABLE.
--   • للتراجع الكامل:
--       do $$ declare t text; begin
--         foreach t in array array['project_tasks','deliverables','deliverable_versions','project_costs',
--           'project_expenses','project_risks','project_issues','project_decisions','project_meetings',
--           'project_shoot_sessions','project_locations','project_time_logs','project_members',
--           'project_change_requests','project_schedule_items','preproduction_items'] loop
--           execute format('drop trigger if exists trg_pc_closed_guard on public.%I', t);
--         end loop; end $$;
--   • ملاحظة تشغيليّة: إن ظهر 'project_closed' لمستخدم يجب أن يعدّل فعلًا، فالمسار الصحيح
--     هو إعادة الفتح بسبب مسجَّل — لا إسقاط المحفّز.
-- ════════════════════════════════════════════════════════════════════════════
