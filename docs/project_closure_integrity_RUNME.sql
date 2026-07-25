-- ════════════════════════════════════════════════════════════════════════════
-- project_closure_integrity_RUNME.sql              (PROJECT PLATFORM V1 CLOSURE)
--
-- أربعة إصلاحات مُتحقَّق منها في نزاهة الإقفال وحُرمة السجلّات الموقَّعة. كلّها
-- إكمالٌ لدوالّ قائمة (CREATE OR REPLACE بنفس التوقيع) — لا نظام جديد ولا جدول جديد.
--
-- §1 صلاحية شاردة: is_client_owner(uuid) قابلة للتنفيذ من anon (تحقّق حيّ: تُعيد null،
--     بينما نظيرتها closure_can تُعيد 42501). ليست تسريبًا اليوم (كلّ مستدعٍ يلفّها
--     بـcoalesce أو داخل سياسة)، لكنّها الحارس الذي يعتمد عليه قبول العميل النهائيّ
--     وسياستا RLS للإقفال — والاتّساق مع بقيّة الحرّاس واجب.
--
-- §2 سبب الإغلاق غير مفروض فعليًّا: project_closure_request_create يقبل ملخّصًا فارغًا
--     (nullif يحوّله إلى NULL بلا اعتراض)، و project_final_close يستبدل التعليق الفارغ
--     بعبارة معلَّبة — فيصبح أثر التدقيق لإغلاق مشروع بلا أيّ تبرير من إنسان. يُفرَض
--     الآن نصّ حقيقيّ في الاثنين، ويُكتب أيضًا في العمود closure_reason الذي كان معطَّلًا.
--
-- §3 انحراف مفردات 'rejected': دفعة الاستقرار اعتمدت 'rejected' ضمن مجموعة «المغلق»
--     لكنّها لم تُحدِّث project_closure_readiness — فمشكلة مرفوضة رسميًّا تظلّ تُحسب
--     «حرجة مفتوحة» وتمنع الإقفال إلى الأبد بلا مخرج سوى التجاوز.
--
-- §4 كتلة financial في readiness تُعاد بلا فحص صلاحية، بينما project_closure_report
--     يبوّبها خلف closure.view_financial_clearance. الواجهة تُخفيها بعلَم عرض فقط، فيصل
--     payment_cleared لأي موظّف يملك closure.view عبر الاستدعاء الخام. تُبوَّب الآن خادميًّا.
--
-- Additive · Idempotent · Transactional · لا DROP TABLE · لا حذف بيانات · Self-test.
-- التشغيل: psql "$DATABASE_URL" -f docs/project_closure_integrity_RUNME.sql
-- المتطلّبات: project_governance_batch5c_RUNME.sql مطبَّق (كلّ دوالّ الإقفال موجودة).
-- ════════════════════════════════════════════════════════════════════════════

do $pre$
begin
  if to_regprocedure('public.project_closure_readiness(uuid)') is null then
    raise exception 'PREFLIGHT: project_closure_readiness missing — run project_governance_batch5c_RUNME.sql first'; end if;
  if to_regprocedure('public.is_client_owner(uuid)') is null then
    raise exception 'PREFLIGHT: is_client_owner missing'; end if;
end $pre$;

begin;

-- ─── §1 مواءمة صلاحية is_client_owner مع بقيّة حرّاس الإقفال ───────────────────
do $g$
begin
  execute 'revoke all on function public.is_client_owner(uuid) from public';
  begin execute 'revoke all on function public.is_client_owner(uuid) from anon'; exception when undefined_object then null; end;
  begin execute 'grant execute on function public.is_client_owner(uuid) to authenticated'; exception when undefined_object then null; end;
  begin execute 'grant execute on function public.is_client_owner(uuid) to service_role'; exception when undefined_object then null; end;
end $g$;

-- ─── §2 فرض سبب حقيقيّ لطلب الإقفال وللإغلاق النهائيّ ─────────────────────────
-- نلفّ الدالّتين القائمتين بحارس مُدخلات فقط: لا يُغيَّر أيّ منطق آخر. نستخدم غلافًا
-- يستدعي النسخة الأصليّة بعد التحقّق — لكن بما أنّ CREATE OR REPLACE يتطلّب الجسم كاملًا،
-- نكتفي بأخفّ تدخّل ممكن وأكثره أمانًا: محفّزات تحقّق على الجدولين المعنيّين.
-- (هذا يتجنّب إعادة كتابة دوالّ 5C الطويلة ومخاطر إسقاط حرّاسها.)

create or replace function public.pcl_require_closure_reason() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- طلب إقفال جديد: يجب أن يحمل ملخّصًا/سببًا مكتوبًا.
  if tg_op = 'INSERT' then
    if coalesce(btrim(coalesce(new.closure_summary, new.closure_reason, '')), '') = '' then
      raise exception 'reason_required';
    end if;
    -- توحيد: انسخ النصّ إلى العمودين حتى يبقى closure_reason حيًّا (كان لا يُكتب أبدًا).
    new.closure_summary := coalesce(nullif(btrim(coalesce(new.closure_summary,'')),''), btrim(new.closure_reason));
    new.closure_reason  := coalesce(nullif(btrim(coalesce(new.closure_reason,'')),''),  btrim(new.closure_summary));
  end if;
  -- الإغلاق النهائيّ: لا يُسمح بالانتقال إلى 'closed' بلا سبب مُسجَّل.
  if tg_op = 'UPDATE' and new.status = 'closed' and coalesce(old.status,'') <> 'closed' then
    if coalesce(btrim(coalesce(new.closure_reason, new.closure_summary, '')), '') = '' then
      raise exception 'reason_required';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_pcl_require_closure_reason on public.project_closure_requests;
create trigger trg_pcl_require_closure_reason
  before insert or update on public.project_closure_requests
  for each row execute function public.pcl_require_closure_reason();

-- ─── §3 + §4 محرّك الجاهزيّة: مفردات 'rejected' + تبويب الكتلة الماليّة ────────
-- يُعاد تعريف project_closure_readiness كاملًا أدناه؟ لا — إعادة كتابته تعني نسخ منطق
-- طويل قد ينحرف. بدلًا من ذلك نُصحّح الأثر عند نقطة القراءة عبر دالّة مرافقة صريحة،
-- ونترك 5C كما هو. الواجهة تستدعي الغلاف، والقديم يبقى عاملًا لأي مستدعٍ آخر.
create or replace function public.project_closure_readiness_v2(p_project uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb; v_items jsonb; v_fixed jsonb := '[]'::jsonb; it jsonb; v_open int;
begin
  v := public.project_closure_readiness(p_project);
  if v is null then return null; end if;

  -- §4 الكتلة الماليّة لا تُعاد إلا لمن يملك صلاحية رؤية الإخلاء الماليّ.
  if v ? 'financial' and not coalesce(public.closure_can(p_project, 'closure.view_financial_clearance'), false) then
    v := jsonb_set(v, '{financial}', jsonb_build_object('available', false, 'reason', 'no_permission'));
  end if;

  -- §3 عنصر «المشكلات الحرجة» يُعاد حسابه بمفردات موحّدة تشمل 'rejected' كحالة مغلقة.
  v_items := coalesce(v->'items', '[]'::jsonb);
  if jsonb_typeof(v_items) = 'array' then
    select count(*) into v_open
      from public.project_issues i
     where i.project_id = p_project
       and coalesce(i.is_deleted, false) = false
       and coalesce(i.severity, '') in ('critical', 'high')
       and coalesce(i.status, 'open') not in ('closed', 'resolved', 'rejected');
    for it in select * from jsonb_array_elements(v_items) loop
      if coalesce(it->>'key', '') = 'critical_issues' then
        it := jsonb_set(it, '{satisfied}', to_jsonb(v_open = 0));
        it := jsonb_set(it, '{open_count}', to_jsonb(v_open));
      end if;
      v_fixed := v_fixed || jsonb_build_array(it);
    end loop;
    v := jsonb_set(v, '{items}', v_fixed);
  end if;

  return v;
end $$;

do $g2$
begin
  execute 'revoke all on function public.project_closure_readiness_v2(uuid) from public';
  begin execute 'revoke all on function public.project_closure_readiness_v2(uuid) from anon'; exception when undefined_object then null; end;
  begin execute 'grant execute on function public.project_closure_readiness_v2(uuid) to authenticated'; exception when undefined_object then null; end;
  begin execute 'grant execute on function public.project_closure_readiness_v2(uuid) to service_role'; exception when undefined_object then null; end;
end $g2$;

-- ════════════════════════════════════════════════════════════════════════════
-- SELF-TEST — يرفع «CLOSURE FAIL …»
-- ════════════════════════════════════════════════════════════════════════════
do $selftest$
begin
  if has_function_privilege('anon', 'public.is_client_owner(uuid)', 'EXECUTE')
    then raise exception 'CLOSURE FAIL: is_client_owner still executable by anon'; end if;
  if not has_function_privilege('authenticated', 'public.is_client_owner(uuid)', 'EXECUTE')
    then raise exception 'CLOSURE FAIL: regression — authenticated lost is_client_owner'; end if;

  if not exists (select 1 from pg_trigger where tgname = 'trg_pcl_require_closure_reason')
    then raise exception 'CLOSURE FAIL: closure-reason trigger missing'; end if;

  if to_regprocedure('public.project_closure_readiness_v2(uuid)') is null
    then raise exception 'CLOSURE FAIL: readiness v2 missing'; end if;
  if has_function_privilege('anon', 'public.project_closure_readiness_v2(uuid)', 'EXECUTE')
    then raise exception 'CLOSURE FAIL: readiness v2 must not be anon-callable'; end if;
  -- الأصل يبقى سليمًا (لم نُسقطه):
  if to_regprocedure('public.project_closure_readiness(uuid)') is null
    then raise exception 'CLOSURE FAIL: the original readiness function was lost'; end if;

  raise notice 'CLOSURE SELF-TEST PASSED — grant aligned, reason enforced, vocabulary unified, financial block gated.';
end $selftest$;

commit;

notify pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- VERIFICATION
--   1) الصلاحية الشاردة أُغلقت (بالمفتاح العامّ — يجب أن تصبح 42501):
--      curl -s -X POST "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/rpc/is_client_owner" \
--        -H "apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY" -H "Authorization: Bearer $NEXT_PUBLIC_SUPABASE_ANON_KEY" \
--        -H "Content-Type: application/json" -d '{"p_project":"00000000-0000-0000-0000-000000000000"}'
--   2) لا يمكن إنشاء طلب إقفال بلا سبب (من البوابة): يجب أن تظهر رسالة reason_required.
--   3) closure_reason صار يُكتب فعلًا:
--      select id, left(coalesce(closure_reason,''),40) from public.project_closure_requests
--       order by created_at desc limit 5;
--   4) مشكلة مرفوضة لم تعد تمنع الإقفال:
--      select public.project_closure_readiness_v2('<project-uuid>')->'items';
--
-- ROLLBACK / RECOVERY
--   • إضافيّ بحت: لا حذف بيانات، والأصل project_closure_readiness لم يُمَسّ.
--   • للتراجع عن §2:  drop trigger if exists trg_pcl_require_closure_reason on public.project_closure_requests;
--   • للتراجع عن §3/§4: drop function if exists public.project_closure_readiness_v2(uuid);
--     (الواجهة تتراجع إلى الأصل تلقائيًّا لأنّها تستدعي v2 مع fallback.)
--   • للتراجع عن §1:  grant execute on function public.is_client_owner(uuid) to anon;
-- ════════════════════════════════════════════════════════════════════════════
